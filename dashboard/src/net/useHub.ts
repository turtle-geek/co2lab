import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { ClientToHub } from "@co2lab/shared";
import { Connection, type ConnStatus, type Role } from "./connection";
import type { Backend } from "./backend";
import { initialState, reduce, type Action } from "../state/hubState";

export interface Hub {
  state: ReturnType<typeof reduce>;
  status: ConnStatus;
  send(msg: ClientToHub): boolean;
  dispatch(a: Action): void;
  /** Start a run; re-sent after a reconnect if the hub never saw it (clientRunId keeps it idempotent). */
  createRun(prompt: string): boolean;
  pendingRunId: string | null;
  restart(): void;
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    try {
      return crypto.randomUUID();
    } catch {
      /* insecure context */
    }
  }
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useHub(backend: Backend, role: Role, token: string | undefined): Hub {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [epoch, setEpoch] = useState(0);
  const connRef = useRef<Connection | null>(null);
  const pendingRef = useRef<{ clientRunId: string; prompt: string } | null>(null);
  const [pendingRunId, setPendingRunId] = useState<string | null>(null);

  useEffect(() => {
    setStatus("connecting");
    const conn = new Connection(
      backend.socketFactory,
      role,
      token,
      (msg) => {
        dispatch(msg);
        const pending = pendingRef.current;
        if (!pending) return;
        if (msg.type === "run.update" && msg.run.clientRunId === pending.clientRunId) {
          pendingRef.current = null;
          setPendingRunId(null);
        } else if (msg.type === "state.snapshot") {
          if (msg.runs.some((r) => r.clientRunId === pending.clientRunId)) {
            pendingRef.current = null;
            setPendingRunId(null);
          } else {
            // Snapshot arrives before status flips to open; resend on the next tick.
            setTimeout(() => connRef.current?.send({ type: "run.create", ...pending }), 0);
          }
        }
      },
      setStatus,
    );
    connRef.current = conn;
    conn.start();
    return () => conn.stop();
  }, [backend, role, token, epoch]);

  const send = useCallback((msg: ClientToHub) => connRef.current?.send(msg) ?? false, []);

  const createRun = useCallback((prompt: string) => {
    const pending = { clientRunId: newId(), prompt };
    const ok = connRef.current?.send({ type: "run.create", ...pending }) ?? false;
    if (ok) {
      pendingRef.current = pending;
      setPendingRunId(pending.clientRunId);
    }
    return ok;
  }, []);

  const restart = useCallback(() => setEpoch((e) => e + 1), []);

  return { state, status, send, dispatch, createRun, pendingRunId, restart };
}
