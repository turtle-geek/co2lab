// How the dashboard reaches the hub: HTTP login + a WebSocket factory.
// The real backend talks to the hub; the dev-only mock (src/mock/) implements the same interface.

import type { ComponentType } from "react";
import type { AiUsage, TelemetryPoint } from "@co2lab/shared";
import { realSocketFactory, type SocketFactory } from "./connection";

export type LoginResult = "ok" | "wrong" | "error";

export interface Backend {
  socketFactory: SocketFactory;
  login(passphrase: string): Promise<LoginResult>;
  logout(): Promise<void>;
  /** A device's stored battery/temperature readings for the last `minutes` (empty if none). */
  telemetryHistory(deviceId: string, minutes: number): Promise<TelemetryPoint[]>;
  /** Every Gemini call in the last `hours`, summed by device, step kind and model. */
  /** `runId`: only that request's calls in `groups` (the request list stays complete). */
  aiUsage(hours: number, runId?: string | null): Promise<AiUsage>;
  /** Dev-only control panel for the mock hub. Undefined for the real hub. */
  DevPanel?: ComponentType;
}

export const realBackend: Backend = {
  socketFactory: realSocketFactory,
  async login(passphrase) {
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ passphrase }),
      });
      if (res.ok) return "ok";
      if (res.status === 401 || res.status === 403 || res.status === 400) return "wrong";
      return "error";
    } catch {
      return "error";
    }
  },
  async logout() {
    try {
      await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
    } catch {
      /* the socket close below is what matters */
    }
  },
  async aiUsage(hours, runId) {
    const viewer = new URLSearchParams(location.search).get("viewer") ?? new URLSearchParams(location.hash.slice(1)).get("viewer");
    const res = await fetch(`/api/impact?hours=${hours}${runId ? `&runId=${encodeURIComponent(runId)}` : ""}${viewer ? `&viewer=${encodeURIComponent(viewer)}` : ""}`, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`impact ${res.status}`);
    return (await res.json()) as AiUsage;
  },
  async telemetryHistory(deviceId, minutes) {
    const viewer = new URLSearchParams(location.search).get("viewer") ?? new URLSearchParams(location.hash.slice(1)).get("viewer");
    const q = `minutes=${minutes}${viewer ? `&viewer=${encodeURIComponent(viewer)}` : ""}`;
    const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/telemetry?${q}`, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`telemetry ${res.status}`);
    return ((await res.json()) as { points: TelemetryPoint[] }).points;
  },
};
