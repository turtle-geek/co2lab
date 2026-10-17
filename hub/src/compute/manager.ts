// Compute jobs (SPEC §4.7): one job set = one Steam game's reviews, analyzed in batches by the
// devices that pull work. The in-run feedback loop lives here: before every batch the hub reads the
// device's live telemetry and the split strategy, then picks the batch size and threads, or pauses it.

import type {
  AspectCount,
  AspectSpec,
  ComputeDeviceView,
  ComputeItem,
  ComputeSetView,
  DeviceKind,
  DeviceToHub,
  HubToClient,
  HubToDevice,
  SplitStrategy,
} from "@co2lab/shared";
import { ulid } from "ulid";
import type { DeviceRegistry, LiveDevice } from "../devices.js";
import { log } from "../log.js";
import { filterReviews, loadReviews, type SteamReview } from "./steam.js";

export const MODELS = { embed: "Xenova/all-MiniLM-L6-v2", sentiment: "Xenova/distilbert-base-uncased-finetuned-sst-2-english" };

export const DEFAULT_ASPECTS: AspectSpec[] = [
  { name: "grind", seeds: ["the grind is repetitive", "feels like a chore", "too much farming", "same missions over and over"] },
  { name: "story", seeds: ["the story is great", "the plot and writing", "the characters and narrative", "the ending"] },
  { name: "performance", seeds: ["crashes and bugs", "runs smoothly with high fps", "stuttering and lag", "server problems"] },
  { name: "multiplayer", seeds: ["playing co-op with friends", "matchmaking and teammates", "online multiplayer", "solo play"] },
  { name: "value", seeds: ["worth the price", "too expensive for what it is", "microtransactions and battle pass", "great value for money"] },
  { name: "content", seeds: ["not enough content", "lots to do", "gets boring after a few hours", "new updates and content"] },
];

interface TempRule {
  pauseAtC: number;
  resumeBelowC: number;
  shrinkAtC: number | null;
}

/**
 * What each split strategy does. The Lab compares these; the owner's feedback can change them.
 * Temperatures differ by sensor: computers report the CPU thermal zone (idles ~45-55 °C),
 * Android reports its battery (idles ~25-30 °C), so each strategy has a rule for each.
 */
export const STRATEGIES: Record<
  SplitStrategy,
  { batch: number; maxThreads: number; cpu: TempRule; battery: TempRule; pluggedInOnly: boolean; describe: string }
> = {
  fast: {
    batch: 120,
    maxThreads: 8,
    cpu: { pauseAtC: 90, resumeBelowC: 80, shrinkAtC: null },
    battery: { pauseAtC: 42, resumeBelowC: 38, shrinkAtC: null },
    pluggedInOnly: false,
    describe: "big batches, up to 8 threads, pause only at the safety limit (CPU 90 °C, phone battery 42 °C)",
  },
  eco: {
    batch: 40,
    maxThreads: 2,
    cpu: { pauseAtC: 80, resumeBelowC: 72, shrinkAtC: 70 },
    battery: { pauseAtC: 38, resumeBelowC: 34, shrinkAtC: 35 },
    pluggedInOnly: true,
    describe: "small batches, 2 threads, halve batches when warm (CPU 70 °C, phone 35 °C), pause at CPU 80 °C / phone 38 °C, plugged-in only",
  },
};

const JOB_TIMEOUT_MS = 3 * 60_000;
const MAX_ATTEMPTS = 3;
const PAUSE_RETRY_MS = 5_000;
const IDLE_RETRY_MS = 4_000;
/** After this many failed batches in a row a device is paused for FAIL_BACKOFF_MS (e.g. its model install is broken). */
const FAILS_BEFORE_BACKOFF = 2;
const FAIL_BACKOFF_MS = 60_000;

/** Rough active power by device kind (W at idle, at full load). Energy is an estimate and labeled so. */
const WATTS: Record<DeviceKind, [number, number]> = { laptop: [3, 25], desktop: [15, 65], cloud: [1, 8], android: [1, 5] } as Record<DeviceKind, [number, number]>;

interface Job {
  id: string;
  items: ComputeItem[];
  deviceId: string | null;
  sentAt: number;
  attempt: number;
  /** Devices this batch already failed on; a retry goes elsewhere first. */
  failedOn: string[];
}

interface DeviceStats {
  view: ComputeDeviceView;
  paused: string | null;
  failStreak: number;
  failedUntil: number;
  kind: DeviceKind;
}

interface JobSet {
  view: ComputeSetView;
  items: ComputeItem[];
  cursor: number;
  retry: Job[];
  inFlight: Map<string, Job>;
  devices: Map<string, DeviceStats>;
  counts: Map<string, AspectCount>;
}

export interface ComputeDeps {
  devices: DeviceRegistry;
  broadcast: (msg: HubToClient) => void;
  sendToDevice: (d: LiveDevice, msg: HubToDevice) => void;
  deviceChanged: (d: LiveDevice) => void;
}

export class UserError extends Error {}

export class ComputeManager {
  private sets: JobSet[] = [];

  constructor(private deps: ComputeDeps) {}

  views(): ComputeSetView[] {
    return this.sets.slice(-5).map((s) => this.snapshot(s));
  }

  private active(): JobSet | null {
    return this.sets.find((s) => s.view.status === "running" || s.view.status === "fetching") ?? null;
  }

  private snapshot(s: JobSet): ComputeSetView {
    const devices = [...s.devices.values()].map((d) => ({ ...d.view, energyWh: round(d.view.energyWh, 4) }));
    const remaining = s.items.length - s.cursor + s.retry.reduce((n, j) => n + j.items.length, 0);
    s.view.batches.inFlight = s.inFlight.size;
    s.view.batches.total = s.view.batches.done + s.inFlight.size + s.retry.length + Math.ceil(Math.max(0, remaining - s.retry.reduce((n, j) => n + j.items.length, 0)) / STRATEGIES[s.view.strategy].batch);
    return {
      ...s.view,
      devices,
      aspects: [...s.counts.values()],
      energyWh: round(devices.reduce((n, d) => n + d.energyWh, 0), 4),
      decisions: s.view.decisions.slice(-40),
    };
  }

  private publish(s: JobSet) {
    this.deps.broadcast({ type: "compute.update", set: this.snapshot(s) });
  }

  private decide(s: JobSet, deviceId: string | null, text: string) {
    s.view.decisions.push({ at: Date.now(), deviceId, text });
    log.info(`compute: ${text}`);
  }

  // ---------- Owner commands ----------

  async start(appId: number, strategy: SplitStrategy, maxReviews = 3000) {
    if (this.active()) throw new UserError("A compute job is already running; cancel it first");
    const s: JobSet = {
      view: {
        id: ulid(),
        appId,
        title: `Steam app ${appId}`,
        strategy,
        status: "fetching",
        error: null,
        createdAt: Date.now(),
        startedAt: null,
        finishedAt: null,
        reviews: { fetched: 0, kept: 0, dropped: { lowPlaytime: 0, free: 0, duplicate: 0, tooShort: 0 }, bombDays: [] },
        batches: { total: 0, done: 0, inFlight: 0, retried: 0, dropped: 0, droppedReviews: 0 },
        sentences: 0,
        devices: [],
        decisions: [],
        aspects: [],
        energyWh: 0,
      },
      items: [],
      cursor: 0,
      retry: [],
      inFlight: new Map(),
      devices: new Map(),
      counts: new Map(),
    };
    this.sets.push(s);
    this.decide(s, null, `Strategy "${strategy}": ${STRATEGIES[strategy].describe}`);
    this.publish(s);
    void this.prepare(s, maxReviews).catch((e) => this.fail(s, (e as Error).message));
  }

  cancel(setId: string) {
    const s = this.sets.find((x) => x.view.id === setId);
    if (!s || (s.view.status !== "running" && s.view.status !== "fetching")) throw new UserError("That compute job is not running");
    for (const j of s.inFlight.values()) this.release(j.deviceId);
    s.inFlight.clear();
    s.view.status = "cancelled";
    s.view.finishedAt = Date.now();
    this.decide(s, null, "Cancelled by the owner");
    this.publish(s);
  }

  private async prepare(s: JobSet, maxReviews: number) {
    const file = await loadReviews(s.view.appId, maxReviews, (n) => {
      s.view.reviews.fetched = n;
      this.publish(s);
    });
    s.view.title = file.title;
    const f = filterReviews(file.reviews);
    s.view.reviews = { fetched: file.reviews.length, kept: f.kept.length, dropped: f.dropped, bombDays: f.bombDays };
    s.items = f.kept.map((r: SteamReview) => ({ id: r.id, text: r.text.slice(0, 4000), playtimeH: r.playtimeAtReviewH }));
    if (s.view.status !== "fetching") return; // cancelled meanwhile
    s.view.status = "running";
    s.view.startedAt = Date.now();
    const d = s.view.reviews.dropped;
    this.decide(
      s,
      null,
      `${file.title}: kept ${f.kept.length} of ${file.reviews.length} reviews (dropped ${d.lowPlaytime} under 0.5 h played, ${d.free} free copies, ${d.duplicate} templated, ${d.tooShort} too short)` +
        (f.bombDays.length ? `; review-bomb days: ${f.bombDays.join(", ")}` : ""),
    );
    this.publish(s);
  }

  private fail(s: JobSet, error: string) {
    s.view.status = "failed";
    s.view.error = error;
    s.view.finishedAt = Date.now();
    this.decide(s, null, `Failed: ${error}`);
    this.publish(s);
  }

  // ---------- Device side ----------

  onDeviceMessage(d: LiveDevice, msg: Extract<DeviceToHub, { type: `job.${string}` }>) {
    if (msg.type === "job.pull") return this.onPull(d, msg.cores);
    const s = this.sets.find((x) => x.inFlight.has(msg.jobId));
    const job = s?.inFlight.get(msg.jobId);
    if (!s || !job || job.deviceId !== d.rec.id) return; // stale (cancelled, or already moved to another device)
    s.inFlight.delete(job.id);
    this.release(d.rec.id);
    const st = this.stats(s, d);
    if (msg.type === "job.failed") {
      st.failStreak++;
      job.failedOn.push(d.rec.id);
      this.decide(s, d.rec.id, `${d.rec.name} could not run a batch: ${msg.reason}`);
      if (st.failStreak >= FAILS_BEFORE_BACKOFF) {
        st.failedUntil = Date.now() + FAIL_BACKOFF_MS;
        this.decide(s, d.rec.id, `Paused ${d.rec.name} for ${FAIL_BACKOFF_MS / 1000} s: its last ${st.failStreak} batches failed`);
      }
      this.requeue(s, job);
    } else {
      st.failStreak = 0;
      for (const c of msg.counts) this.merge(s, c);
      s.view.batches.done++;
      s.view.sentences += msg.sentences;
      const v = st.view;
      v.batches++;
      v.sentences += msg.sentences;
      const rate = msg.sentences / Math.max(0.001, msg.durationMs / 1000);
      v.sentencesPerS = round(v.sentencesPerS === null ? rate : 0.6 * v.sentencesPerS + 0.4 * rate, 1);
      if (msg.tempC !== null) {
        v.tempC = msg.tempC;
        v.peakTempC = Math.max(v.peakTempC ?? msg.tempC, msg.tempC);
      }
      const [idle, max] = WATTS[st.kind] ?? [3, 25];
      const load = (msg.cpuPct ?? 100) / 100;
      v.energyWh += (msg.durationMs / 3_600_000) * (idle + (max - idle) * load);
    }
    st.view.state = "idle";
    this.checkDone(s);
    this.publish(s);
  }

  private onPull(d: LiveDevice, cores: number) {
    const s = this.active();
    if (!s || s.view.status !== "running") {
      this.deps.sendToDevice(d, { type: "job.none", retryMs: IDLE_RETRY_MS, reason: "no compute work" });
      return;
    }
    if (d.current) {
      this.deps.sendToDevice(d, { type: "job.none", retryMs: IDLE_RETRY_MS, reason: "busy with a subtask" });
      return;
    }
    const st = this.stats(s, d);
    const plan = this.feedback(s, d, st, cores);
    if ("pause" in plan) {
      st.view.state = "paused";
      this.deps.sendToDevice(d, { type: "job.none", retryMs: PAUSE_RETRY_MS, reason: plan.pause });
      this.publish(s);
      return;
    }
    const job = this.take(s, plan.batch, d.rec.id);
    if (!job) {
      st.view.state = "idle";
      this.deps.sendToDevice(d, { type: "job.none", retryMs: IDLE_RETRY_MS, reason: "all batches handed out" });
      return;
    }
    job.deviceId = d.rec.id;
    job.sentAt = Date.now();
    s.inFlight.set(job.id, job);
    st.view.state = "working";
    st.view.batchSize = plan.batch;
    st.view.threads = plan.threads;
    d.current = { subtaskId: job.id, capability: "web", label: "Review analysis", progress: s.view.batches.done / Math.max(1, s.view.batches.total) };
    this.deps.deviceChanged(d);
    this.deps.sendToDevice(d, {
      type: "job.assign",
      jobId: job.id,
      setId: s.view.id,
      kind: "embed",
      models: MODELS,
      threads: plan.threads,
      items: job.items,
      aspects: DEFAULT_ASPECTS,
    });
    this.publish(s);
  }

  /**
   * The in-run feedback loop. Reads this device's live temperature and battery, applies the
   * strategy's rules, and records every change of decision so the dashboard (and later the Lab)
   * can show why a device slowed down or stopped.
   */
  private feedback(s: JobSet, d: LiveDevice, st: DeviceStats, cores: number): { pause: string } | { batch: number; threads: number } {
    const strat = STRATEGIES[s.view.strategy];
    const rule = { ...(d.rec.kind === "android" ? strat.battery : strat.cpu), pluggedInOnly: strat.pluggedInOnly, batch: strat.batch, maxThreads: strat.maxThreads };
    const t = d.telemetry;
    const temp = t?.tempC ?? null;
    let pause: string | null = null;
    if (st.failedUntil > Date.now()) pause = `batches kept failing; retrying in ${Math.ceil((st.failedUntil - Date.now()) / 1000)} s`;
    else if (t && t.batteryPct !== null && t.batteryPct < 20 && t.charging === false) pause = `battery ${t.batteryPct} % and unplugged`;
    else if (rule.pluggedInOnly && t && t.batteryPct !== null && t.charging === false) pause = "on battery (eco runs plugged-in only)";
    else if (temp !== null && temp >= rule.pauseAtC) pause = `${temp} °C ≥ ${rule.pauseAtC} °C`;
    else if (st.paused && temp !== null && temp >= rule.resumeBelowC && st.paused.includes("°C")) pause = `cooling down (${temp} °C, resumes below ${rule.resumeBelowC} °C)`;

    if (pause) {
      if (!st.paused && st.failedUntil <= Date.now()) this.decide(s, d.rec.id, `Paused ${d.rec.name}: ${pause}`);
      st.paused = pause;
      return { pause };
    }
    if (st.paused) this.decide(s, d.rec.id, `Resumed ${d.rec.name}${temp !== null ? ` at ${temp} °C` : ""}`);
    st.paused = null;

    let batch = rule.batch;
    if (rule.shrinkAtC !== null && temp !== null && temp >= rule.shrinkAtC) {
      batch = Math.max(10, Math.round(batch / 2));
      if (st.view.batchSize !== batch) this.decide(s, d.rec.id, `${d.rec.name} at ${temp} °C: batch halved to ${batch}`);
    }
    const threads = Math.max(1, Math.min(rule.maxThreads, cores));
    return { batch, threads };
  }

  /** A retried batch goes to a device that has not failed it yet, when one asks; else fresh work. */
  private take(s: JobSet, size: number, deviceId: string): Job | null {
    const i = s.retry.findIndex((j) => !j.failedOn.includes(deviceId));
    if (i >= 0) return s.retry.splice(i, 1)[0]!;
    if (s.cursor < s.items.length) {
      const items = s.items.slice(s.cursor, s.cursor + size);
      s.cursor += items.length;
      return { id: ulid(), items, deviceId: null, sentAt: 0, attempt: 1, failedOn: [] };
    }
    // Only batches this device already failed are left: let it try again rather than stall.
    return s.retry.shift() ?? null;
  }

  private requeue(s: JobSet, job: Job) {
    if (job.attempt >= MAX_ATTEMPTS) {
      s.view.batches.dropped++;
      s.view.batches.droppedReviews += job.items.length;
      this.decide(s, null, `Dropped a batch of ${job.items.length} reviews after ${MAX_ATTEMPTS} tries`);
      return;
    }
    s.retry.push({ ...job, id: ulid(), deviceId: null, attempt: job.attempt + 1, failedOn: [...job.failedOn] });
    s.view.batches.retried++;
  }

  private release(deviceId: string | null) {
    if (!deviceId) return;
    const d = this.deps.devices.get(deviceId);
    if (d?.current?.label === "Review analysis") {
      d.current = null;
      this.deps.deviceChanged(d);
    }
  }

  private stats(s: JobSet, d: LiveDevice): DeviceStats {
    let st = s.devices.get(d.rec.id);
    if (!st) {
      st = {
        kind: d.rec.kind,
        paused: null,
        failStreak: 0,
        failedUntil: 0,
        view: { deviceId: d.rec.id, name: d.rec.name, state: "idle", batches: 0, sentences: 0, sentencesPerS: null, batchSize: 0, threads: 0, tempC: d.telemetry?.tempC ?? null, peakTempC: null, energyWh: 0 },
      };
      s.devices.set(d.rec.id, st);
    }
    st.view.tempC = d.telemetry?.tempC ?? st.view.tempC;
    return st;
  }

  private merge(s: JobSet, c: AspectCount) {
    const cur = s.counts.get(c.aspect);
    if (!cur) {
      s.counts.set(c.aspect, structuredClone(c));
      return;
    }
    cur.pos += c.pos;
    cur.neg += c.neg;
    for (const k of ["under5h", "from5to30h", "over30h"] as const) {
      cur.byPlaytime[k].pos += c.byPlaytime[k].pos;
      cur.byPlaytime[k].neg += c.byPlaytime[k].neg;
    }
    const ex = [...cur.examples, ...c.examples];
    cur.examples = [...ex.filter((e) => !e.positive).slice(0, 2), ...ex.filter((e) => e.positive).slice(0, 2)];
  }

  private checkDone(s: JobSet) {
    if (s.view.status !== "running") return;
    if (s.cursor < s.items.length || s.retry.length || s.inFlight.size) return;
    s.view.finishedAt = Date.now();
    const secs = ((s.view.finishedAt - (s.view.startedAt ?? s.view.finishedAt)) / 1000).toFixed(0);
    const lost = s.view.batches.droppedReviews;
    // Results built on less than 80 % of the kept reviews are not a valid answer.
    if (lost > 0.2 * s.items.length) {
      s.view.status = "failed";
      s.view.error = `${lost} of ${s.items.length} reviews could not be analyzed (${s.view.batches.dropped} batches failed 3 times); see the decisions below`;
      this.decide(s, null, `Failed: ${s.view.error}`);
      return;
    }
    s.view.status = "done";
    this.decide(
      s,
      null,
      `Done: ${s.view.sentences} sentences in ${secs} s across ${s.devices.size} device(s)` + (lost ? ` (${lost} reviews in failed batches left out)` : ""),
    );
  }

  // ---------- Health engine hooks ----------

  /** Device went offline or was revoked: its batch goes back in the queue. */
  onDeviceLost(d: LiveDevice, why: string) {
    for (const s of this.sets) {
      for (const job of [...s.inFlight.values()]) {
        if (job.deviceId !== d.rec.id) continue;
        s.inFlight.delete(job.id);
        this.decide(s, d.rec.id, `${d.rec.name} ${why}; its batch of ${job.items.length} reviews goes back in the queue`);
        this.requeue(s, job);
        const st = s.devices.get(d.rec.id);
        if (st) st.view.state = "idle";
        this.publish(s);
      }
    }
  }

  tick(now = Date.now()) {
    for (const s of this.sets) {
      for (const job of [...s.inFlight.values()]) {
        if (now - job.sentAt < JOB_TIMEOUT_MS) continue;
        s.inFlight.delete(job.id);
        this.release(job.deviceId);
        this.decide(s, job.deviceId, `A batch timed out after ${JOB_TIMEOUT_MS / 60_000} min; requeued`);
        this.requeue(s, job);
        this.publish(s);
      }
    }
  }
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
