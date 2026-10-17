// How the dashboard reaches the hub: HTTP login + a WebSocket factory.
// The real backend talks to the hub; the dev-only mock (src/mock/) implements the same interface.

import type { ComponentType } from "react";
import { realSocketFactory, type SocketFactory } from "./connection";

export type LoginResult = "ok" | "wrong" | "error";

export interface Backend {
  socketFactory: SocketFactory;
  login(passphrase: string): Promise<LoginResult>;
  logout(): Promise<void>;
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
};
