// Research Mode (SPEC §4.5): live capture -> owner ground truth -> hypothesis (cites Papiers and
// feedback) -> trials replaying the capture through the real extraction -> analysis -> owner
// flag / approve / redirect -> next experiment. State lives in the ResearchStore (Tiger Data).

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentConfig,
  AppId,
  CaptureView,
  ClientToHub,
  Deal,
  DealSource,
  ExperimentView,
  HubToClient,
  ModelTier,
  ResearchState,
  RunView,
} from "@co2lab/shared";
import { ulid } from "ulid";
import { burnFor } from "../burn.js";
import { config } from "../config.js";
import { extractDeals, geminiProblem, type PlanId, type Usage } from "../gemini.js";
import { log } from "../log.js";
import type { Repository } from "../repo/index.js";
import { PLAN_INFO, type RunManager } from "../runs.js";
import { RESEARCH_QUESTION, analyzeExperiment, gatherPapiers, modelsNote, proposeExperiment, type PastExperiment } from "./agent.js";
import { scaleJpeg } from "./images.js";
import { scoreDeals } from "./score.js";
import {
  configId,
  type CaptureRecord,
  type ExperimentRecord,
  type FeedbackRecord,
  type FindingRecord,
  type GroundTruthRecord,
  type ResearchStore,
  type TrialRecord,
} from "./store.js";

/** Captures read the screen at full resolution so trials can downscale it themselves. */
const CAPTURE_CONFIG: AgentConfig = { model: "flash", screenshotScale: 1, mode: "recipe" };
const CAPTURE_APPS: AppId[] = ["tims", "mcdonalds", "popeyes"];
/** Pause between trial calls so the free-tier per-minute limit is not hit. */
const TRIAL_GAP_MS = 2_500;

type ResearchMsg = Extract<ClientToHub, { type: `research.${string}` }>;

export interface LabDeps {
  store: ResearchStore;
  repo: Repository;
  runs: RunManager;
  broadcast: (msg: HubToClient) => void;
  deviceName: (id: string) => string | null;
}

export class UserError extends Error {}

export class ResearchLab {
  private captures = new Map<string, CaptureRecord>();
  private truth = new Map<string, GroundTruthRecord>();
  private experiments = new Map<string, ExperimentRecord>();
  private trials: TrialRecord[] = [];
  private feedback: FeedbackRecord[] = [];
  private findings: FindingRecord[] = [];
  private busy: string | null = null;

  constructor(private deps: LabDeps) {}

  async load() {
    const s = this.deps.store;
    const [caps, truth, exps, trials, fb, findings] = await Promise.all([
      s.listCaptures(),
      s.listGroundTruth(),
      s.listExperiments(),
      s.listTrials(),
      s.listFeedback(),
      s.listFindings(),
    ]);
    for (const c of caps) {
      if (c.status === "capturing") {
        c.status = "failed";
        c.error = "hub restarted during the capture";
        await s.upsertCapture(c);
      }
      this.captures.set(c.id, c);
    }
    for (const g of truth) this.truth.set(g.captureId, g);
    for (const e of exps) {
      if (e.status === "running" || e.status === "approved") {
        e.status = "proposed";
        e.error = "hub restarted while the trials ran; approve again to re-run";
        await s.upsertExperiment(e);
      }
      this.experiments.set(e.id, e);
    }
    this.trials = trials;
    this.feedback = fb;
    this.findings = findings;
    log.info(`research: ${caps.length} capture(s), ${exps.length} experiment(s), ${findings.length} finding(s) (${s.kind})`);
  }

  // ---------- Views ----------

  views(): ExperimentView[] {
    return this.sortedExperiments().map((e) => this.view(e));
  }

  private sortedExperiments() {
    return [...this.experiments.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  private view(e: ExperimentRecord): ExperimentView {
    const child = this.sortedExperiments().find((x) => x.parentId === e.id);
    const finding = this.findings.find((f) => f.experimentId === e.id);
    return {
      id: e.id,
      parentId: e.parentId,
      title: e.title,
      hypothesis: e.hypothesis,
      status: e.status,
      configs: e.configs,
      trials: this.trialsOf(e.id).map((t) => ({
        configIndex: Math.max(0, e.configs.findIndex((c) => configId(c) === t.configId)),
        captureId: t.captureId,
        precision: t.precision,
        recall: t.recall,
        priceExactPct: t.priceExactPct,
        tokens: t.tokens,
        latencyMs: t.latencyMs,
        costUsd: t.costUsd,
        misreads: t.misreads,
        error: t.error,
      })),
      analysis: e.analysis,
      nextProposal: e.nextProposal,
      feedback: this.feedback
        .filter((f) => f.experimentId === e.id)
        .map((f) => ({ id: f.id, kind: f.kind, text: f.text, createdAt: f.createdAt })),
      citesFeedbackIds: e.citesFeedbackIds,
      findingRef: finding?.id ?? null,
      createdAt: e.createdAt,
      papiers: e.papiers,
      papiersError: e.papiersError,
      captureIds: e.captureIds,
      error: e.error,
      supersededBy: e.status === "proposed" && child ? child.id : null,
    };
  }

  private trialsOf(experimentId: string) {
    return this.trials.filter((t) => t.experimentId === experimentId);
  }

  private publish(e: ExperimentRecord) {
    this.deps.broadcast({ type: "research.update", experiment: this.view(e) });
  }

  state(): ResearchState {
    const captures: CaptureView[] = [...this.captures.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((c) => {
        const g = this.truth.get(c.id);
        return {
          id: c.id,
          app: c.app,
          createdAt: c.createdAt,
          status: c.status,
          error: c.error,
          runId: c.runId,
          deviceName: c.deviceName,
          frames: c.frames,
          hasText: !!c.evidenceText,
          candidates: c.candidates,
          groundTruth: g ? { deals: g.deals, labels: g.labels, labeledAt: g.labeledAt } : null,
        };
      });
    return {
      captures,
      findings: this.findings
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((f) => ({ id: f.id, experimentId: f.experimentId, summary: f.summary, papiersRef: f.papiersRef, createdAt: f.createdAt })),
      busy: this.busy,
      models: { ...config.gemini.models },
      store: this.deps.store.kind,
    };
  }

  findingMarkdown(id: string): string | null {
    return this.findings.find((f) => f.id === id)?.markdown ?? null;
  }

  // ---------- Commands ----------

  /** Owner command. Throws UserError for things the owner should fix (shown as a toast). */
  async handle(msg: ResearchMsg): Promise<void> {
    switch (msg.type) {
      case "research.capture":
        return this.startCapture(msg.app);
      case "research.label":
        return this.label(msg.captureId, msg.deals, msg.labels ?? []);
      case "research.propose":
        this.startJob("Research agent is reading Papiers and writing a hypothesis…", () => this.propose(null, null));
        return;
      case "research.feedback":
        return this.onFeedback(msg.experimentId, msg.kind, msg.text);
    }
  }

  private startJob(what: string, job: () => Promise<void>) {
    if (this.busy) throw new UserError(`The research agent is busy: ${this.busy}`);
    this.busy = what;
    log.info(`research: ${what}`);
    void job()
      .catch((e) => log.error(`research job "${what}"`, e))
      .finally(() => {
        this.busy = null;
      });
  }

  // ---------- 1. Live capture ----------

  private async startCapture(app: AppId) {
    if (!CAPTURE_APPS.includes(app)) throw new UserError(`${app} has no deals to capture`);
    if ([...this.captures.values()].some((c) => c.app === app && c.status === "capturing"))
      throw new UserError(`A ${PLAN_INFO[`app:${app}` as PlanId].label} capture is already running`);
    const planId = `app:${app}` as PlanId;
    const info = PLAN_INFO[planId];
    const run = await this.deps.runs.createFixed(`Lab capture: ${info.label} (full-resolution screenshots)`, [planId], CAPTURE_CONFIG);
    const sub = run.subtasks[0];
    const c: CaptureRecord = {
      id: ulid(),
      app,
      createdAt: Date.now(),
      status: sub?.status === "failed" ? "failed" : "capturing",
      error: sub?.status === "failed" ? sub.error : null,
      runId: run.id,
      subtaskId: sub?.id ?? null,
      deviceName: null,
      frames: [],
      evidenceText: null,
      candidates: [],
    };
    this.captures.set(c.id, c);
    await this.deps.store.upsertCapture(c);
    log.info(`research: capture ${c.id} for ${app} via run ${run.id}`);
  }

  /** From RunManager: the device's screenshots are on disk. */
  onEvidence(subtaskId: string, deviceId: string | null, refs: (string | null)[], text: string | null) {
    const c = [...this.captures.values()].find((x) => x.subtaskId === subtaskId && x.status === "capturing");
    if (!c) return;
    c.frames = refs.filter((r): r is string => !!r);
    c.evidenceText = text;
    c.deviceName = deviceId ? this.deps.deviceName(deviceId) : null;
    this.deps.store.upsertCapture(c).catch((e) => log.error("research upsertCapture", e));
  }

  /** From the hub's broadcast: finish captures when their run's subtask ends. */
  onRunUpdate(run: RunView) {
    for (const c of this.captures.values()) {
      if (c.runId !== run.id || c.status !== "capturing") continue;
      const sub = run.subtasks.find((s) => s.id === c.subtaskId) ?? run.subtasks[0];
      if (sub?.status === "failed" || sub?.status === "cancelled" || ((run.status === "failed" || run.status === "cancelled") && sub?.status !== "done")) {
        c.status = "failed";
        c.error = sub?.error ?? run.error ?? "capture failed";
      } else if (sub?.status === "done") {
        if (!c.frames.length) {
          c.status = "failed";
          c.error = "the device sent no screenshots";
        } else {
          c.status = "ready";
          void this.deps.repo
            .listDeals(run.id)
            .then((deals) => {
              c.candidates = deals.map(({ source, title, priceText, conditions, expiresText, url, screenshotRef, confidence }) => ({
                source, title, priceText, conditions, expiresText, url, screenshotRef, confidence,
              }));
              return this.deps.store.upsertCapture(c);
            })
            .catch((e) => log.error("research capture candidates", e));
          log.info(`research: capture ${c.id} ready (${c.frames.length} screenshot(s))`);
          continue;
        }
      } else continue;
      log.info(`research: capture ${c.id} failed: ${c.error}`);
      this.deps.store.upsertCapture(c).catch((e) => log.error("research upsertCapture", e));
    }
  }

  // ---------- 2. Ground truth ----------

  private async label(captureId: string, deals: Deal[], labels: GroundTruthRecord["labels"]) {
    const c = this.captures.get(captureId);
    if (!c) throw new UserError("No such capture");
    if (c.status !== "ready") throw new UserError("This capture has no screenshots to label");
    const source = c.app as DealSource;
    const g: GroundTruthRecord = {
      captureId,
      deals: deals.map((d) => ({ ...d, source })),
      labels,
      labeledBy: "owner",
      labeledAt: Date.now(),
    };
    await this.deps.store.upsertGroundTruth(g);
    this.truth.set(captureId, g);
    log.info(`research: ground truth for ${c.app} capture ${captureId}: ${g.deals.length} deal(s)`);
  }

  /** Newest ready + labeled capture per app. */
  private labeledCaptures(): CaptureRecord[] {
    const best = new Map<string, CaptureRecord>();
    for (const c of this.captures.values()) {
      if (c.status !== "ready" || !this.truth.has(c.id)) continue;
      const cur = best.get(c.app);
      if (!cur || c.createdAt > cur.createdAt) best.set(c.app, c);
    }
    return [...best.values()].sort((a, b) => a.app.localeCompare(b.app));
  }

  // ---------- 3. Hypothesis ----------

  /** Feedback no experiment has cited yet (approvals that started trials are not "to address"). */
  private pendingFeedback(): FeedbackRecord[] {
    const cited = new Set([...this.experiments.values()].flatMap((e) => e.citesFeedbackIds));
    return this.feedback.filter((f) => {
      if (cited.has(f.id)) return false;
      if (f.kind !== "approve") return true;
      const e = this.experiments.get(f.experimentId);
      return e?.status === "analyzed" && this.trialsOf(e.id).length > 0 && this.isLatestApproveAfterAnalysis(f, e);
    });
  }

  private isLatestApproveAfterAnalysis(f: FeedbackRecord, e: ExperimentRecord) {
    const lastTrial = Math.max(0, ...this.trialsOf(e.id).map((t) => t.time));
    return f.createdAt > lastTrial;
  }

  private usageLog(label: string) {
    return (u: Usage) => {
      this.deps.repo
        .appendStep({
          time: Date.now(),
          runId: null,
          subtaskId: null,
          deviceId: null,
          kind: "info",
          detail: { research: label, tier: u.tier },
          tokensIn: u.tokensIn,
          tokensOut: u.tokensOut,
          model: u.model,
        })
        .catch(() => {});
    };
  }

  private async propose(parent: ExperimentRecord | null, revising: ExperimentRecord | null) {
    const parentRec = parent ?? revising ?? this.sortedExperiments().at(-1) ?? null;
    const pending = this.pendingFeedback();
    const draft: ExperimentRecord = {
      id: ulid(),
      parentId: parentRec?.id ?? null,
      title: "Writing a hypothesis…",
      hypothesis: "The research agent is reading Papiers and the earlier results.",
      status: "proposed",
      configs: [],
      captureIds: [],
      papiers: [],
      papiersError: null,
      citesFeedbackIds: [],
      analysis: null,
      nextProposal: null,
      error: null,
      createdAt: Date.now(),
    };
    try {
      const problem = geminiProblem("pro") ?? geminiProblem("lite");
      if (problem) throw new Error(problem);
      const focus =
        pending.map((f) => `${f.kind}: ${f.text}`).join("; ") || parentRec?.nextProposal || parentRec?.hypothesis || RESEARCH_QUESTION;
      const papiers = await gatherPapiers(focus, this.usageLog("queries"));
      const history: PastExperiment[] = this.sortedExperiments()
        .filter((e) => e.configs.length)
        .slice(-4)
        .map((e) => ({
          title: e.title,
          hypothesis: e.hypothesis,
          table: this.trialsOf(e.id).length ? this.table(e) : null,
          analysis: e.analysis,
          nextProposal: e.nextProposal,
        }));
      const p = await proposeExperiment({
        history,
        feedback: pending.map((f) => ({ id: f.id, kind: f.kind, text: f.text, on: this.experiments.get(f.experimentId)?.title ?? "?" })),
        apps: this.labeledCaptures().map((c) => c.app),
        papiers,
        revising: revising ? `${revising.title}: ${revising.hypothesis}` : null,
        onUsage: this.usageLog("propose"),
      });
      Object.assign(draft, {
        title: p.title,
        hypothesis: p.hypothesis,
        configs: p.configs,
        papiers: p.papiers,
        papiersError: papiers.error,
        citesFeedbackIds: p.citesFeedbackIds,
      });
      log.info(`research: proposed "${p.title}" (${p.configs.length} configs, cites ${p.papiers.length} Papiers item(s), ${p.citesFeedbackIds.length} feedback)`);
    } catch (e) {
      draft.title = "Proposal failed";
      draft.hypothesis = "The research agent could not write a hypothesis.";
      draft.error = (e as Error).message;
      log.error("research propose", e);
    }
    this.experiments.set(draft.id, draft);
    await this.deps.store.upsertExperiment(draft);
    this.publish(draft);
    if (revising) this.publish(revising);
  }

  // ---------- 4. Feedback ----------

  private async onFeedback(experimentId: string, kind: FeedbackRecord["kind"], text: string) {
    const e = this.experiments.get(experimentId);
    if (!e) throw new UserError("No such experiment");
    const t = text.trim();
    if ((kind === "flag" || kind === "redirect") && !t) throw new UserError(`Say what to ${kind === "flag" ? "flag" : "test instead"}`);
    const superseded = this.view(e).supersededBy;
    if (superseded) throw new UserError("This proposal was replaced after a redirect; act on the newer one");
    if (kind === "approve" && e.status === "proposed" && e.error && !e.configs.length) throw new UserError("This proposal failed; propose again");
    if (kind === "approve" && e.status === "proposed" && !this.labeledCaptures().length)
      throw new UserError("Label at least one capture before running trials");
    if (e.status === "running" || e.status === "approved") {
      if (kind !== "flag") throw new UserError("Trials are running; wait for the analysis");
    }
    if (kind !== "flag" && this.busy) throw new UserError(`The research agent is busy: ${this.busy}`);

    const f: FeedbackRecord = {
      id: ulid(),
      experimentId,
      kind,
      text: t || (kind === "approve" ? (e.status === "proposed" ? "Approved: run the trials" : `Approved the proposal: ${e.nextProposal ?? ""}`) : ""),
      createdAt: Date.now(),
    };
    await this.deps.store.insertFeedback(f);
    this.feedback.push(f);
    this.publish(e);
    log.info(`research: ${kind} on "${e.title}": ${f.text}`);

    if (e.status === "proposed") {
      if (kind === "approve") this.startJob(`Running trials for "${e.title}"…`, () => this.runTrials(e));
      else if (kind === "redirect") this.startJob("Research agent is revising the proposal…", () => this.propose(null, e));
    } else if (e.status === "analyzed" && kind !== "flag") {
      this.startJob("Research agent is writing the next hypothesis…", () => this.propose(e, null));
    }
  }

  // ---------- 5. Trials ----------

  private async runTrials(e: ExperimentRecord) {
    const captures = this.labeledCaptures();
    e.status = "running";
    e.error = null;
    e.analysis = null;
    e.nextProposal = null;
    e.captureIds = captures.map((c) => c.id);
    this.trials = this.trials.filter((t) => t.experimentId !== e.id);
    await this.deps.store.clearTrials(e.id);
    await this.deps.store.upsertExperiment(e);
    this.publish(e);

    try {
      const frames = new Map<string, Buffer[]>();
      for (const c of captures) frames.set(c.id, await Promise.all(c.frames.map((ref) => readFile(join(config.dataDir, ref)))));

      let first = true;
      for (const cfg of e.configs) {
        const cid = await this.deps.store.ensureConfig(cfg);
        for (const c of captures) {
          if (!first) await sleep(TRIAL_GAP_MS);
          first = false;
          const t = await this.trial(e, cfg, cid, c, frames.get(c.id)!);
          this.trials.push(t);
          await this.deps.store.insertTrial(t);
          this.publish(e);
        }
      }

      const ok = this.trialsOf(e.id).filter((t) => !t.error);
      if (!ok.length) throw new Error(`every trial failed: ${this.trialsOf(e.id)[0]?.error ?? "?"}`);
      const misreads = this.misreadLines(e).slice(0, 40).join("\n");
      const flags = this.feedback.filter((f) => f.experimentId === e.id && f.kind === "flag").map((f) => f.text);
      const a = await analyzeExperiment({
        title: e.title,
        hypothesis: e.hypothesis,
        table: this.table(e),
        misreads,
        flags,
        onUsage: this.usageLog("analyze"),
      });
      e.analysis =
        `Verdict: ${a.verdict}.\n\n${a.analysis}` + (a.keyMisreads.length ? `\n\nKey misreads:\n${a.keyMisreads.map((m) => `- ${m}`).join("\n")}` : "");
      e.nextProposal = a.nextProposal;
      e.status = "analyzed";
      await this.deps.store.upsertExperiment(e);
      await this.saveFinding(e, a.findingSummary);
      log.info(`research: analyzed "${e.title}": ${a.verdict}`);
    } catch (err) {
      e.status = this.trialsOf(e.id).length ? "analyzed" : "proposed";
      e.error = `Trials stopped: ${(err as Error).message}`;
      await this.deps.store.upsertExperiment(e);
      log.error("research trials", err);
    }
    this.publish(e);
  }

  private async trial(e: ExperimentRecord, cfg: AgentConfig, cid: string, c: CaptureRecord, frames: Buffer[]): Promise<TrialRecord> {
    const base = { time: Date.now(), experimentId: e.id, configId: cid, config: cfg, captureId: c.id };
    const truth = this.truth.get(c.id)!.deals;
    let tokensIn = 0;
    let tokensOut = 0;
    let costUsd = 0;
    const started = Date.now();
    try {
      const images = frames.map((b) => scaleJpeg(b, cfg.screenshotScale).data.toString("base64"));
      const info = PLAN_INFO[`app:${c.app}` as PlanId];
      const deals = await extractDeals({
        source: c.app as DealSource,
        label: info.label,
        goal: info.goal,
        images,
        text: cfg.mode === "recipe" ? c.evidenceText : null,
        imageRefs: c.frames,
        config: cfg,
        onUsage: (u) => {
          tokensIn += u.tokensIn;
          tokensOut += u.tokensOut;
          costUsd += burnFor(priceTier(u.model, u.tier), u.tokensIn, u.tokensOut).costUsd;
          this.usageLog(`trial ${cid}`)(u);
        },
      });
      const s = scoreDeals(info.label, deals, truth);
      return {
        ...base,
        precision: s.precision,
        recall: s.recall,
        priceExactPct: s.priceExactPct,
        tokens: tokensIn + tokensOut,
        latencyMs: Date.now() - started,
        costUsd,
        deals,
        misreads: s.misreads,
        error: null,
      };
    } catch (err) {
      return {
        ...base,
        precision: 0,
        recall: 0,
        priceExactPct: 0,
        tokens: tokensIn + tokensOut,
        latencyMs: Date.now() - started,
        costUsd,
        deals: [],
        misreads: [],
        error: (err as Error).message,
      };
    }
  }

  // ---------- 6. Analysis table + finding ----------

  private configLabel(c: AgentConfig) {
    return `${c.model} · ${Math.round(c.screenshotScale * 100)} % · ${c.mode}`;
  }

  /** Markdown table: mean per config over the captures that did not error. */
  table(e: ExperimentRecord): string {
    const rows = e.configs.map((cfg) => {
      const ts = this.trialsOf(e.id).filter((t) => t.configId === configId(cfg));
      const ok = ts.filter((t) => !t.error);
      const mean = (f: (t: TrialRecord) => number) => (ok.length ? ok.reduce((s, t) => s + f(t), 0) / ok.length : NaN);
      const pct = (n: number) => (Number.isNaN(n) ? "–" : `${Math.round(n * 100)} %`);
      const errs = ts.length - ok.length;
      return (
        `| ${this.configLabel(cfg)} | ${pct(mean((t) => t.precision))} | ${pct(mean((t) => t.recall))} | ${pct(mean((t) => t.priceExactPct))} | ` +
        `${Number.isNaN(mean((t) => t.tokens)) ? "–" : Math.round(mean((t) => t.tokens))} | ${Number.isNaN(mean((t) => t.latencyMs)) ? "–" : (mean((t) => t.latencyMs) / 1000).toFixed(1) + " s"} | ` +
        `${Number.isNaN(mean((t) => t.costUsd)) ? "–" : "$" + mean((t) => t.costUsd).toFixed(5)} | ${ok.length}/${ts.length}${errs ? ` (${errs} failed)` : ""} |`
      );
    });
    return [
      "| Config (model · scale · mode) | Precision | Recall | Exact price | Tokens | Latency | Cost / capture | Captures |",
      "|---|---|---|---|---|---|---|---|",
      ...rows,
    ].join("\n");
  }

  private misreadLines(e: ExperimentRecord): string[] {
    const lines: string[] = [];
    for (const t of this.trialsOf(e.id)) {
      const who = this.configLabel(t.config);
      if (t.error) lines.push(`- ${who}: trial failed (${t.error})`);
      for (const m of t.misreads) {
        if (m.kind === "price") lines.push(`- ${who} on ${m.app}: read "${m.got ?? "no price"}" for "${m.title}" (true price "${m.expected ?? "none"}")`);
        else if (m.kind === "missed") lines.push(`- ${who} on ${m.app}: missed "${m.title}" (${m.expected ?? "no price"})`);
        else lines.push(`- ${who} on ${m.app}: reported a deal that is not there: "${m.title}" (${m.got ?? "no price"})`);
      }
    }
    return lines;
  }

  private async saveFinding(e: ExperimentRecord, summary: string) {
    const f: FindingRecord = {
      id: ulid(),
      experimentId: e.id,
      summary,
      papiersRef: e.papiers.map((p) => p.ref).join(", ") || null,
      markdown: "",
      createdAt: Date.now(),
    };
    f.markdown = this.markdown(e, f);
    await this.deps.store.insertFinding(f);
    this.findings.push(f);
  }

  private markdown(e: ExperimentRecord, f: FindingRecord): string {
    const fb = (ids: string[]) => this.feedback.filter((x) => ids.includes(x.id));
    const caps = e.captureIds.map((id) => this.captures.get(id)).filter((c): c is CaptureRecord => !!c);
    const parent = e.parentId ? this.experiments.get(e.parentId) : null;
    const date = new Date(f.createdAt).toISOString().replace("T", " ").slice(0, 16) + " UTC";
    return [
      `# ${e.title}`,
      "",
      `Co2lab lab notebook · finding ${f.id} · experiment ${e.id} · ${date}`,
      "",
      `**Research question:** ${RESEARCH_QUESTION}`,
      "",
      `## Finding`,
      "",
      f.summary,
      "",
      `## Hypothesis`,
      "",
      e.hypothesis,
      "",
      parent ? `Follows experiment "${parent.title}" (${parent.id}).\n` : "",
      ...(e.citesFeedbackIds.length
        ? ["**Owner feedback this experiment answers:**", "", ...fb(e.citesFeedbackIds).map((x) => `- ${x.kind}: "${x.text}"`), ""]
        : []),
      ...(e.papiers.length
        ? ["**Context read from Papiers:**", "", ...e.papiers.map((p) => `- \`${p.ref}\` ${p.title ?? ""}: ${p.use}\n  > ${p.excerpt.replace(/\s+/g, " ").slice(0, 300)}`), ""]
        : [`Papiers context: none (${e.papiersError ?? "not used"}).`, ""]),
      `## Method`,
      "",
      `One live capture per app from the phone, replayed through the hub's deal extraction with each configuration. ${modelsNote()} ` +
        "Mode recipe = screenshots plus the accessibility text the recipe collected; vision = screenshots only. " +
        "Ground truth was labeled by the owner in the Lab tab.",
      "",
      ...caps.map(
        (c) =>
          `- ${c.app}: capture ${c.id} (${new Date(c.createdAt).toISOString().slice(0, 16)} UTC, ${c.frames.length} screenshot(s), ${c.deviceName ?? "phone"}), ${this.truth.get(c.id)?.deals.length ?? 0} true deal(s)`,
      ),
      "",
      `## Results`,
      "",
      this.table(e),
      "",
      `## Misreads`,
      "",
      ...(this.misreadLines(e).slice(0, 60).length ? this.misreadLines(e).slice(0, 60) : ["None."]),
      "",
      `## Analysis`,
      "",
      e.analysis ?? "",
      "",
      `## Next`,
      "",
      e.nextProposal ?? "",
      "",
    ].join("\n");
  }
}

/** The free tier maps "pro" to the Flash model; price by the model that actually ran. */
function priceTier(model: string, tier: ModelTier): ModelTier {
  const m = config.gemini.models;
  if (model === m.lite) return "lite";
  if (model === m.flash) return "flash";
  return tier;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
