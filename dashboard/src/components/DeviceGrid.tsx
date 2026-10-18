import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { DeviceView } from "@co2lab/shared";
import { DeviceScene } from "./DeviceScene";
import { STATE_LABEL, ago, useNow } from "../format";
import type { LiveFrame } from "../state/hubState";

const SEGMENTS = 5;

const IDLE_TEXT: Record<DeviceView["state"], string> = {
  idle: "Ready for work",
  working: "Starting…",
  offline: "Disconnected",
  resting: "Not taking work",
  hot: "Cooling down",
  error: "Recovering",
  revoked: "Removing…",
};

function Progress({ value, state }: { value: number; state: string }) {
  const filled = Math.round(value * SEGMENTS);
  return (
    <span className={`segbar segbar--${state}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <span key={i} className={i < filled ? "segbar__seg segbar__seg--on" : "segbar__seg"} />
      ))}
    </span>
  );
}

export function TelemetryLine({ device, now }: { device: DeviceView; now: number }) {
  if (device.state === "offline") return <p className="card__meta card__meta--muted">Last seen {ago(device.lastSeenAt, now)}</p>;
  const t = device.telemetry;
  const parts: ReactNode[] = [];
  if (t?.batteryPct != null) {
    parts.push(
      <span key="b">
        {t.charging ? <span className="card__bolt" aria-label="charging">⚡</span> : null}
        {Math.round(t.batteryPct)}%
      </span>,
    );
  } else if (device.kind === "cloud") {
    parts.push(<span key="b">Always on</span>);
  }
  if (t?.tempC != null) parts.push(<span key="t">{t.tempC.toFixed(0)}°C</span>);
  if (!parts.length) parts.push(<span key="n">No telemetry yet</span>);
  return (
    <p className="card__meta">
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="card__dot"> · </span>}
          {p}
        </span>
      ))}
    </p>
  );
}

const KIND_LABEL: Record<DeviceView["kind"], string> = { android: "Phone", laptop: "Laptop", desktop: "Desktop", cloud: "Cloud" };

export function TreeCard({ device, readOnly, onRevoke, frame }: { device: DeviceView; readOnly: boolean; onRevoke(id: string): void; frame?: LiveFrame }) {
  const now = useNow();
  const [confirming, setConfirming] = useState(false);
  const task = device.currentTask;
  return (
    <article className={`card tree-card tree-card--${device.state}`} aria-label={`${device.name}, ${STATE_LABEL[device.state]}`}>
      <div className="tree-card__art">
        <DeviceScene kind={device.kind} mood={device.state} frame={liveSrc(device, frame, now)} />
        <span className="tree-card__kind">{KIND_LABEL[device.kind]}</span>
      </div>
      <div className="tree-card__body">
        <div className="tree-card__title">
          <h3 title={device.name}>{device.name}</h3>
          <span className={`pill pill--${device.state}`}>{STATE_LABEL[device.state]}</span>
        </div>
        <TelemetryLine device={device} now={now} />
        <div className="tree-card__task">
          {task ? (
            <>
              <span className="tree-card__task-label">{task.label}</span>
              <Progress value={task.progress} state={device.state} />
            </>
          ) : (
            <>
              <span className="tree-card__task-label tree-card__task-label--muted">
                {IDLE_TEXT[device.state]}
              </span>
              <Progress value={0} state={device.state} />
            </>
          )}
        </div>
        {device.note && <p className={`tree-card__note tree-card__note--${device.state}`}>{device.note}</p>}
        {sharesLine(device) && <p className="tree-card__shares">Shares: {sharesLine(device)}</p>}
        {!readOnly && device.state !== "revoked" && (
          confirming ? (
            <span className="tree-card__confirm" role="group" aria-label={`Revoke ${device.name}?`}>
              Revoke?
              <button className="link-btn tree-card__yes" onClick={() => onRevoke(device.id)}>
                Yes
              </button>
              <button className="link-btn" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button className="link-btn tree-card__revoke" onClick={() => setConfirming(true)}>
              Revoke
            </button>
          )
        )}
      </div>
    </article>
  );
}

export function AddDeviceCard({ onClick, disabled }: { onClick(): void; disabled: boolean }) {
  return (
    <button className="card add-card" onClick={onClick} disabled={disabled}>
      <span className="add-card__plus" aria-hidden>
        <svg viewBox="0 0 48 48" width="56" height="56">
          <path d="M24 8v32M8 24h32" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
        </svg>
      </span>
      <span className="add-card__title">Add device</span>
      <span className="add-card__sub">Pair an old device</span>
    </button>
  );
}

export function DeviceGrid({
  devices,
  readOnly,
  connected,
  onRevoke,
  onAdd,
  frames,
}: {
  devices: DeviceView[];
  /** Latest live frame per device: shown on the device's own screen while it works. */
  frames?: Record<string, LiveFrame>;
  readOnly: boolean;
  connected: boolean;
  onRevoke(id: string): void;
  onAdd(): void;
}) {
  const { ordered, dragId, cardRef, dragProps } = useCardOrder(devices, !readOnly);
  return (
    <section className="device-grid" aria-label="Devices">
      {ordered.map((d) => (
        <div
          key={d.id}
          ref={(el) => cardRef(d.id, el)}
          className={dragId === d.id ? "card-slot card-slot--dragging" : "card-slot"}
          {...dragProps(d.id)}
        >
          <TreeCard device={d} readOnly={readOnly} onRevoke={onRevoke} frame={frames?.[d.id]} />
        </div>
      ))}
      {!readOnly && <AddDeviceCard onClick={onAdd} disabled={!connected} />}
      {readOnly && devices.length === 0 && <p className="empty">No devices paired yet.</p>}
    </section>
  );
}

/** What this device tells the planner (SPEC §4.8), e.g. "38 apps · 12 Steam games · Microsoft Edge". */
function sharesLine(d: DeviceView): string | null {
  const c = d.context ?? [];
  const apps = c.filter((x) => x.kind === "installed_app").length;
  const games = c.filter((x) => x.kind === "steam_game").length;
  const browser = c.find((x) => x.kind === "browser")?.label;
  const parts = [apps ? `${apps} apps` : "", games ? `${games} Steam game${games === 1 ? "" : "s"}` : "", browser ?? ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** The live frame to draw on the device's screen: only while it works and the frame is recent. */
function liveSrc(d: DeviceView, frame: LiveFrame | undefined, now: number): string | null {
  if (!frame || !(d.state === "working" || d.currentTask)) return null;
  return now - frame.at < 15_000 ? frame.src : null;
}

const ORDER_KEY = "co2lab.deviceOrder";


function loadOrder(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(ORDER_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Free dragging: the card follows the pointer anywhere (mouse or touch); when it is over another card
 * they swap, and the other cards slide to their new places (FLIP). The order is remembered here.
 */
function useCardOrder(devices: DeviceView[], enabled: boolean) {
  const [order, setOrder] = useState<string[]>(loadOrder);
  const [dragId, setDragId] = useState<string | null>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const before = useRef(new Map<string, DOMRect>());
  const drag = useRef<{ id: string; pointerId: number; startX: number; startY: number; grabX: number; grabY: number; active: boolean; lastX: number; lastY: number } | null>(null);

  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const ordered = [...devices].sort((a, b) => rank(a.id) - rank(b.id));
  const orderedRef = useRef(ordered);
  orderedRef.current = ordered;

  /** Moves the dragged card so its grab point stays under the pointer, whatever slot it is in now. */
  const follow = (id: string, x: number, y: number) => {
    const el = els.current.get(id);
    const d = drag.current;
    if (!el || !d) return;
    const grid = el.offsetParent?.getBoundingClientRect();
    if (!grid) return;
    el.style.transition = "none";
    el.style.transform = `translate(${x - grid.left - d.grabX - el.offsetLeft}px, ${y - grid.top - d.grabY - el.offsetTop}px) scale(1.03)`;
  };

  // FLIP: after a swap, start each moved card (except the one in your hand) at its old spot and let it glide.
  useLayoutEffect(() => {
    const d = drag.current;
    for (const [id, el] of els.current) {
      if (d?.active && id === d.id) {
        follow(id, d.lastX, d.lastY);
        continue;
      }
      const old = before.current.get(id);
      if (!old) continue;
      const now = el.getBoundingClientRect();
      const dx = old.left - now.left;
      const dy = old.top - now.top;
      if (!dx && !dy) continue;
      el.style.transition = "none";
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        el.style.transition = "transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1)";
        el.style.transform = "";
      });
    }
    before.current.clear();
  }, [order]);

  function moveTo(id: string, targetId: string) {
    if (id === targetId) return;
    const ids = orderedRef.current.map((d) => d.id);
    const from = ids.indexOf(id);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    for (const [k, el] of els.current) if (k !== id) before.current.set(k, el.getBoundingClientRect());
    ids.splice(to, 0, ids.splice(from, 1)[0]!);
    setOrder(ids);
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify(ids));
    } catch {
      /* private mode: order just isn't remembered */
    }
  }

  /** The other card under the pointer, if any (the dragged card itself is ignored). */
  function cardAt(x: number, y: number, self: string): string | null {
    for (const [id, el] of els.current) {
      if (id === self) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id;
    }
    return null;
  }

  function end() {
    const d = drag.current;
    drag.current = null;
    setDragId(null);
    if (!d) return;
    const el = els.current.get(d.id);
    if (el && d.active) {
      // settle into the new slot
      el.style.transition = "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)";
      el.style.transform = "";
    }
  }

  return {
    ordered,
    dragId,
    cardRef: (id: string, el: HTMLElement | null) => {
      if (el) els.current.set(id, el);
      else els.current.delete(id);
    },
    dragProps: (id: string) =>
      enabled
        ? {
            onPointerDown: (e: PointerEvent<HTMLElement>) => {
              if (e.button !== 0 || (e.target as HTMLElement).closest("button, a, input")) return;
              const r = e.currentTarget.getBoundingClientRect();
              drag.current = { id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, grabX: e.clientX - r.left, grabY: e.clientY - r.top, active: false, lastX: e.clientX, lastY: e.clientY };
            },
            onPointerMove: (e: PointerEvent<HTMLElement>) => {
              const d = drag.current;
              if (!d || d.id !== id || d.pointerId !== e.pointerId) return;
              d.lastX = e.clientX;
              d.lastY = e.clientY;
              if (!d.active) {
                // a few pixels of movement before it counts as a drag, so clicks still work
                if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 6) return;
                d.active = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                setDragId(id);
              }
              e.preventDefault();
              follow(id, e.clientX, e.clientY);
              const over = cardAt(e.clientX, e.clientY, id);
              if (over) moveTo(id, over);
            },
            onPointerUp: end,
            onPointerCancel: end,
          }
        : {},
  };
}
