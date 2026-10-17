import { useEffect, useState } from "react";
import type { DealSource, DeviceState } from "@co2lab/shared";

export const STATE_LABEL: Record<DeviceState, string> = {
  idle: "Idle",
  working: "Working",
  offline: "Offline",
  resting: "Resting",
  hot: "Too hot",
  error: "Error",
  revoked: "Revoked",
};

export const SOURCE_LABEL: Record<DealSource, string> = {
  tims: "Tim Hortons",
  mcdonalds: "McDonald's",
  popeyes: "Popeyes",
  redflagdeals: "RedFlagDeals",
};

const APP_LABEL: Record<string, string> = {
  tims: "Tim Hortons",
  mcdonalds: "McDonald's",
  popeyes: "Popeyes",
  whatsapp: "WhatsApp",
  redflagdeals: "RedFlagDeals",
};

/** "app:tims" -> "Tim Hortons", "web:redflagdeals" -> "RedFlagDeals", "web" -> "Web". */
export function capabilityLabel(cap: string): string {
  const [kind, id] = cap.split(":");
  if (id) return APP_LABEL[id] ?? id;
  return kind === "web" ? "Web" : cap;
}

export function ago(ts: number | null, now: number): string {
  if (ts === null) return "never";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

export function fmtInt(n: number): string {
  return n.toLocaleString("en-CA");
}

export function fmtUsd(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

/** Re-renders every `ms` so "last seen" and countdowns stay live. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
