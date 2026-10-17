// Runs: planning, scheduling, the health engine's reassignment, evidence -> deals, and merge.
// In-memory maps are the live working set; every change is written through to the repository.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentConfig,
  Capability,
  Deal,
  DealSource,
  DeviceToHub,
  HubToClient,
  HubToDevice,
  RankedDeal,
  RunView,
  StepKind,
} from "@co2lab/shared";
import { ulid } from "ulid";
import { addBurn, emptyBurn } from "./burn.js";
import { config } from "./config.js";
import type { DeviceRegistry, LiveDevice } from "./devices.js";
import {
  GeminiUnavailable,
  PLAN_IDS,
  chooseProxyAction,
  extractDeals,
  geminiProblem,
  planRun,
  rankDeals,
  type PlanId,
  type Usage,
} from "./gemini.js";
import { log } from "./log.js";
import type { DealRecord, Repository, RunRecord, StepRow, SubtaskRecord } from "./repo/index.js";

/** A queued subtask fails if no device can take it for this long. */
export const QUEUE_TIMEOUT_MS = 90_000;
/** A running subtask fails if the device does not report back in this long. */
export const RUN_TIMEOUT_MS = 5 * 60_000;
/** Max times a subtask is handed out (first try + reassignments). */
export const MAX_ATTEMPTS = 3;

export const DEFAULT_CONFIG: AgentConfig = { model: "flash", screenshotScale: 0.5, mode: "recipe" };

export const PLAN_INFO: Record<PlanId, { capability: Capability; source: DealSource; label: string; goal: string }> = {
  "app:tims": {
    capability: "app:tims",
    source: "tims",
    label: "Tim Hortons",
    goal: "Collect all current offers in the Tim Hortons app",
  },
  "app:mcdonalds": {
    capability: "app:mcdonalds",
    source: "mcdonalds",
    label: "McDonald's",
    goal: "Collect all current deals in the McDonald's app",
  },
  "app:popeyes": {
    capability: "app:popeyes",
    source: "popeyes",
    label: "Popeyes",
    goal: "Collect all current offers in the Popeyes app",
  },
  "web:redflagdeals": {
    capability: "web",
    source: "redflagdeals",
    label: "RedFlagDeals",
    goal: "Collect current restaurant and food deals near Scarborough / UTSC from the RedFlagDeals Hot Deals forum",
  },
};

type Phase = "device" | "extracting";

export interface RunDeps {
  repo: Repository;
  devices: DeviceRegistry;
  broadcast: (msg: HubToClient) => void;
  sendToDevice: (d: LiveDevice, msg: HubToDevice) => void;
  deviceChanged: (d: LiveDevice) => void;
  /** Research Mode keeps the screenshots and screen text of capture runs (hub/src/research/). */
  onEvidence?: (subtaskId: string, deviceId: string | null, refs: (string | null)[], text: string | null) => void;
}

export class RunManager {
  private runs = new Map<string, RunRecord>();
  private subtasks = new Map<string, SubtaskRecord>();
  private byRun = new Map<string, string[]>();
  private byClientRunId = new Map<string, string>();
  private phase = new Map<string, Phase>();
  private queuedAt = new Map<string, number>();
  private runCreating = new Map<string, Promise<RunView>>();

  constructor(private deps: RunDeps) {}

  async load() {
    const n = await this.deps.repo.failUnfinishedRuns("hub restarted", Date.now());
    if (n) log.warn(`marked ${n} unfinished run(s) failed: hub restarted`);
    for (const { run, subtasks } of await this.deps.repo.listRecentRuns(20)) {
      this.runs.set(run.id, run);
      this.byClientRunId.set(run.clientRunId, run.id);
      this.byRun.set(
        run.id,
        subtasks.map((s) => s.id),
      );
      for (const s of subtasks) this.subtasks.set(s.id, s);
    }
  }

  // ---------- Views ----------

  view(runId: string): RunView {
    const r = this.runs.get(runId)!;
    return {
      id: r.id,
      clientRunId: r.clientRunId,
      prompt: r.prompt,
      status: r.status,
      subtasks: this.subtasksOf(runId).map((s) => ({
        id: s.id,
        capability: s.capability,
        goal: s.goal,
        status: s.status,
        deviceId: s.deviceId,
        attempt: s.attempt,
        error: s.error,
        dealCount: s.dealCount,
      })),
      ranked: r.ranked,
      burn: r.burn,
      error: r.error,
      createdAt: r.createdAt,
      finishedAt: r.finishedAt,
    };
  }

  recentViews(limit = 20): RunView[] {
    return [...this.runs.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((r) => this.view(r.id));
  }

  private subtasksOf(runId: string): SubtaskRecord[] {
    return (this.byRun.get(runId) ?? []).map((id) => this.subtasks.get(id)!);
  }

  private publish(runId: string) {
    this.deps.broadcast({ type: "run.update", run: this.view(runId) });
  }

  private saveRun(r: RunRecord) {
    this.deps.repo.upsertRun(r).catch((e) => log.error("repo upsertRun", e));
  }
  private saveSubtask(s: SubtaskRecord) {
    this.deps.repo.upsertSubtask(s).catch((e) => log.error("repo upsertSubtask", e));
  }
  private saveStep(s: StepRow) {
    this.deps.repo.appendStep(s).catch((e) => log.error("repo appendStep", e));
  }

  private usageSink(runId: string, subtask: SubtaskRecord | null, kind: StepRow["kind"]) {
    return (u: Usage) => {
      const r = this.runs.get(runId);
      if (!r) return;
      r.burn = addBurn(r.burn, u.burn);
      this.saveRun(r);
      this.saveStep({
        time: Date.now(),
        runId,
        subtaskId: subtask?.id ?? null,
        deviceId: subtask?.deviceId ?? null,
        kind,
        detail: { tier: u.tier },
        tokensIn: u.tokensIn,
        tokensOut: u.tokensOut,
        model: u.model,
      });
      this.publish(runId);
    };
  }

  /** Hub-side progress line on a device's live screen caption. */
  private hubStep(s: SubtaskRecord, kind: StepKind, text: string) {
    if (!s.deviceId) return;
    this.deps.broadcast({ type: "step", deviceId: s.deviceId, subtaskId: s.id, kind, text, at: Date.now() });
  }

  // ---------- Create + plan ----------

  async create(prompt: string, clientRunId: string): Promise<RunView> {
    const existing = this.byClientRunId.get(clientRunId);
    if (existing) return this.view(existing);
    const pending = this.runCreating.get(clientRunId);
    if (pending) return pending;
    const p = (async () => {
      const stored = await this.deps.repo.getRunByClientRunId(clientRunId);
      if (stored) {
        this.runs.set(stored.id, stored);
        this.byClientRunId.set(clientRunId, stored.id);
        this.byRun.set(stored.id, this.byRun.get(stored.id) ?? []);
        return this.view(stored.id);
      }
      const run: RunRecord = {
        id: ulid(),
        clientRunId,
        prompt,
        status: "planning",
        config: { ...DEFAULT_CONFIG },
        ranked: null,
        burn: emptyBurn(),
        error: null,
        createdAt: Date.now(),
        finishedAt: null,
      };
      this.runs.set(run.id, run);
      this.byRun.set(run.id, []);
      this.byClientRunId.set(clientRunId, run.id);
      this.saveRun(run);
      this.publish(run.id);
      void this.plan(run).catch((e) => this.failRun(run, `planner crashed: ${errMsg(e)}`));
      return this.view(run.id);
    })();
    this.runCreating.set(clientRunId, p);
    try {
      return await p;
    } finally {
      this.runCreating.delete(clientRunId);
    }
  }

  private async plan(run: RunRecord) {
    const available = PLAN_IDS.filter((id) => this.deps.devices.anyWith(PLAN_INFO[id].capability));
    let chosen: { id: PlanId; goal: string }[];
    let planNote: string;
    try {
      const out = await planRun(run.prompt, [...available], this.usageSink(run.id, null, "plan"));
      const seen = new Set<PlanId>();
      chosen = out.subtasks.filter((s) => !seen.has(s.id) && seen.add(s.id));
      planNote = "gemini";
    } catch (e) {
      // The source list is fixed and small, so without a planner we check every source.
      // This is stated in the run log; downstream Gemini steps still fail honestly if Gemini is down.
      const why = e instanceof GeminiUnavailable ? e.message : `planner failed: ${errMsg(e)}`;
      log.warn(`run ${run.id}: ${why}; planning all sources`);
      chosen = PLAN_IDS.map((id) => ({ id, goal: PLAN_INFO[id].goal }));
      planNote = `fallback (${why})`;
    }
    this.saveStep({
      time: Date.now(),
      runId: run.id,
      subtaskId: null,
      deviceId: null,
      kind: "plan",
      detail: { planner: planNote, subtasks: chosen },
      tokensIn: 0,
      tokensOut: 0,
      model: null,
    });
    if (chosen.length === 0) return this.failRun(run, "planner chose no sources for this request");
    this.startSubtasks(run, chosen, planNote);
  }

  /** A run with fixed sources and config, no planner (Research Mode live captures). */
  async createFixed(prompt: string, ids: PlanId[], cfg: AgentConfig): Promise<RunView> {
    const run: RunRecord = {
      id: ulid(),
      clientRunId: `fixed-${ulid()}`,
      prompt,
      status: "planning",
      config: { ...cfg },
      ranked: null,
      burn: emptyBurn(),
      error: null,
      createdAt: Date.now(),
      finishedAt: null,
    };
    this.runs.set(run.id, run);
    this.byRun.set(run.id, []);
    this.byClientRunId.set(run.clientRunId, run.id);
    this.saveRun(run);
    this.startSubtasks(
      run,
      ids.map((id) => ({ id, goal: PLAN_INFO[id].goal })),
      "fixed",
    );
    return this.view(run.id);
  }

  private startSubtasks(run: RunRecord, chosen: { id: PlanId; goal: string }[], planNote: string) {
    const now = Date.now();
    for (const c of chosen) {
      const info = PLAN_INFO[c.id];
      const s: SubtaskRecord = {
        id: ulid(),
        runId: run.id,
        capability: info.capability,
        source: info.source,
        label: info.label,
        goal: c.goal || info.goal,
        status: "queued",
        deviceId: null,
        attempt: 1,
        error: null,
        dealCount: 0,
        createdAt: now,
        startedAt: null,
        finishedAt: null,
      };
      this.subtasks.set(s.id, s);
      this.byRun.get(run.id)!.push(s.id);
      this.queuedAt.set(s.id, now);
      if (!this.deps.devices.anyWith(s.capability)) {
        this.finishSubtask(s, "failed", `no device can run ${c.id}`);
      } else {
        this.saveSubtask(s);
      }
    }
    run.status = "running";
    this.saveRun(run);
    log.info(`run ${run.id} planned (${planNote}): ${chosen.map((c) => c.id).join(", ")}`);
    this.publish(run.id);
    this.schedule();
    this.checkRunComplete(run.id);
  }

  // ---------- Scheduler ----------

  /** Assign queued subtasks (oldest first) to available devices. Home devices first, cloud as backup. */
  schedule(now = Date.now()) {
    const queued = [...this.subtasks.values()]
      .filter((s) => s.status === "queued")
      .sort((a, b) => (this.queuedAt.get(a.id) ?? 0) - (this.queuedAt.get(b.id) ?? 0));
    for (const s of queued) {
      const capable = this.deps.devices.active().filter((d) => d.rec.capabilities.includes(s.capability));
      const free = capable.filter((d) => this.deps.devices.isAvailable(d, now));
      const home = free.filter((d) => d.rec.kind !== "cloud");
      let pick = home[0];
      if (!pick) {
        // Cloud only when no healthy home device could take it (not merely because one is busy).
        const homeHealthy = capable.some((d) => d.rec.kind !== "cloud" && this.deps.devices.isHealthy(d));
        if (!homeHealthy) pick = free.find((d) => d.rec.kind === "cloud");
      }
      if (pick) this.assign(s, pick, now);
    }
  }

  private assign(s: SubtaskRecord, d: LiveDevice, now: number) {
    const run = this.runs.get(s.runId)!;
    s.status = "running";
    s.deviceId = d.rec.id;
    s.startedAt = now;
    s.error = null;
    this.phase.set(s.id, "device");
    this.queuedAt.delete(s.id);
    d.current = { subtaskId: s.id, capability: s.capability, label: s.label, progress: 0 };
    this.saveSubtask(s);
    this.deps.sendToDevice(d, {
      type: "subtask.assign",
      subtaskId: s.id,
      runId: s.runId,
      capability: s.capability,
      goal: s.goal,
      config: run.config,
    });
    log.info(`assign ${s.label} (${s.id}, attempt ${s.attempt}) -> ${d.rec.name}`);
    this.deps.deviceChanged(d);
    this.publish(s.runId);
  }

  private releaseDevice(s: SubtaskRecord) {
    if (!s.deviceId) return;
    const d = this.deps.devices.get(s.deviceId);
    if (d?.current?.subtaskId === s.id) {
      d.current = null;
      this.deps.deviceChanged(d);
    }
  }

  /** Subtask the device currently runs (assigned to it and not yet reported back). */
  private ownedBy(d: LiveDevice, subtaskId: string): SubtaskRecord | null {
    const s = this.subtasks.get(subtaskId);
    if (!s || s.status !== "running" || s.deviceId !== d.rec.id || this.phase.get(s.id) !== "device") return null;
    return s;
  }

  private cancelOn(d: LiveDevice, subtaskId: string) {
    log.info(`cancel stale subtask ${subtaskId} on ${d.rec.name}`);
    this.deps.sendToDevice(d, { type: "subtask.cancel", subtaskId });
  }

  // ---------- Health engine hooks ----------

  /** Device went offline or was revoked: requeue what it was running. */
  onDeviceLost(d: LiveDevice, why: string) {
    const now = Date.now();
    for (const s of this.subtasks.values()) {
      if (s.status !== "running" || s.deviceId !== d.rec.id || this.phase.get(s.id) !== "device") continue;
      if (d.current?.subtaskId === s.id) d.current = null;
      if (s.attempt >= MAX_ATTEMPTS) {
        this.finishSubtask(s, "failed", `${why} (${MAX_ATTEMPTS} attempts used)`);
        continue;
      }
      s.status = "queued";
      s.attempt += 1;
      s.deviceId = null;
      s.startedAt = null;
      s.error = `${d.rec.name} ${why}; reassigning`;
      this.phase.delete(s.id);
      this.queuedAt.set(s.id, now);
      this.saveSubtask(s);
      log.info(`requeue ${s.label} (${s.id}) attempt ${s.attempt}: ${d.rec.name} ${why}`);
      this.publish(s.runId);
    }
    this.schedule(now);
  }

  /** Heartbeat lists what the device thinks it runs; cancel anything it no longer owns. */
  onHeartbeat(d: LiveDevice, runningSubtaskIds: string[]) {
    for (const id of runningSubtaskIds) if (!this.ownedBy(d, id)) this.cancelOn(d, id);
  }

  /** Periodic: queue and run timeouts. */
  tick(now = Date.now()) {
    for (const s of this.subtasks.values()) {
      if (s.status === "queued") {
        const since = this.queuedAt.get(s.id) ?? now;
        if (now - since > QUEUE_TIMEOUT_MS)
          this.finishSubtask(s, "failed", `no online device could run ${s.capability} within ${QUEUE_TIMEOUT_MS / 1000} s`);
      } else if (s.status === "running" && this.phase.get(s.id) === "device" && s.startedAt && now - s.startedAt > RUN_TIMEOUT_MS) {
        const d = s.deviceId ? this.deps.devices.get(s.deviceId) : undefined;
        if (d) this.cancelOn(d, s.id);
        this.finishSubtask(s, "failed", `timed out after ${RUN_TIMEOUT_MS / 60_000} min`);
      }
    }
    this.schedule(now);
  }

  // ---------- Device messages ----------

  onDeviceMessage(d: LiveDevice, msg: Exclude<DeviceToHub, { type: "hello" | "heartbeat" }>) {
    switch (msg.type) {
      case "frame": {
        if (msg.subtaskId && !this.ownedBy(d, msg.subtaskId)) return this.cancelOn(d, msg.subtaskId);
        const frame: Extract<HubToClient, { type: "frame" }> = {
          type: "frame",
          deviceId: d.rec.id,
          subtaskId: msg.subtaskId,
          jpegBase64: msg.jpegBase64,
          width: msg.width,
          height: msg.height,
          at: Date.now(),
        };
        d.latestFrame = frame;
        this.deps.broadcast(frame);
        return;
      }
      case "step": {
        const s = this.ownedBy(d, msg.subtaskId);
        if (!s) return this.cancelOn(d, msg.subtaskId);
        if (msg.progress !== undefined && d.current?.subtaskId === s.id) {
          d.current.progress = msg.progress;
          this.deps.deviceChanged(d);
        }
        this.saveStep({
          time: Date.now(),
          runId: s.runId,
          subtaskId: s.id,
          deviceId: d.rec.id,
          kind: msg.kind,
          detail: { text: msg.text, progress: msg.progress ?? null },
          tokensIn: 0,
          tokensOut: 0,
          model: null,
        });
        this.deps.broadcast({ type: "step", deviceId: d.rec.id, subtaskId: s.id, kind: msg.kind, text: msg.text, at: Date.now() });
        return;
      }
      case "subtask.failed": {
        const s = this.ownedBy(d, msg.subtaskId);
        if (!s) return; // stale; nothing to cancel, the device already stopped
        this.deps.devices.setError(d, `${s.label}: ${msg.reason}`);
        this.finishSubtask(s, "failed", msg.reason);
        return;
      }
      case "subtask.result": {
        const s = this.ownedBy(d, msg.subtaskId);
        if (!s) return;
        this.phase.set(s.id, "extracting");
        this.releaseDevice(s); // device is free for the next subtask while the hub reads the evidence
        this.schedule();
        void this.extract(s, msg.evidence).catch((e) => this.finishSubtask(s, "failed", `extraction crashed: ${errMsg(e)}`));
        return;
      }
      case "proxy.request": {
        const s = this.ownedBy(d, msg.subtaskId);
        if (!s) return this.cancelOn(d, msg.subtaskId);
        void this.proxy(d, s, msg);
        return;
      }
    }
  }

  private async proxy(d: LiveDevice, s: SubtaskRecord, msg: Extract<DeviceToHub, { type: "proxy.request" }>) {
    const run = this.runs.get(s.runId)!;
    try {
      const { action, why } = await chooseProxyAction({
        goal: msg.goal,
        screenshot: msg.screenshot,
        nodes: msg.nodes,
        history: msg.history,
        tier: run.config.model,
        onUsage: this.usageSink(s.runId, s, "proxy"),
      });
      this.hubStep(s, "fallback", `Gemini: ${action.kind}${why ? ` (${why.slice(0, 80)})` : ""}`);
      this.deps.sendToDevice(d, { type: "proxy.action", requestId: msg.requestId, action });
    } catch (e) {
      const reason = `agent proxy unavailable: ${errMsg(e)}`;
      this.deps.sendToDevice(d, { type: "proxy.action", requestId: msg.requestId, action: { kind: "fail", reason } });
    }
  }

  private async extract(s: SubtaskRecord, evidence: { images: string[]; text: string | null }) {
    const run = this.runs.get(s.runId)!;
    const problem = geminiProblem(run.config.model);
    if (problem) return this.finishSubtask(s, "failed", `cannot read deals: ${problem}`);
    if (evidence.images.length === 0 && !evidence.text?.trim())
      return this.finishSubtask(s, "failed", "device sent no evidence (no screenshots or text)");

    const refs = await this.saveImages(s, evidence.images);
    this.deps.onEvidence?.(s.id, s.deviceId, refs, evidence.text);
    this.hubStep(s, "extract", `Reading ${s.label} deals with Gemini…`);
    let deals: Deal[];
    try {
      deals = await extractDeals({
        source: s.source,
        label: s.label,
        goal: s.goal,
        images: evidence.images,
        text: evidence.text,
        imageRefs: refs,
        config: run.config,
        onUsage: this.usageSink(s.runId, s, "extract"),
      });
    } catch (e) {
      return this.finishSubtask(s, "failed", `deal extraction failed: ${errMsg(e)}`);
    }
    const records: DealRecord[] = deals.map((deal) => ({
      ...deal,
      id: ulid(),
      runId: s.runId,
      subtaskId: s.id,
      deviceId: s.deviceId,
    }));
    await this.deps.repo.insertDeals(records).catch((e) => log.error("repo insertDeals", e));
    s.dealCount = records.length;
    this.hubStep(s, "extract", records.length ? `Found ${records.length} deal(s)` : "No deals found");
    this.finishSubtask(s, "done", null);
  }

  private async saveImages(s: SubtaskRecord, images: string[]): Promise<(string | null)[]> {
    if (images.length === 0) return [];
    const dir = join(config.dataDir, "frames");
    try {
      await mkdir(dir, { recursive: true });
      return await Promise.all(
        images.map(async (b64, i) => {
          const name = `${s.id}-${s.attempt}-${i}.jpg`;
          await writeFile(join(dir, name), Buffer.from(b64, "base64"));
          return `frames/${name}`;
        }),
      );
    } catch (e) {
      log.error("saving evidence images", e);
      return images.map(() => null);
    }
  }

  private finishSubtask(s: SubtaskRecord, status: "done" | "failed" | "cancelled", error: string | null) {
    if (s.status === "done" || s.status === "failed" || s.status === "cancelled") return;
    this.releaseDevice(s);
    s.status = status;
    s.error = error;
    s.finishedAt = Date.now();
    this.phase.delete(s.id);
    this.queuedAt.delete(s.id);
    this.saveSubtask(s);
    log.info(`subtask ${s.label} (${s.id}) ${status}${error ? `: ${error}` : ""}`);
    this.publish(s.runId);
    this.checkRunComplete(s.runId);
  }

  // ---------- Merge ----------

  private checkRunComplete(runId: string) {
    const run = this.runs.get(runId);
    if (!run || run.status !== "running") return;
    const subs = this.subtasksOf(runId);
    if (subs.some((s) => s.status === "queued" || s.status === "running")) return;
    const done = subs.filter((s) => s.status === "done");
    if (done.length === 0) {
      return this.failRun(run, subs.map((s) => `${s.label}: ${s.error ?? s.status}`).join("; ") || "no subtasks");
    }
    void this.merge(run).catch((e) => this.failRun(run, `merge crashed: ${errMsg(e)}`));
  }

  private async merge(run: RunRecord) {
    run.status = "merging";
    this.saveRun(run);
    this.publish(run.id);
    const deals = await this.deps.repo.listDeals(run.id);
    let ranked: RankedDeal[] = [];
    if (deals.length > 0) {
      try {
        const out = await rankDeals(run.prompt, deals, this.usageSink(run.id, null, "merge"));
        const used = new Set<number>();
        ranked = out.ranked
          .filter((r) => r.index < deals.length && !used.has(r.index) && used.add(r.index))
          .sort((a, b) => a.rank - b.rank)
          .map((r, i) => {
            const d = deals[r.index]!;
            return {
              source: d.source,
              title: d.title,
              priceText: d.priceText,
              conditions: d.conditions,
              expiresText: d.expiresText,
              url: d.url,
              screenshotRef: d.screenshotRef,
              confidence: d.confidence,
              rank: i + 1,
              reason: r.reason,
              deviceId: d.deviceId,
            };
          });
      } catch (e) {
        return this.failRun(run, `merge failed: ${errMsg(e)} (${deals.length} deals were extracted)`);
      }
    }
    run.ranked = ranked;
    run.status = "done";
    run.finishedAt = Date.now();
    this.saveRun(run);
    log.info(`run ${run.id} done: ${ranked.length} ranked deal(s), ${run.burn.tokensIn + run.burn.tokensOut} tokens`);
    this.publish(run.id);
  }

  private failRun(run: RunRecord, error: string) {
    if (run.status === "done" || run.status === "failed") return;
    for (const s of this.subtasksOf(run.id)) {
      if (s.status === "queued" || s.status === "running") {
        const d = s.deviceId ? this.deps.devices.get(s.deviceId) : undefined;
        if (d && this.phase.get(s.id) === "device") this.cancelOn(d, s.id);
        this.releaseDevice(s);
        s.status = "cancelled";
        s.finishedAt = Date.now();
        this.saveSubtask(s);
      }
    }
    run.status = "failed";
    run.error = error;
    run.finishedAt = Date.now();
    this.saveRun(run);
    log.info(`run ${run.id} failed: ${error}`);
    this.publish(run.id);
  }

}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
