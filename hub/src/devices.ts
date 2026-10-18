// Device registry: persistent records plus live state (socket, heartbeat, telemetry, work).
// deriveState() turns that into the DeviceState that drives the tree mood.

import {
  BATTERY_REST_BELOW_PCT,
  OFFLINE_AFTER_MS,
  tempLimits,
  type Capability,
  type ContextItem,
  type DeviceState,
  type DeviceView,
  type HubToClient,
  type Telemetry,
} from "@co2lab/shared";
import type { WebSocket } from "ws";
import type { DeviceRecord, Repository } from "./repo/index.js";

/** How long a failure keeps the card in the "error" mood. */
export const ERROR_SHOW_MS = 10_000;

export interface CurrentTask {
  subtaskId: string;
  capability: Capability;
  label: string;
  progress: number;
}

export type FrameMsg = Extract<HubToClient, { type: "frame" }>;

export interface LiveDevice {
  rec: DeviceRecord;
  socket: WebSocket | null;
  lastHeartbeatAt: number | null;
  telemetry: Telemetry | null;
  online: boolean;
  hot: boolean;
  errorUntil: number;
  errorNote: string | null;
  current: CurrentTask | null;
  latestFrame: FrameMsg | null;
  /** What the device told the planner (P4): installed apps, Steam games, browser. */
  context: ContextItem[];
}

export function isResting(d: LiveDevice): boolean {
  const t = d.telemetry;
  return !!t && t.batteryPct !== null && t.batteryPct < BATTERY_REST_BELOW_PCT && t.charging !== true;
}

export function deriveState(d: LiveDevice, now = Date.now()): DeviceState {
  if (d.rec.revokedAt) return "revoked";
  if (!d.online) return "offline";
  if (d.errorUntil > now) return "error";
  if (d.hot) return "hot";
  if (isResting(d)) return "resting";
  if (d.current) return "working";
  return "idle";
}

function noteFor(d: LiveDevice, state: DeviceState): string | null {
  switch (state) {
    case "error":
      return d.errorNote;
    case "hot":
      return `${d.rec.name} is hot (${d.telemetry?.tempC ?? "?"} °C); paused until it cools below ${tempLimits(d.rec.kind).resumeBelowC} °C`;
    case "resting":
      return `plug in ${d.rec.name}`;
    case "revoked":
      return "access revoked";
    default:
      return null;
  }
}

export class DeviceRegistry {
  private devices = new Map<string, LiveDevice>();
  private byHash = new Map<string, string>();

  /** Name and kind of every device ever loaded or paired, kept after removal (for past runs). */
  private known = new Map<string, { name: string; kind: DeviceRecord["kind"] }>();

  constructor(private repo: Repository) {}

  /** What a device was, even if it has since been removed. */
  describe(id: string): { name: string; kind: DeviceRecord["kind"] } | undefined {
    const live = this.devices.get(id);
    return live ? { name: live.rec.name, kind: live.rec.kind } : this.known.get(id);
  }

  async load() {
    for (const rec of await this.repo.listDevices()) this.track(rec);
  }

  private track(rec: DeviceRecord): LiveDevice {
    this.known.set(rec.id, { name: rec.name, kind: rec.kind });
    const d: LiveDevice = {
      rec,
      socket: null,
      lastHeartbeatAt: null,
      telemetry: null,
      online: false,
      hot: false,
      errorUntil: 0,
      errorNote: null,
      current: null,
      latestFrame: null,
      context: [],
    };
    this.devices.set(rec.id, d);
    this.byHash.set(rec.tokenHash, rec.id);
    return d;
  }

  async add(rec: DeviceRecord): Promise<LiveDevice> {
    await this.repo.upsertDevice(rec);
    return this.track(rec);
  }

  get(id: string) {
    return this.devices.get(id);
  }

  byTokenHash(hash: string) {
    const id = this.byHash.get(hash);
    return id ? this.devices.get(id) : undefined;
  }

  all(): LiveDevice[] {
    return [...this.devices.values()];
  }

  active(): LiveDevice[] {
    return this.all().filter((d) => !d.rec.revokedAt);
  }

  /** Has this capability: listed at pairing, or (general agent) `app:<package>` for an app the phone reported as installed. */
  canRun(d: LiveDevice, cap: Capability): boolean {
    if (d.rec.capabilities.includes(cap)) return true;
    if (!cap.startsWith("app:") || d.rec.kind !== "android") return false;
    const pkg = cap.slice(4);
    return d.context.some((c) => c.kind === "installed_app" && c.id === pkg);
  }

  /** Any non-revoked device (online or not) that has the capability. */
  anyWith(cap: Capability): boolean {
    return this.active().some((d) => this.canRun(d, cap));
  }

  /** Can take new work right now. */
  isAvailable(d: LiveDevice, now = Date.now()): boolean {
    return (
      !d.rec.revokedAt &&
      d.online &&
      d.socket !== null &&
      d.socket.readyState === d.socket.OPEN &&
      !d.hot &&
      !isResting(d) &&
      !d.current &&
      d.errorUntil <= now
    );
  }

  /** Online and healthy (may be busy). Used to decide whether the cloud worker should step in. */
  isHealthy(d: LiveDevice): boolean {
    return !d.rec.revokedAt && d.online && d.socket !== null && !d.hot && !isResting(d);
  }

  /** Record a sign of life. Returns true if the device just came online. */
  touch(d: LiveDevice, now = Date.now()): boolean {
    d.lastHeartbeatAt = now;
    if (d.online) return false;
    d.online = true;
    return true;
  }

  applyTelemetry(d: LiveDevice, t: Telemetry) {
    d.telemetry = t;
    if (t.tempC !== null) {
      const lim = tempLimits(d.rec.kind);
      if (t.tempC >= lim.pauseAtC) d.hot = true;
      else if (d.hot && t.tempC < lim.resumeBelowC) d.hot = false;
    }
  }

  setError(d: LiveDevice, note: string, now = Date.now()) {
    d.errorNote = note;
    d.errorUntil = now + ERROR_SHOW_MS;
  }

  /** Devices whose heartbeat has gone silent; marks them offline and returns them. */
  sweepOffline(now = Date.now()): LiveDevice[] {
    const out: LiveDevice[] = [];
    for (const d of this.devices.values()) {
      if (d.online && (d.lastHeartbeatAt === null || now - d.lastHeartbeatAt > OFFLINE_AFTER_MS)) {
        d.online = false;
        out.push(d);
      }
    }
    return out;
  }

  /** Devices whose error mood just expired (so their card should refresh). */
  sweepErrors(now = Date.now()): LiveDevice[] {
    const out: LiveDevice[] = [];
    for (const d of this.devices.values()) {
      if (d.errorNote && d.errorUntil <= now) {
        d.errorNote = null;
        out.push(d);
      }
    }
    return out;
  }

  async rename(d: LiveDevice, name: string) {
    d.rec.name = name;
    await this.repo.upsertDevice(d.rec);
  }

  async revoke(d: LiveDevice, now = Date.now()) {
    d.rec.revokedAt = now;
    d.online = false;
    await this.repo.upsertDevice(d.rec);
  }

  remove(d: LiveDevice) {
    this.known.set(d.rec.id, { name: d.rec.name, kind: d.rec.kind });
    this.devices.delete(d.rec.id);
    this.byHash.delete(d.rec.tokenHash);
  }

  view(d: LiveDevice, now = Date.now()): DeviceView {
    const state = deriveState(d, now);
    return {
      id: d.rec.id,
      name: d.rec.name,
      kind: d.rec.kind,
      capabilities: d.rec.capabilities,
      state,
      telemetry: d.telemetry,
      lastSeenAt: d.lastHeartbeatAt,
      currentTask: d.current ? { ...d.current } : null,
      note: noteFor(d, state),
      context: d.context.slice(0, 300),
    };
  }
}
