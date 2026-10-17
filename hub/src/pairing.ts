// One-time pairing codes (memory only): 6 digits, 5 min TTL, single use, 5 attempts.
// The device does not say which code it meant, so a wrong guess counts against every live code;
// that caps brute force at 5 guesses per code.

import { PAIRING_CODE_MAX_ATTEMPTS, PAIRING_CODE_TTL_MS } from "@co2lab/shared";
import { sixDigitCode } from "./crypto.js";

interface Code {
  code: string;
  expiresAt: number;
  attempts: number;
  burned: boolean;
}

export type RedeemError = "code_expired" | "code_invalid" | "too_many_attempts";

export class Pairing {
  private codes = new Map<string, Code>();

  create(now = Date.now()): { code: string; expiresAt: number } {
    this.prune(now);
    let code = sixDigitCode();
    while (this.codes.has(code)) code = sixDigitCode();
    const c = { code, expiresAt: now + PAIRING_CODE_TTL_MS, attempts: 0, burned: false };
    this.codes.set(code, c);
    return { code, expiresAt: c.expiresAt };
  }

  /** Consumes the code on success. */
  redeem(code: string, now = Date.now()): { ok: true } | { ok: false; error: RedeemError } {
    const c = this.codes.get(code);
    if (c && !c.burned && c.expiresAt > now) {
      this.codes.delete(code);
      return { ok: true };
    }
    if (c?.burned) return { ok: false, error: "too_many_attempts" };
    if (c && c.expiresAt <= now) return { ok: false, error: "code_expired" };
    for (const other of this.codes.values()) {
      if (other.burned || other.expiresAt <= now) continue;
      other.attempts += 1;
      if (other.attempts >= PAIRING_CODE_MAX_ATTEMPTS) other.burned = true;
    }
    return { ok: false, error: "code_invalid" };
  }

  private prune(now: number) {
    // Keep expired/burned codes for a while so the device gets a precise error.
    for (const [k, c] of this.codes) if (c.expiresAt + 30 * 60_000 < now) this.codes.delete(k);
  }
}
