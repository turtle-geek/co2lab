// Postgres (Tiger Data) implementation of the hub Repository. Selected by createRepository()
// when DATABASE_URL is set. Writes go through one ordered queue so a subtask never lands before
// its run, and repeated upserts of the same row that are still waiting collapse into one.

import type { TelemetryPoint } from "@co2lab/shared";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type pg from "pg";
import { ROOT_DIR } from "../config.js";
import { log } from "../log.js";
import type {
  DealRecord,
  DeviceRecord,
  Repository,
  RunRecord,
  StepRow,
  SubtaskRecord,
  TelemetryRow,
  ViewerLinkRecord,
} from "../repo/types.js";
import { createPool } from "./connect.js";

export const SCHEMA_PATH = resolve(ROOT_DIR, "db", "schema.sql");
const TELEMETRY_EVERY_MS = 10_000; // per device; online/offline changes are always written

const ts = (ms: number | null) => (ms === null ? null : new Date(ms));
const ms = (d: Date | null) => (d === null ? null : d.getTime());

type Job = () => Promise<void>;

export class PgRepository implements Repository {
  readonly kind = "postgres";
  private queue: { key: string | null; job: Job }[] = [];
  private pendingByKey = new Map<string, { key: string | null; job: Job }>();
  private draining: Promise<void> | null = null;
  private lastTelemetry = new Map<string, { time: number; online: boolean }>();

  private constructor(readonly pool: pg.Pool) {}

  static async open(): Promise<PgRepository> {
    const pool = createPool();
    pool.on("error", (e) => log.error("postgres pool", e));
    const repo = new PgRepository(pool);
    await pool.query(await readFile(SCHEMA_PATH, "utf8"));
    return repo;
  }

  async close() {
    await this.flush();
    await this.pool.end();
  }

  // ---------- Write queue ----------

  /** Queues a write. With a key, a still-waiting write for the same key is replaced. */
  private enqueue(key: string | null, job: Job): Promise<void> {
    if (key) {
      const waiting = this.pendingByKey.get(key);
      if (waiting) {
        waiting.job = job;
        return this.flush();
      }
    }
    const item = { key, job };
    this.queue.push(item);
    if (key) this.pendingByKey.set(key, item);
    return this.flush();
  }

  /** Resolves when everything queued so far is written. Failed writes are logged, not retried. */
  private flush(): Promise<void> {
    if (!this.queue.length) return this.draining ?? Promise.resolve();
    if (!this.draining) {
      this.draining = (async () => {
        await Promise.resolve(); // let the assignment above happen before the loop can finish
        while (this.queue.length) {
          const item = this.queue.shift()!;
          if (item.key) this.pendingByKey.delete(item.key);
          try {
            await item.job();
          } catch (e) {
            log.error(`postgres write${item.key ? ` ${item.key}` : ""}`, e);
          }
        }
        this.draining = null;
      })();
    }
    return this.draining;
  }

  private q(text: string, values: unknown[]) {
    return this.pool.query(text, values);
  }

  // ---------- Devices ----------

  upsertDevice(d: DeviceRecord) {
    const v = [d.id, d.name, d.kind, d.capabilities, d.tokenHash, ts(d.createdAt), ts(d.revokedAt)];
    return this.enqueue(`device:${d.id}`, async () => {
      await this.q(
        `insert into device (id, name, kind, capabilities, token_hash, created_at, revoked_at)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (id) do update set name = $2, kind = $3, capabilities = $4, token_hash = $5, revoked_at = $7`,
        v,
      );
    });
  }

  async listDevices(): Promise<DeviceRecord[]> {
    await this.flush();
    const { rows } = await this.q(`select * from device order by created_at`, []);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      capabilities: r.capabilities,
      tokenHash: r.token_hash,
      createdAt: ms(r.created_at)!,
      revokedAt: ms(r.revoked_at),
    }));
  }

  // ---------- Time series ----------

  async appendTelemetry(t: TelemetryRow) {
    const last = this.lastTelemetry.get(t.deviceId);
    if (last && last.online === t.online && t.time - last.time < TELEMETRY_EVERY_MS) return;
    this.lastTelemetry.set(t.deviceId, { time: t.time, online: t.online });
    const v = [ts(t.time), t.deviceId, t.batteryPct, t.charging, t.tempC, t.cpuPct, t.online];
    return this.enqueue(null, async () => {
      await this.q(
        `insert into telemetry (time, device_id, battery_pct, charging, temp_c, cpu_pct, online) values ($1, $2, $3, $4, $5, $6, $7)`,
        v,
      );
    });
  }

  async aiUsage(sinceMs: number, runId: string | null = null) {
    await this.flush();
    const where = `time >= $1 and tokens_in + tokens_out > 0`;
    const { rows } = await this.q(
      `select device_id, kind, coalesce(detail->>'tier', 'flash') as tier, count(*)::int as calls,
              sum(tokens_in)::float8 as tin, sum(tokens_out)::float8 as tout,
              sum(coalesce((detail->>'imageTokens')::int, 0))::float8 as timg
         from agent_step where ${where}${runId ? " and run_id = $2" : ""} group by 1, 2, 3`,
      runId ? [ts(sinceMs), runId] : [ts(sinceMs)],
    );
    const { rows: perRun } = await this.q(
      `select s.run_id, coalesce(s.detail->>'tier', 'flash') as tier, min(s.time) as first_at, count(*)::int as calls,
              sum(s.tokens_in)::float8 as tin, sum(s.tokens_out)::float8 as tout, r.prompt, r.status
         from agent_step s left join run r on r.id = s.run_id
        where s.time >= $1 and s.tokens_in + s.tokens_out > 0 and s.run_id is not null
        group by s.run_id, 2, r.prompt, r.status`,
      [ts(sinceMs)],
    );
    return {
      requests: new Set(perRun.map((r) => r.run_id)).size,
      groups: rows.map((r) => ({ deviceId: r.device_id, kind: r.kind, tier: r.tier, calls: r.calls, tokensIn: r.tin, tokensOut: r.tout, imageTokens: r.timg })),
      runs: perRun.map((r) => ({ runId: r.run_id, prompt: r.prompt ?? null, status: r.status ?? null, tier: r.tier, firstAt: new Date(r.first_at).getTime(), calls: r.calls, tokensIn: r.tin, tokensOut: r.tout })),
    };
  }

  async telemetryHistory(deviceId: string, sinceMs: number, bucketMs: number): Promise<TelemetryPoint[]> {
    await this.flush();
    const { rows } = await this.q(
      `select time_bucket(make_interval(secs => $3), time) as b,
              avg(battery_pct)::float8 as battery, avg(temp_c)::float8 as temp, bool_or(charging) as charging
         from telemetry
        where device_id = $1 and time >= $2 and online
        group by b order by b`,
      [deviceId, ts(sinceMs), bucketMs / 1000],
    );
    return rows.map((r) => ({ time: new Date(r.b).getTime(), batteryPct: r.battery, tempC: r.temp, charging: r.charging }));
  }

  appendStep(s: StepRow) {
    const v = [ts(s.time), s.runId, s.subtaskId, s.deviceId, s.kind, JSON.stringify(s.detail), s.tokensIn, s.tokensOut, s.model];
    return this.enqueue(null, async () => {
      await this.q(
        `insert into agent_step (time, run_id, subtask_id, device_id, kind, detail, tokens_in, tokens_out, model)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        v,
      );
    });
  }

  // ---------- Runs ----------

  upsertRun(r: RunRecord) {
    const v = [
      r.id,
      r.clientRunId,
      r.prompt,
      r.status,
      JSON.stringify(r.config),
      r.ranked === null ? null : JSON.stringify(r.ranked),
      JSON.stringify(r.burn),
      r.error,
      ts(r.createdAt),
      ts(r.finishedAt),
      r.answer ? JSON.stringify(r.answer) : null,
    ];
    return this.enqueue(`run:${r.id}`, async () => {
      await this.q(
        `insert into run (id, client_run_id, prompt, status, config, ranked, burn, error, created_at, finished_at, answer)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         on conflict (id) do update set status = $4, config = $5, ranked = $6, burn = $7, error = $8, finished_at = $10, answer = $11`,
        v,
      );
    });
  }

  upsertSubtask(s: SubtaskRecord) {
    const v = [
      s.id,
      s.runId,
      s.capability,
      s.source,
      s.label,
      s.goal,
      s.status,
      s.deviceId,
      s.attempt,
      s.error,
      s.dealCount,
      ts(s.createdAt),
      ts(s.startedAt),
      ts(s.finishedAt),
    ];
    return this.enqueue(`subtask:${s.id}`, async () => {
      await this.q(
        `insert into subtask (id, run_id, capability, source, label, goal, status, device_id, attempt, error, deal_count, created_at, started_at, finished_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         on conflict (id) do update set status = $7, device_id = $8, attempt = $9, error = $10, deal_count = $11,
           started_at = $13, finished_at = $14`,
        v,
      );
    });
  }

  async listRecentRuns(limit: number) {
    await this.flush();
    const { rows: runs } = await this.q(`select * from run order by created_at desc limit $1`, [limit]);
    if (!runs.length) return [];
    const { rows: subs } = await this.q(`select * from subtask where run_id = any($1) order by created_at`, [runs.map((r) => r.id)]);
    return runs.map((r) => ({
      run: toRun(r),
      subtasks: subs.filter((s) => s.run_id === r.id).map(toSubtask),
    }));
  }

  async getRunByClientRunId(clientRunId: string) {
    await this.flush();
    const { rows } = await this.q(`select * from run where client_run_id = $1`, [clientRunId]);
    return rows[0] ? toRun(rows[0]) : null;
  }

  async failUnfinishedRuns(reason: string, at: number) {
    await this.flush();
    const { rowCount } = await this.q(
      `update run set status = 'failed', error = $1, finished_at = $2 where status in ('planning', 'running', 'merging')`,
      [reason, ts(at)],
    );
    await this.q(
      `update subtask set status = 'cancelled', error = coalesce(error, $1), finished_at = coalesce(finished_at, $2)
       where status in ('queued', 'running')`,
      [reason, ts(at)],
    );
    return rowCount ?? 0;
  }

  // ---------- Deals ----------

  insertDeals(deals: DealRecord[]) {
    if (!deals.length) return Promise.resolve();
    const cols = 12;
    const values: unknown[] = [];
    const tuples = deals.map((d, i) => {
      values.push(d.id, d.runId, d.subtaskId, d.deviceId, d.source, d.title, d.priceText, d.conditions, d.expiresText, d.url, d.screenshotRef, d.confidence);
      return `(${Array.from({ length: cols }, (_, j) => `$${i * cols + j + 1}`).join(", ")})`;
    });
    return this.enqueue(null, async () => {
      await this.q(
        `insert into deal (id, run_id, subtask_id, device_id, source, title, price_text, conditions, expires_text, url, screenshot_ref, confidence)
         values ${tuples.join(", ")} on conflict (id) do nothing`,
        values,
      );
    });
  }

  async listDeals(runId: string): Promise<DealRecord[]> {
    await this.flush();
    const { rows } = await this.q(`select * from deal where run_id = $1`, [runId]);
    return rows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      subtaskId: r.subtask_id,
      deviceId: r.device_id,
      source: r.source,
      title: r.title,
      priceText: r.price_text,
      conditions: r.conditions,
      expiresText: r.expires_text,
      url: r.url,
      screenshotRef: r.screenshot_ref,
      confidence: r.confidence,
    }));
  }

  // ---------- Viewer links ----------

  upsertViewerLink(v: ViewerLinkRecord) {
    const vals = [v.tokenHash, ts(v.createdAt), ts(v.expiresAt), ts(v.revokedAt)];
    return this.enqueue(`viewer:${v.tokenHash}`, async () => {
      await this.q(
        `insert into viewer_link (token_hash, created_at, expires_at, revoked_at) values ($1, $2, $3, $4)
         on conflict (token_hash) do update set expires_at = $3, revoked_at = $4`,
        vals,
      );
    });
  }

  async getViewerLink(tokenHash: string) {
    await this.flush();
    const { rows } = await this.q(`select * from viewer_link where token_hash = $1`, [tokenHash]);
    const r = rows[0];
    return r ? { tokenHash: r.token_hash, createdAt: ms(r.created_at)!, expiresAt: ms(r.expires_at)!, revokedAt: ms(r.revoked_at) } : null;
  }
}

// pg returns jsonb already parsed and timestamptz as Date.
function toRun(r: Record<string, any>): RunRecord {
  return {
    id: r.id,
    clientRunId: r.client_run_id,
    prompt: r.prompt,
    status: r.status,
    config: r.config,
    ranked: r.ranked,
    answer: r.answer ?? null,
    burn: r.burn,
    error: r.error,
    createdAt: ms(r.created_at)!,
    finishedAt: ms(r.finished_at),
  };
}

function toSubtask(s: Record<string, any>): SubtaskRecord {
  return {
    id: s.id,
    runId: s.run_id,
    capability: s.capability,
    source: s.source,
    label: s.label,
    goal: s.goal,
    status: s.status,
    deviceId: s.device_id,
    attempt: s.attempt,
    error: s.error,
    dealCount: s.deal_count,
    createdAt: ms(s.created_at)!,
    startedAt: ms(s.started_at),
    finishedAt: ms(s.finished_at),
  };
}
