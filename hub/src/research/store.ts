// Storage for Research Mode (SPEC §4.5, §6). Postgres (Tiger Data) lives in hub/src/db/research-pg.ts;
// the in-memory store below is used when the hub runs without DATABASE_URL.

import type { AgentConfig, AppId, Deal, LabelItem, Misread, PapiersCitation } from "@co2lab/shared";

export type CaptureStatus = "capturing" | "ready" | "failed";
export type ExperimentStatus = "proposed" | "approved" | "running" | "analyzed";
export type FeedbackKind = "flag" | "approve" | "redirect";

export interface CaptureRecord {
  id: string;
  app: AppId;
  createdAt: number;
  status: CaptureStatus;
  error: string | null;
  runId: string | null;
  subtaskId: string | null;
  deviceName: string | null;
  /** Hub evidence refs, "frames/<file>.jpg", full resolution. */
  frames: string[];
  /** Accessibility text the recipe captured with the screenshots. */
  evidenceText: string | null;
  /** Deals the live run extracted; the starting point for labeling. */
  candidates: Deal[];
}

export interface GroundTruthRecord {
  captureId: string;
  deals: Deal[];
  labels: LabelItem[];
  labeledBy: string;
  labeledAt: number;
}

export interface ExperimentRecord {
  id: string;
  parentId: string | null;
  title: string;
  hypothesis: string;
  status: ExperimentStatus;
  configs: AgentConfig[];
  captureIds: string[];
  papiers: PapiersCitation[];
  papiersError: string | null;
  citesFeedbackIds: string[];
  analysis: string | null;
  nextProposal: string | null;
  error: string | null;
  createdAt: number;
}

export interface TrialRecord {
  time: number;
  experimentId: string;
  configId: string;
  config: AgentConfig;
  captureId: string;
  precision: number;
  recall: number;
  priceExactPct: number;
  tokens: number;
  latencyMs: number;
  costUsd: number;
  deals: Deal[];
  misreads: Misread[];
  error: string | null;
}

export interface FeedbackRecord {
  id: string;
  experimentId: string;
  kind: FeedbackKind;
  text: string;
  createdAt: number;
}

export interface FindingRecord {
  id: string;
  experimentId: string;
  summary: string;
  papiersRef: string | null;
  markdown: string;
  createdAt: number;
}

export interface ResearchStore {
  readonly kind: string;
  upsertCapture(c: CaptureRecord): Promise<void>;
  listCaptures(): Promise<CaptureRecord[]>;
  upsertGroundTruth(g: GroundTruthRecord): Promise<void>;
  listGroundTruth(): Promise<GroundTruthRecord[]>;
  upsertExperiment(e: ExperimentRecord): Promise<void>;
  listExperiments(): Promise<ExperimentRecord[]>;
  /** Stable id per (model, scale, mode); creates the config row if needed. */
  ensureConfig(c: AgentConfig): Promise<string>;
  insertTrial(t: TrialRecord): Promise<void>;
  /** Deletes earlier trials of an experiment (a re-run replaces them). */
  clearTrials(experimentId: string): Promise<void>;
  listTrials(): Promise<TrialRecord[]>;
  insertFeedback(f: FeedbackRecord): Promise<void>;
  listFeedback(): Promise<FeedbackRecord[]>;
  insertFinding(f: FindingRecord): Promise<void>;
  listFindings(): Promise<FindingRecord[]>;
}

export const configId = (c: AgentConfig) => `${c.model}-${Math.round(c.screenshotScale * 100)}-${c.mode}`;

export class MemoryResearchStore implements ResearchStore {
  readonly kind = "memory";
  private captures = new Map<string, CaptureRecord>();
  private truth = new Map<string, GroundTruthRecord>();
  private experiments = new Map<string, ExperimentRecord>();
  private trials: TrialRecord[] = [];
  private feedback: FeedbackRecord[] = [];
  private findings: FindingRecord[] = [];

  async upsertCapture(c: CaptureRecord) {
    this.captures.set(c.id, structuredClone(c));
  }
  async listCaptures() {
    return [...this.captures.values()].map((c) => structuredClone(c));
  }
  async upsertGroundTruth(g: GroundTruthRecord) {
    this.truth.set(g.captureId, structuredClone(g));
  }
  async listGroundTruth() {
    return [...this.truth.values()].map((g) => structuredClone(g));
  }
  async upsertExperiment(e: ExperimentRecord) {
    this.experiments.set(e.id, structuredClone(e));
  }
  async listExperiments() {
    return [...this.experiments.values()].map((e) => structuredClone(e));
  }
  async ensureConfig(c: AgentConfig) {
    return configId(c);
  }
  async insertTrial(t: TrialRecord) {
    this.trials.push(structuredClone(t));
  }
  async clearTrials(experimentId: string) {
    this.trials = this.trials.filter((t) => t.experimentId !== experimentId);
  }
  async listTrials() {
    return this.trials.map((t) => structuredClone(t));
  }
  async insertFeedback(f: FeedbackRecord) {
    this.feedback.push({ ...f });
  }
  async listFeedback() {
    return this.feedback.map((f) => ({ ...f }));
  }
  async insertFinding(f: FindingRecord) {
    this.findings.push({ ...f });
  }
  async listFindings() {
    return this.findings.map((f) => ({ ...f }));
  }
}
