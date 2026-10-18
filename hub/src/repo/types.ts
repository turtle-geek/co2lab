// Storage contract for the hub. memory.ts implements it now; T6 adds a Postgres
// implementation under hub/src/db/ and swaps it in via createRepository() in index.ts.
// Runtime-only state (sockets, last heartbeat, latest frame) is NOT stored here.

import type { AgentConfig, Burn, Capability, Deal, DealSource, DeviceKind, RankedDeal, RunAnswer, StepKind } from "@co2lab/shared";

export interface DeviceRecord {
  id: string;
  name: string;
  kind: DeviceKind;
  capabilities: Capability[];
  tokenHash: string;
  createdAt: number;
  revokedAt: number | null;
}

export interface TelemetryRow {
  time: number;
  deviceId: string;
  batteryPct: number | null;
  charging: boolean | null;
  tempC: number | null;
  cpuPct: number | null;
  online: boolean;
}

export type RunStatus = "planning" | "running" | "merging" | "done" | "failed" | "cancelled";

export interface RunRecord {
  id: string;
  clientRunId: string;
  prompt: string;
  status: RunStatus;
  config: AgentConfig;
  ranked: RankedDeal[] | null;
  /** General-agent runs (P4): the composed answer. */
  answer?: RunAnswer | null;
  burn: Burn;
  error: string | null;
  createdAt: number;
  finishedAt: number | null;
}

export type SubtaskStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface SubtaskRecord {
  id: string;
  runId: string;
  capability: Capability;
  source: DealSource | "agent";
  label: string;
  goal: string;
  status: SubtaskStatus;
  deviceId: string | null;
  attempt: number;
  error: string | null;
  dealCount: number;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface DealRecord extends Deal {
  id: string;
  runId: string;
  subtaskId: string;
  deviceId: string | null;
}

export interface StepRow {
  time: number;
  subtaskId: string | null;
  runId: string | null;
  deviceId: string | null;
  kind: StepKind | "plan" | "merge" | "proxy";
  detail: Record<string, unknown>;
  tokensIn: number;
  tokensOut: number;
  model: string | null;
}

export interface ViewerLinkRecord {
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
}

export interface Repository {
  readonly kind: string;

  upsertDevice(d: DeviceRecord): Promise<void>;
  listDevices(): Promise<DeviceRecord[]>;

  appendTelemetry(t: TelemetryRow): Promise<void>;
  appendStep(s: StepRow): Promise<void>;

  upsertRun(r: RunRecord): Promise<void>;
  upsertSubtask(s: SubtaskRecord): Promise<void>;
  /** Most recent runs first, with their subtasks. */
  listRecentRuns(limit: number): Promise<{ run: RunRecord; subtasks: SubtaskRecord[] }[]>;
  getRunByClientRunId(clientRunId: string): Promise<RunRecord | null>;
  /** Marks runs left in planning/running/merging as failed (used at hub start). Returns how many. */
  failUnfinishedRuns(reason: string, at: number): Promise<number>;

  insertDeals(deals: DealRecord[]): Promise<void>;
  listDeals(runId: string): Promise<DealRecord[]>;

  upsertViewerLink(v: ViewerLinkRecord): Promise<void>;
  getViewerLink(tokenHash: string): Promise<ViewerLinkRecord | null>;

  /** Finishes pending writes and releases connections (on shutdown). */
  close?(): Promise<void>;
}
