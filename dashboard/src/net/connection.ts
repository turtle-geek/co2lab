// One WebSocket to the hub with auto-reconnect (1 s -> 10 s backoff).
// The transport is pluggable so the dev-only mock hub can stand in for a real socket.

import { HubToClient, RECONNECT_MAX_MS, RECONNECT_MIN_MS, WS_PATH } from "@co2lab/shared";
import type { ClientToHub } from "@co2lab/shared";

/** The subset of the browser WebSocket we use. */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
}

export type SocketFactory = () => SocketLike;

export type Role = "owner" | "viewer";

export type ConnStatus =
  | "connecting" // first attempt
  | "open" // snapshot received
  | "reconnecting" // lost, retrying
  | "unauthorized"; // hub refused hello (owner: log in; viewer: link expired)

const AUTH_CLOSE_CODES = new Set([4001, 4003]);
const AUTH_ERROR_CODES = new Set(["unauthorized", "forbidden", "expired", "revoked", "auth"]);

export function realSocketFactory(): SocketLike {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(`${proto}//${location.host}${WS_PATH}`);
}

export class Connection {
  private socket: SocketLike | null = null;
  private retryMs = RECONNECT_MIN_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private gotSnapshot = false;
  status: ConnStatus = "connecting";

  constructor(
    private readonly factory: SocketFactory,
    private readonly role: Role,
    private readonly token: string | undefined,
    private readonly onMessage: (msg: HubToClient) => void,
    private readonly onStatus: (s: ConnStatus) => void,
  ) {}

  start() {
    this.stopped = false;
    this.open();
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.socket?.close(1000, "bye");
    this.socket = null;
  }

  /** Returns false when the socket is not ready; callers keep the UI disabled while offline. */
  send(msg: ClientToHub): boolean {
    if (this.role === "viewer" && msg.type !== "hello") return false;
    if (!this.socket || this.socket.readyState !== 1 || this.status !== "open") return false;
    this.socket.send(JSON.stringify(msg));
    return true;
  }

  private setStatus(s: ConnStatus) {
    if (this.status === s) return;
    this.status = s;
    this.onStatus(s);
  }

  private open() {
    this.gotSnapshot = false;
    let sock: SocketLike;
    try {
      sock = this.factory();
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = sock;

    sock.onopen = () => {
      const hello: ClientToHub = this.token
        ? { type: "hello", role: this.role, token: this.token }
        : { type: "hello", role: this.role };
      sock.send(JSON.stringify(hello));
    };

    sock.onmessage = (ev) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      const parsed = HubToClient.safeParse(raw);
      if (!parsed.success) {
        // Do not drop it: a small schema drift on the hub should not blank the screen.
        console.warn("[co2lab] message does not match protocol", raw, parsed.error.issues);
        if (!raw || typeof raw !== "object" || typeof (raw as { type?: unknown }).type !== "string") return;
      }
      const msg = (parsed.success ? parsed.data : raw) as HubToClient;

      if (msg.type === "error" && !this.gotSnapshot && AUTH_ERROR_CODES.has(msg.code)) {
        this.stopped = true;
        this.setStatus("unauthorized");
        sock.close(1000);
        return;
      }
      if (msg.type === "state.snapshot") {
        this.gotSnapshot = true;
        this.retryMs = RECONNECT_MIN_MS;
        this.onMessage(msg);
        this.setStatus("open");
        return;
      }
      this.onMessage(msg);
    };

    sock.onclose = (ev) => {
      if (this.socket !== sock) return;
      this.socket = null;
      if (this.stopped) return;
      if (AUTH_CLOSE_CODES.has(ev.code)) {
        this.stopped = true;
        this.setStatus("unauthorized");
        return;
      }
      this.setStatus(this.status === "connecting" && !this.gotSnapshot ? "connecting" : "reconnecting");
      this.scheduleRetry();
    };

    sock.onerror = () => {
      /* onclose follows */
    };
  }

  private scheduleRetry() {
    if (this.stopped) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const wait = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, RECONNECT_MAX_MS);
    this.retryTimer = setTimeout(() => this.open(), wait);
  }
}
