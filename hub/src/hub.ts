// Wires the registry, runs, pairing and viewer links to the WebSocket endpoint.

import type { IncomingMessage } from "node:http";
import {
  ClientToHub,
  DeviceToHub,
  Hello,
  VIEWER_LINK_DEFAULT_TTL_MIN,
  pairingQrPayload,
  type DeviceView,
  type HubToClient,
  type HubToDevice,
  type DeviceCodeStartRequest,
  type PairRequest,
} from "@co2lab/shared";
import { ulid } from "ulid";
import { WebSocket, WebSocketServer } from "ws";
import { config } from "./config.js";
import { SESSION_COOKIE, parseCookies, randomToken, sha256, verifySessionValue } from "./crypto.js";
import { DeviceCodes } from "./deviceCodes.js";
import { DeviceRegistry, type LiveDevice } from "./devices.js";
import { log } from "./log.js";
import { Pairing, type RedeemError } from "./pairing.js";
import type { Repository } from "./repo/index.js";
import type { CatalogDevice } from "./agent/agent.js";
import { ComputeManager, UserError as ComputeUserError } from "./compute/manager.js";
import { ResearchLab, UserError, researchStoreFor } from "./research/index.js";
import { DEFAULT_CONFIG, RunManager } from "./runs.js";

const HELLO_TIMEOUT_MS = 5_000;
const PING_MS = 20_000;
/** Frames and evidence (several screenshots) can be large. */
export const MAX_WS_PAYLOAD = 32 * 1024 * 1024;

type ClientRole = "owner" | "viewer";
interface ClientConn {
  ws: WebSocket;
  role: ClientRole;
  viewerExpiresAt: number | null;
}

export class Hub {
  readonly devices: DeviceRegistry;
  readonly runs: RunManager;
  readonly research: ResearchLab;
  readonly compute: ComputeManager;
  readonly pairing = new Pairing();
  readonly deviceCodes = new DeviceCodes();
  private clients = new Set<ClientConn>();
  private wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD });
  private timers: NodeJS.Timeout[] = [];

  constructor(readonly repo: Repository) {
    this.devices = new DeviceRegistry(repo);
    this.runs = new RunManager({
      repo,
      devices: this.devices,
      broadcast: (m) => this.broadcast(m),
      sendToDevice: (d, m) => this.sendToDevice(d, m),
      deviceChanged: (d) => this.publishDevice(d),
      onEvidence: (...a) => this.research.onEvidence(...a),
      catalog: () => this.catalog(),
      compute: () => this.compute,
    });
    this.compute = new ComputeManager({
      devices: this.devices,
      broadcast: (m) => this.broadcast(m),
      sendToDevice: (d, m) => this.sendToDevice(d, m),
      deviceChanged: (d) => this.publishDevice(d),
      onSetEnded: (set) => this.runs.onComputeSetEnded(set),
    });
    this.research = new ResearchLab({
      store: researchStoreFor(repo),
      repo,
      runs: this.runs,
      broadcast: (m) => this.broadcast(m),
      deviceName: (id) => this.devices.get(id)?.rec.name ?? null,
    });
  }

  async start() {
    await this.devices.load();
    await this.runs.load();
    await this.research.load();
    this.timers.push(setInterval(() => this.tick(), 500));
    this.timers.push(setInterval(() => this.ping(), PING_MS));
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    for (const c of this.wss.clients) c.terminate();
  }

  // ---------- Outbound ----------

  broadcast(msg: HubToClient) {
    if (msg.type === "run.update") this.research?.onRunUpdate(msg.run);
    const data = JSON.stringify(msg);
    const now = Date.now();
    for (const c of this.clients) {
      if (c.viewerExpiresAt !== null && c.viewerExpiresAt <= now) {
        this.sendRaw(c.ws, { type: "error", code: "viewer_expired", message: "This link has expired" });
        c.ws.close(4001, "viewer_expired");
        this.clients.delete(c);
        continue;
      }
      if (c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
    }
  }

  private sendRaw(ws: WebSocket, msg: HubToClient | HubToDevice) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  sendToDevice(d: LiveDevice, msg: HubToDevice) {
    if (d.socket) this.sendRaw(d.socket, msg);
  }

  /** Owners only (viewers never see who is asking to join). */
  private broadcastOwners(msg: HubToClient) {
    for (const c of this.clients) if (c.role === "owner") this.sendRaw(c.ws, msg);
  }

  private deviceCodeList(): HubToClient {
    return { type: "devicecode.list", hubUrl: config.publicUrl, pending: this.deviceCodes.pendingList() };
  }

  publishDevice(d: LiveDevice) {
    this.broadcast({ type: "device.update", device: this.devices.view(d) });
  }

  private snapshot(role: ClientRole): HubToClient {
    return {
      type: "state.snapshot",
      role,
      devices: this.devices.active().map((d) => this.devices.view(d)),
      runs: this.runs.recentViews(),
      approvals: [],
      experiments: this.research.views(),
      computeSets: this.compute.views(),
      defaultConfig: DEFAULT_CONFIG,
    };
  }

  /** What the general planner sees: online devices, their state and what they share (SPEC §4.8). */
  catalog(): CatalogDevice[] {
    return this.devices
      .active()
      .filter((d) => d.online)
      .map((d) => {
        const v = this.devices.view(d);
        return { id: d.rec.id, name: d.rec.name, kind: d.rec.kind, state: v.state, capabilities: d.rec.capabilities, context: d.context };
      });
  }

  deviceViews(): DeviceView[] {
    return this.devices.active().map((d) => this.devices.view(d));
  }

  // ---------- Periodic health engine ----------

  private tick() {
    const now = Date.now();
    for (const d of this.devices.sweepOffline(now)) {
      log.info(`device ${d.rec.name} offline (no heartbeat for >6 s)`);
      this.persistTelemetry(d, false);
      this.runs.onDeviceLost(d, "went offline");
      this.compute.onDeviceLost(d, "went offline");
      this.publishDevice(d);
    }
    for (const d of this.devices.sweepErrors(now)) this.publishDevice(d);
    this.runs.tick(now);
    this.compute.tick(now);
  }

  private ping() {
    for (const ws of this.wss.clients) {
      const w = ws as WebSocket & { alive?: boolean };
      if (w.alive === false) {
        w.terminate();
        continue;
      }
      w.alive = false;
      w.ping();
    }
  }

  private persistTelemetry(d: LiveDevice, online: boolean) {
    const t = d.telemetry;
    this.repo
      .appendTelemetry({
        time: Date.now(),
        deviceId: d.rec.id,
        batteryPct: t?.batteryPct ?? null,
        charging: t?.charging ?? null,
        tempC: t?.tempC ?? null,
        cpuPct: t?.cpuPct ?? null,
        online,
      })
      .catch((e) => log.error("repo appendTelemetry", e));
  }

  // ---------- Pairing + viewer links ----------

  async pairDevice(req: PairRequest): Promise<{ ok: true; deviceId: string; token: string } | { ok: false; error: RedeemError }> {
    const r = this.pairing.redeem(req.code);
    if (!r.ok) return r;
    return { ok: true, ...(await this.addDevice(req)) };
  }

  /** POST /api/device-code: a computer asks to join; it shows up in the owner's pending list. */
  startDeviceCode(body: DeviceCodeStartRequest, ip: string | null) {
    const r = this.deviceCodes.start(body, ip);
    if (r.ok) {
      log.info(`device code ${r.userCode} requested by "${body.name}" (${body.kind}) from ${ip ?? "?"}`);
      this.broadcastOwners(this.deviceCodeList());
    }
    return r;
  }

  private async addDevice(req: Pick<PairRequest, "name" | "kind" | "capabilities">) {
    const token = randomToken(32);
    const d = await this.devices.add({
      id: ulid(),
      name: req.name,
      kind: req.kind,
      capabilities: [...new Set(req.capabilities)],
      tokenHash: sha256(token),
      createdAt: Date.now(),
      revokedAt: null,
    });
    log.info(`paired ${d.rec.name} (${d.rec.kind}) ${d.rec.capabilities.join(",")}`);
    this.publishDevice(d);
    return { deviceId: d.rec.id, token };
  }

  private async createViewerLink(ttlMinutes = VIEWER_LINK_DEFAULT_TTL_MIN) {
    const token = randomToken(24);
    const now = Date.now();
    const expiresAt = now + ttlMinutes * 60_000;
    await this.repo.upsertViewerLink({ tokenHash: sha256(token), createdAt: now, expiresAt, revokedAt: null });
    return { url: `${config.publicUrl}/?viewer=${encodeURIComponent(token)}`, expiresAt };
  }

  /** For HTTP routes that viewers may use (e.g. evidence images). */
  async viewerTokenValid(token: string | undefined): Promise<boolean> {
    if (!token) return false;
    const v = await this.repo.getViewerLink(sha256(token));
    return !!v && !v.revokedAt && v.expiresAt > Date.now();
  }

  // ---------- WebSocket ----------

  handleUpgrade(req: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) {
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, req));
  }

  private onConnection(ws: WebSocket, req: IncomingMessage) {
    const w = ws as WebSocket & { alive?: boolean };
    w.alive = true;
    ws.on("pong", () => (w.alive = true));
    const reject = (code: string, message: string) => {
      this.sendRaw(ws, { type: "error", code, message });
      ws.close(4001, code);
    };
    const helloTimer = setTimeout(() => reject("hello_required", "first message must be hello"), HELLO_TIMEOUT_MS);

    ws.once("message", async (raw) => {
      clearTimeout(helloTimer);
      const hello = Hello.safeParse(parseJson(raw));
      if (!hello.success) return reject("hello_required", "first message must be a valid hello");
      const h = hello.data;
      try {
        if (h.role === "device") {
          const d = h.token ? this.devices.byTokenHash(sha256(h.token)) : undefined;
          if (!d) return reject("bad_token", "unknown device token");
          if (d.rec.revokedAt) return reject("device_revoked", "this device was revoked; pair it again");
          this.attachDevice(ws, d);
        } else if (h.role === "owner") {
          const cookie = parseCookies(req.headers.cookie)[SESSION_COOKIE];
          if (!verifySessionValue(cookie)) return reject("not_logged_in", "owner session missing or expired; log in again");
          this.attachClient(ws, "owner", null);
        } else {
          const v = h.token ? await this.repo.getViewerLink(sha256(h.token)) : null;
          if (!v || v.revokedAt) return reject("viewer_invalid", "This viewer link is not valid");
          if (v.expiresAt <= Date.now()) return reject("viewer_expired", "This link has expired");
          this.attachClient(ws, "viewer", v.expiresAt);
        }
      } catch (e) {
        log.error("hello", e);
        reject("server_error", "hub error during hello");
      }
    });
  }

  private attachDevice(ws: WebSocket, d: LiveDevice) {
    if (d.socket && d.socket !== ws) d.socket.close(4000, "replaced by a new connection");
    d.socket = ws;
    this.sendRaw(ws, { type: "hello.ok", deviceId: d.rec.id, name: d.rec.name });
    const cameOnline = this.devices.touch(d);
    log.info(`device ${d.rec.name} connected${cameOnline ? " (online)" : ""}`);
    this.publishDevice(d);
    this.runs.schedule();

    ws.on("message", (raw) => {
      const parsed = DeviceToHub.safeParse(parseJson(raw));
      if (!parsed.success) {
        this.sendRaw(ws, { type: "error", code: "bad_message", message: parsed.error.issues[0]?.message ?? "invalid message" });
        return;
      }
      if (d.socket !== ws || d.rec.revokedAt) return;
      const msg = parsed.data;
      if (msg.type === "hello") return;
      const back = this.devices.touch(d);
      if (msg.type === "heartbeat") {
        this.devices.applyTelemetry(d, msg.telemetry);
        this.persistTelemetry(d, true);
        this.runs.onHeartbeat(d, msg.runningSubtaskIds);
        this.publishDevice(d);
        this.runs.schedule();
        return;
      }
      if (back) {
        this.publishDevice(d);
        this.runs.schedule();
      }
      try {
        if (msg.type === "device.context") {
          d.context = msg.items;
          log.info(`context from ${d.rec.name}: ${msg.items.length} item(s)`);
          this.publishDevice(d);
        } else if (msg.type === "job.pull" || msg.type === "job.result" || msg.type === "job.failed") this.compute.onDeviceMessage(d, msg);
        else this.runs.onDeviceMessage(d, msg);
      } catch (e) {
        log.error(`device message ${msg.type}`, e);
      }
    });
    ws.on("close", () => {
      if (d.socket === ws) {
        d.socket = null;
        log.info(`device ${d.rec.name} socket closed (offline after heartbeat timeout)`);
      }
    });
  }

  private attachClient(ws: WebSocket, role: ClientRole, viewerExpiresAt: number | null) {
    const conn: ClientConn = { ws, role, viewerExpiresAt };
    this.clients.add(conn);
    this.sendRaw(ws, this.snapshot(role));
    if (role === "owner") this.sendRaw(ws, this.deviceCodeList());
    for (const d of this.devices.active()) if (d.latestFrame && d.online) this.sendRaw(ws, d.latestFrame);
    ws.on("close", () => this.clients.delete(conn));
    ws.on("message", (raw) => {
      if (role === "viewer") {
        this.sendRaw(ws, { type: "error", code: "read_only", message: "viewer links are read-only" });
        return;
      }
      const parsed = ClientToHub.safeParse(parseJson(raw));
      if (!parsed.success) {
        this.sendRaw(ws, { type: "error", code: "bad_message", message: parsed.error.issues[0]?.message ?? "invalid message" });
        return;
      }
      void this.onOwnerMessage(ws, parsed.data).catch((e) => {
        log.error(`owner message ${parsed.data.type}`, e);
        this.sendRaw(ws, { type: "error", code: "server_error", message: String(e instanceof Error ? e.message : e) });
      });
    });
  }

  private async onOwnerMessage(ws: WebSocket, msg: ClientToHub) {
    switch (msg.type) {
      case "hello":
        return;
      case "run.create": {
        const run = await this.runs.create(msg.prompt, msg.clientRunId);
        this.sendRaw(ws, { type: "run.update", run });
        return;
      }
      case "pair.start": {
        const { code, expiresAt } = this.pairing.create();
        this.sendRaw(ws, { type: "pair.code", code, qrPayload: pairingQrPayload(config.publicUrl, code), expiresAt });
        return;
      }
      case "devicecode.approve": {
        const r = this.deviceCodes.approve(msg.userCode, msg.name);
        if (!r.ok) {
          const message = r.error === "expired" ? "that code expired; run the installer again" : "no pending device with that code";
          this.sendRaw(ws, { type: "error", code: `devicecode_${r.error}`, message });
          return;
        }
        const { deviceId, token } = await this.addDevice(r.req);
        this.deviceCodes.grant(msg.userCode, { deviceId, token, name: r.req.name });
        this.broadcastOwners(this.deviceCodeList());
        return;
      }
      case "devicecode.deny": {
        if (this.deviceCodes.deny(msg.userCode)) log.info(`device code ${msg.userCode} denied`);
        this.broadcastOwners(this.deviceCodeList());
        return;
      }
      case "device.revoke": {
        const d = this.devices.get(msg.deviceId);
        if (!d || d.rec.revokedAt) {
          this.sendRaw(ws, { type: "error", code: "not_found", message: "no such device" });
          return;
        }
        await this.devices.revoke(d);
        if (d.socket) {
          this.sendRaw(d.socket, { type: "error", code: "device_revoked", message: "this device was revoked" });
          d.socket.close(4001, "device_revoked");
          d.socket = null;
        }
        this.runs.onDeviceLost(d, "was revoked");
        this.compute.onDeviceLost(d, "was revoked");
        d.current = null;
        this.publishDevice(d);
        setTimeout(() => {
          this.devices.remove(d);
          this.broadcast({ type: "device.removed", deviceId: d.rec.id });
        }, 3_000);
        log.info(`revoked ${d.rec.name}`);
        return;
      }
      case "viewer.create": {
        const link = await this.createViewerLink(msg.ttlMinutes);
        this.sendRaw(ws, { type: "viewer.link", ...link });
        return;
      }
      case "compute.start":
      case "compute.cancel":
        try {
          if (msg.type === "compute.start") await this.compute.start(msg.appId, msg.strategy, msg.maxReviews);
          else this.compute.cancel(msg.setId);
        } catch (e) {
          if (!(e instanceof ComputeUserError)) throw e;
          this.sendRaw(ws, { type: "error", code: "compute", message: e.message });
        }
        return;
      case "research.capture":
      case "research.label":
      case "research.propose":
      case "research.feedback":
        try {
          await this.research.handle(msg);
        } catch (e) {
          if (!(e instanceof UserError)) throw e;
          this.sendRaw(ws, { type: "error", code: "research", message: e.message });
        }
        return;
      default:
        this.sendRaw(ws, { type: "error", code: "not_implemented", message: `${msg.type} is not available yet` });
    }
  }
}

function parseJson(raw: unknown): unknown {
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}
