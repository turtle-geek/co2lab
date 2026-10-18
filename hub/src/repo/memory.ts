import type { TelemetryPoint } from "@co2lab/shared";
import type {
  DealRecord,
  DeviceRecord,
  Repository,
  RunRecord,
  StepRow,
  SubtaskRecord,
  TelemetryRow,
  ViewerLinkRecord,
} from "./types.js";

const MAX_ROWS = 5_000; // ring-buffer cap for time-series rows kept in memory

export class MemoryRepository implements Repository {
  readonly kind = "memory";
  private devices = new Map<string, DeviceRecord>();
  private runs = new Map<string, RunRecord>();
  private subtasks = new Map<string, SubtaskRecord>();
  private deals: DealRecord[] = [];
  private viewerLinks = new Map<string, ViewerLinkRecord>();
  readonly telemetry: TelemetryRow[] = [];
  readonly steps: StepRow[] = [];

  async upsertDevice(d: DeviceRecord) {
    this.devices.set(d.id, { ...d, capabilities: [...d.capabilities] });
  }
  async listDevices() {
    return [...this.devices.values()].map((d) => ({ ...d }));
  }

  async appendTelemetry(t: TelemetryRow) {
    this.telemetry.push(t);
    if (this.telemetry.length > MAX_ROWS) this.telemetry.splice(0, this.telemetry.length - MAX_ROWS);
  }
  async telemetryHistory(deviceId: string, sinceMs: number, bucketMs: number): Promise<TelemetryPoint[]> {
    const buckets = new Map<number, TelemetryRow[]>();
    for (const r of this.telemetry) {
      if (r.deviceId !== deviceId || r.time < sinceMs || !r.online) continue;
      const b = Math.floor(r.time / bucketMs) * bucketMs;
      buckets.set(b, [...(buckets.get(b) ?? []), r]);
    }
    const avg = (xs: (number | null)[]) => {
      const v = xs.filter((x): x is number => x !== null);
      return v.length ? v.reduce((a, c) => a + c, 0) / v.length : null;
    };
    return [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([time, rs]) => ({ time, batteryPct: avg(rs.map((r) => r.batteryPct)), tempC: avg(rs.map((r) => r.tempC)), charging: rs.some((r) => r.charging) }));
  }

  async appendStep(s: StepRow) {
    this.steps.push(s);
    if (this.steps.length > MAX_ROWS) this.steps.splice(0, this.steps.length - MAX_ROWS);
  }

  async upsertRun(r: RunRecord) {
    this.runs.set(r.id, structuredClone(r));
  }
  async upsertSubtask(s: SubtaskRecord) {
    this.subtasks.set(s.id, { ...s });
  }
  async listRecentRuns(limit: number) {
    const runs = [...this.runs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
    return runs.map((run) => ({
      run: structuredClone(run),
      subtasks: [...this.subtasks.values()]
        .filter((s) => s.runId === run.id)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((s) => ({ ...s })),
    }));
  }
  async getRunByClientRunId(clientRunId: string) {
    for (const r of this.runs.values()) if (r.clientRunId === clientRunId) return structuredClone(r);
    return null;
  }
  async failUnfinishedRuns(reason: string, at: number) {
    let n = 0;
    for (const r of this.runs.values()) {
      if (r.status === "planning" || r.status === "running" || r.status === "merging") {
        r.status = "failed";
        r.error = reason;
        r.finishedAt = at;
        n++;
      }
    }
    return n;
  }

  async insertDeals(deals: DealRecord[]) {
    this.deals.push(...deals.map((d) => ({ ...d })));
  }
  async listDeals(runId: string) {
    return this.deals.filter((d) => d.runId === runId).map((d) => ({ ...d }));
  }

  async upsertViewerLink(v: ViewerLinkRecord) {
    this.viewerLinks.set(v.tokenHash, { ...v });
  }
  async getViewerLink(tokenHash: string) {
    const v = this.viewerLinks.get(tokenHash);
    return v ? { ...v } : null;
  }
}
