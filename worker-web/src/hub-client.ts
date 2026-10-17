// WebSocket link to the hub: hello, heartbeats, reconnect with backoff.
// Messages sent while disconnected are dropped; the hub reassigns lost work.

import WebSocket from "ws";
import {
  HubToDevice,
  WS_PATH,
  HEARTBEAT_MS,
  RECONNECT_MIN_MS,
  RECONNECT_MAX_MS,
  type DeviceToHub,
  type Telemetry,
} from "@co2lab/shared";
import { log } from "./config.js";

/** Close codes after which reconnecting cannot help (bad or revoked token). */
const FATAL_CLOSE_CODES = new Set([4001, 4003]);

export interface HubClientOptions {
  hubUrl: string;
  token: string;
  telemetry: () => Telemetry;
  runningSubtaskIds: () => string[];
  onMessage: (msg: HubToDevice) => void;
  onFatal: (reason: string) => void;
}

export class HubClient {
  private ws: WebSocket | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private backoff = RECONNECT_MIN_MS;
  private closing = false;
  private ready = false;

  constructor(private readonly opts: HubClientOptions) {}

  connect(): void {
    const url = new URL(this.opts.hubUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = WS_PATH;
    log(`Connecting to ${url.href}`);
    const ws = new WebSocket(url, { handshakeTimeout: 10_000 });
    this.ws = ws;

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "hello", role: "device", token: this.opts.token } satisfies DeviceToHub));
    });

    ws.on("message", (data) => {
      let parsed;
      try {
        parsed = HubToDevice.safeParse(JSON.parse(data.toString()));
      } catch {
        log("Hub sent non-JSON; ignored");
        return;
      }
      if (!parsed.success) {
        log("Hub sent an unknown message; ignored:", data.toString().slice(0, 200));
        return;
      }
      const msg = parsed.data;
      if (msg.type === "hello.ok") {
        log(`Hub accepted us as "${msg.name}" (${msg.deviceId})`);
        this.ready = true;
        this.backoff = RECONNECT_MIN_MS;
        this.startHeartbeat();
      }
      this.opts.onMessage(msg);
    });

    ws.on("close", (code, reason) => {
      this.stopHeartbeat();
      const wasReady = this.ready;
      this.ready = false;
      this.ws = null;
      if (this.closing) return;
      if (FATAL_CLOSE_CODES.has(code)) {
        this.opts.onFatal(`Hub rejected this device (close ${code}${reason.length ? `: ${reason}` : ""}). Pair again.`);
        return;
      }
      log(`Disconnected (code ${code}${wasReady ? "" : ", before hello.ok"}); retrying in ${this.backoff / 1000}s`);
      this.reconnectTimer = setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(RECONNECT_MAX_MS, this.backoff * 2);
    });

    ws.on("error", (err) => log(`Socket error: ${err.message || (err as NodeJS.ErrnoException).code || "connection failed"}`));
  }

  /** Sends if connected and authenticated; otherwise drops the message. */
  send(msg: DeviceToHub): boolean {
    if (!this.ready || this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  close(): void {
    this.closing = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close(1000, "worker shutting down");
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const beat = () =>
      this.send({ type: "heartbeat", telemetry: this.opts.telemetry(), runningSubtaskIds: this.opts.runningSubtaskIds() });
    beat();
    this.heartbeat = setInterval(beat, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
}
