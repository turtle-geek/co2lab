// Postgres (Tiger Data) storage for Research Mode: config, capture, ground_truth, experiment,
// trial (hypertable), feedback, finding. Tables and T7 columns are in db/schema.sql.
// Research writes are few, so each one is awaited directly instead of going through the run queue.

import type pg from "pg";
import type { AgentConfig } from "@co2lab/shared";
import {
  configId,
  type CaptureRecord,
  type ExperimentRecord,
  type FeedbackRecord,
  type FindingRecord,
  type GroundTruthRecord,
  type ResearchStore,
  type TrialRecord,
} from "../research/store.js";

const ts = (ms: number | null) => (ms === null ? null : new Date(ms));
const ms = (d: Date | null) => (d === null ? null : d.getTime());
const json = (v: unknown) => JSON.stringify(v);

export class PgResearchStore implements ResearchStore {
  readonly kind = "postgres";
  private knownConfigs = new Set<string>();

  constructor(private pool: pg.Pool) {}

  private q(text: string, values: unknown[] = []) {
    return this.pool.query(text, values);
  }

  async upsertCapture(c: CaptureRecord) {
    await this.q(
      `insert into capture (id, app, created_at, frames, status, error, run_id, subtask_id, device_name, evidence_text, candidates)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (id) do update set frames = $4, status = $5, error = $6, run_id = $7, subtask_id = $8,
         device_name = $9, evidence_text = $10, candidates = $11`,
      [c.id, c.app, ts(c.createdAt), c.frames, c.status, c.error, c.runId, c.subtaskId, c.deviceName, c.evidenceText, json(c.candidates)],
    );
  }

  async listCaptures(): Promise<CaptureRecord[]> {
    const { rows } = await this.q(`select * from capture order by created_at`);
    return rows.map((r) => ({
      id: r.id,
      app: r.app,
      createdAt: ms(r.created_at)!,
      status: r.status,
      error: r.error,
      runId: r.run_id,
      subtaskId: r.subtask_id,
      deviceName: r.device_name,
      frames: r.frames,
      evidenceText: r.evidence_text,
      candidates: r.candidates,
    }));
  }

  async upsertGroundTruth(g: GroundTruthRecord) {
    await this.q(
      `insert into ground_truth (capture_id, deals, labels, labeled_by, labeled_at) values ($1, $2, $3, $4, $5)
       on conflict (capture_id) do update set deals = $2, labels = $3, labeled_by = $4, labeled_at = $5`,
      [g.captureId, json(g.deals), json(g.labels), g.labeledBy, ts(g.labeledAt)],
    );
  }

  async listGroundTruth(): Promise<GroundTruthRecord[]> {
    const { rows } = await this.q(`select * from ground_truth`);
    return rows.map((r) => ({
      captureId: r.capture_id,
      deals: r.deals,
      labels: r.labels,
      labeledBy: r.labeled_by,
      labeledAt: ms(r.labeled_at)!,
    }));
  }

  async upsertExperiment(e: ExperimentRecord) {
    await this.q(
      `insert into experiment (id, hypothesis, status, parent_id, cites_feedback_ids, created_at, title, configs, capture_ids,
         papiers, papiers_error, analysis, next_proposal, error)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       on conflict (id) do update set hypothesis = $2, status = $3, cites_feedback_ids = $5, title = $7, configs = $8,
         capture_ids = $9, papiers = $10, papiers_error = $11, analysis = $12, next_proposal = $13, error = $14`,
      [
        e.id,
        e.hypothesis,
        e.status,
        e.parentId,
        e.citesFeedbackIds,
        ts(e.createdAt),
        e.title,
        json(e.configs),
        e.captureIds,
        json(e.papiers),
        e.papiersError,
        e.analysis,
        e.nextProposal,
        e.error,
      ],
    );
  }

  async listExperiments(): Promise<ExperimentRecord[]> {
    const { rows } = await this.q(`select * from experiment order by created_at`);
    return rows.map((r) => ({
      id: r.id,
      parentId: r.parent_id,
      title: r.title ?? "",
      hypothesis: r.hypothesis,
      status: r.status,
      configs: r.configs,
      captureIds: r.capture_ids,
      papiers: r.papiers,
      papiersError: r.papiers_error,
      citesFeedbackIds: r.cites_feedback_ids,
      analysis: r.analysis,
      nextProposal: r.next_proposal,
      error: r.error,
      createdAt: ms(r.created_at)!,
    }));
  }

  async ensureConfig(c: AgentConfig) {
    const id = configId(c);
    if (!this.knownConfigs.has(id)) {
      await this.q(
        `insert into config (id, model, screenshot_scale, mode) values ($1, $2, $3, $4) on conflict (id) do nothing`,
        [id, c.model, c.screenshotScale, c.mode],
      );
      this.knownConfigs.add(id);
    }
    return id;
  }

  async insertTrial(t: TrialRecord) {
    await this.q(
      `insert into trial (time, experiment_id, config_id, capture_id, precision, recall, price_exact_pct, tokens, latency_ms,
         cost_usd, config, deals, misreads, error)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        ts(t.time),
        t.experimentId,
        t.configId,
        t.captureId,
        t.precision,
        t.recall,
        t.priceExactPct,
        t.tokens,
        t.latencyMs,
        t.costUsd,
        json(t.config),
        json(t.deals),
        json(t.misreads),
        t.error,
      ],
    );
  }

  async clearTrials(experimentId: string) {
    await this.q(`delete from trial where experiment_id = $1`, [experimentId]);
  }

  async listTrials(): Promise<TrialRecord[]> {
    const { rows } = await this.q(`select * from trial order by time`);
    return rows.map((r) => ({
      time: ms(r.time)!,
      experimentId: r.experiment_id,
      configId: r.config_id,
      config: r.config,
      captureId: r.capture_id,
      precision: r.precision,
      recall: r.recall,
      priceExactPct: r.price_exact_pct,
      tokens: r.tokens,
      latencyMs: r.latency_ms,
      costUsd: r.cost_usd,
      deals: r.deals ?? [],
      misreads: r.misreads ?? [],
      error: r.error,
    }));
  }

  async insertFeedback(f: FeedbackRecord) {
    await this.q(`insert into feedback (id, experiment_id, kind, text, created_at) values ($1, $2, $3, $4, $5)`, [
      f.id,
      f.experimentId,
      f.kind,
      f.text,
      ts(f.createdAt),
    ]);
  }

  async listFeedback(): Promise<FeedbackRecord[]> {
    const { rows } = await this.q(`select * from feedback order by created_at`);
    return rows.map((r) => ({ id: r.id, experimentId: r.experiment_id, kind: r.kind, text: r.text, createdAt: ms(r.created_at)! }));
  }

  async insertFinding(f: FindingRecord) {
    await this.q(
      `insert into finding (id, experiment_id, summary, papiers_ref, markdown, created_at) values ($1, $2, $3, $4, $5, $6)`,
      [f.id, f.experimentId, f.summary, f.papiersRef, f.markdown, ts(f.createdAt)],
    );
  }

  async listFindings(): Promise<FindingRecord[]> {
    const { rows } = await this.q(`select * from finding order by created_at`);
    return rows.map((r) => ({
      id: r.id,
      experimentId: r.experiment_id,
      summary: r.summary,
      papiersRef: r.papiers_ref,
      markdown: r.markdown ?? "",
      createdAt: ms(r.created_at)!,
    }));
  }
}
