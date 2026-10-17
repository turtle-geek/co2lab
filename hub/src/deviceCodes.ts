// Device-code pairing for computers (memory only), like `gh auth login`:
// the worker asks for a code, the owner approves it in the dashboard, the worker polls for its token.
// The deviceCode is a 32-byte secret only the worker knows; the userCode is what the owner sees.
// Nothing gets a token without an owner approval, codes live 10 minutes, and starts are rate-limited.

import {
  DEVICE_CODE_MAX_PENDING,
  DEVICE_CODE_MAX_PER_IP,
  DEVICE_CODE_POLL_S,
  DEVICE_CODE_TTL_MS,
  type DeviceCodePollResponse,
  type DeviceCodeStartRequest,
  type PendingDevice,
} from "@co2lab/shared";
import { randomInt } from "node:crypto";
import { randomToken, sha256 } from "./crypto.js";

/** No vowels or look-alikes, so codes never spell words and are easy to read out (GitHub style). */
const ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";

export function userCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Accepts "bkdf qrwt", "BKDFQRWT", "bkdf-qrwt". */
export function normalizeUserCode(input: string): string {
  const s = input.toUpperCase().replace(/[^A-Z]/g, "");
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}

type Status = "pending" | "approved" | "denied";

interface Request {
  deviceCodeHash: string;
  pending: PendingDevice;
  status: Status;
  lastPollAt: number;
  /** Set on approval; handed to the worker exactly once. */
  grant: { deviceId: string; token: string; name: string } | null;
}

export type StartError = "rate_limited" | "too_many_pending";
export type ApproveResult =
  | { ok: true; req: DeviceCodeStartRequest & { name: string } }
  | { ok: false; error: "not_found" | "expired" };

export class DeviceCodes {
  private byUserCode = new Map<string, Request>();
  private byDeviceHash = new Map<string, Request>();
  /** Start timestamps per IP within the TTL window. */
  private startsByIp = new Map<string, number[]>();

  start(
    body: DeviceCodeStartRequest,
    ip: string | null,
    now = Date.now(),
  ): { ok: true; deviceCode: string; userCode: string; expiresAt: number; intervalS: number } | { ok: false; error: StartError } {
    this.prune(now);
    const key = ip ?? "unknown";
    const recent = (this.startsByIp.get(key) ?? []).filter((t) => t > now - DEVICE_CODE_TTL_MS);
    if (recent.length >= DEVICE_CODE_MAX_PER_IP) return { ok: false, error: "rate_limited" };
    if (this.pendingList(now).length >= DEVICE_CODE_MAX_PENDING) return { ok: false, error: "too_many_pending" };
    recent.push(now);
    this.startsByIp.set(key, recent);

    const deviceCode = randomToken(32);
    let code = userCode();
    while (this.byUserCode.has(code)) code = userCode();
    const r: Request = {
      deviceCodeHash: sha256(deviceCode),
      pending: { ...body, userCode: code, ip, createdAt: now, expiresAt: now + DEVICE_CODE_TTL_MS },
      status: "pending",
      lastPollAt: 0,
      grant: null,
    };
    this.byUserCode.set(code, r);
    this.byDeviceHash.set(r.deviceCodeHash, r);
    return { ok: true, deviceCode, userCode: code, expiresAt: r.pending.expiresAt, intervalS: DEVICE_CODE_POLL_S };
  }

  poll(deviceCode: string, now = Date.now()): DeviceCodePollResponse | null {
    const r = this.byDeviceHash.get(sha256(deviceCode));
    if (!r) return null;
    if (r.status === "approved" && r.grant) {
      this.forget(r);
      return { status: "approved", ...r.grant };
    }
    if (r.status === "denied") {
      this.forget(r);
      return { status: "denied" };
    }
    if (r.pending.expiresAt <= now) {
      this.forget(r);
      return { status: "expired" };
    }
    // Allow a little jitter below the advertised interval before asking the device to back off.
    const tooSoon = now - r.lastPollAt < DEVICE_CODE_POLL_S * 1000 * 0.5;
    r.lastPollAt = now;
    return { status: tooSoon ? "slow_down" : "pending" };
  }

  /** Owner approves. The caller creates the device, then calls grant(). */
  approve(input: string, name: string | undefined, now = Date.now()): ApproveResult {
    const r = this.byUserCode.get(normalizeUserCode(input));
    if (!r || r.status !== "pending") return { ok: false, error: "not_found" };
    if (r.pending.expiresAt <= now) return { ok: false, error: "expired" };
    const { kind, capabilities, info } = r.pending;
    return { ok: true, req: { name: name ?? r.pending.name, kind: kind as DeviceCodeStartRequest["kind"], capabilities, info } };
  }

  grant(input: string, grant: { deviceId: string; token: string; name: string }) {
    const r = this.byUserCode.get(normalizeUserCode(input));
    if (!r) return;
    r.status = "approved";
    r.grant = grant;
  }

  deny(input: string): boolean {
    const r = this.byUserCode.get(normalizeUserCode(input));
    if (!r || r.status !== "pending") return false;
    r.status = "denied";
    return true;
  }

  pendingList(now = Date.now()): PendingDevice[] {
    return [...this.byUserCode.values()]
      .filter((r) => r.status === "pending" && r.pending.expiresAt > now)
      .map((r) => r.pending)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  private forget(r: Request) {
    this.byUserCode.delete(r.pending.userCode);
    this.byDeviceHash.delete(r.deviceCodeHash);
  }

  private prune(now: number) {
    // Keep expired requests a while so a late poll gets "expired" instead of "unknown code".
    for (const r of this.byUserCode.values()) if (r.pending.expiresAt + 30 * 60_000 < now) this.forget(r);
    for (const [ip, ts] of this.startsByIp) if (!ts.some((t) => t > now - DEVICE_CODE_TTL_MS)) this.startsByIp.delete(ip);
  }
}
