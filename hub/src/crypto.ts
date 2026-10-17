import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sixDigitCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

// Owner session cookie: stateless "owner.<expiresAt>.<hmac>", signed with SESSION_SECRET.
export const SESSION_COOKIE = "co2lab_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;

const sign = (payload: string) => createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");

export function makeSessionValue(now = Date.now()): string {
  const payload = `owner.${now + SESSION_TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionValue(value: string | undefined, now = Date.now()): boolean {
  if (!value || config.sessionSecret.length < 32) return false;
  const i = value.lastIndexOf(".");
  if (i < 0) return false;
  const payload = value.slice(0, i);
  const mac = value.slice(i + 1);
  if (!safeEqual(mac, sign(payload))) return false;
  const [role, exp] = payload.split(".");
  return role === "owner" && Number(exp) > now;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}
