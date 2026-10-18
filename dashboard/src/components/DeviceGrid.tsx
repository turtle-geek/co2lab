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

/** Upright battery drawn like the devices (brown outline); the fill drops with the charge, a bolt when charging. */
function BatteryIcon({ pct, charging }: { pct: number; charging: boolean }) {
  const level = Math.max(0, Math.min(100, pct));
  const inner = 12.4; // fill area height (y 4.8..17.2)
  const h = Math.max(level > 0 ? 1.5 : 0, (inner * level) / 100);
  const tone = level <= 20 && !charging ? "low" : level <= 40 && !charging ? "mid" : "ok";
  return (
    <svg className={`meta-icon battery battery--${tone}${charging ? " battery--charging" : ""}`} viewBox="0 0 14 20" width="12" height="17" aria-hidden>
      <rect className="battery__cap" x="4.5" y="0.8" width="5" height="2.2" rx="1" />
      <rect className="battery__case" x="1.5" y="2.8" width="11" height="16.4" rx="2.5" />
      <rect className="battery__fill" x="3.5" y={4.8 + inner - h} width="7" height={h} rx="1" />
      {charging && <path className="battery__bolt" d="M8.9 4.2 L3.6 11.6 H6.6 L5.3 17.6 L10.6 9.9 H7.5 Z" />}
    </svg>
  );
}

/** Thermometer with a red bulb and column. */
function ThermometerIcon() {
  return (
    <svg className="meta-icon thermo" viewBox="0 0 14 20" width="12" height="17" aria-hidden>
      <path className="thermo__glass" d="M4.6 3.4 a2.4 2.4 0 0 1 4.8 0 V11.3 a4.2 4.2 0 1 1 -4.8 0 Z" />
      <rect className="thermo__fill" x="6" y="5.6" width="2" height="8.5" rx="1" />
      <circle className="thermo__fill" cx="7" cy="14.8" r="2.4" />
    </svg>
  );
}

function TelemetryLine({ device, now }: { device: DeviceView; now: number }) {
  if (device.state === "offline") return <p className="card__meta card__meta--muted">Last seen {ago(device.lastSeenAt, now)}</p>;
  const t = device.telemetry;
  const parts: ReactNode[] = [];
  if (t?.batteryPct != null) {
    parts.push(
      <span key="b" className="meta-item" aria-label={`Battery ${Math.round(t.batteryPct)}%${t.charging ? ", charging" : ""}`}>
        <BatteryIcon pct={t.batteryPct} charging={!!t.charging} />
        {Math.round(t.batteryPct)}%
      </span>,
    );
  } else if (device.kind === "cloud") {
    parts.push(<span key="b">Always on</span>);
  }
  if (t?.tempC != null)
    parts.push(
      <span key="t" className="meta-item" aria-label={`Temperature ${t.tempC.toFixed(0)}°C`}>
        <ThermometerIcon />
        {t.tempC.toFixed(0)}°C
      </span>,
    );
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

export function TreeCard({
  device,
  readOnly,
  onRevoke,
  onRename,
  frame,
}: {
  device: DeviceView;
  readOnly: boolean;
  onRevoke(id: string): void;
  onRename(id: string, name: string): void;
  frame?: LiveFrame;
}) {
  const now = useNow();
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState(false);
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
          renaming ? (
            <RenameField
              name={device.name}
              onSave={(name) => {
                if (name !== device.name) onRename(device.id, name);
                setRenaming(false);
              }}
              onCancel={() => setRenaming(false)}
            />
          ) : confirming ? (
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
            <span className="tree-card__actions">
              <button className="link-btn tree-card__revoke" onClick={() => setRenaming(true)}>
                Rename
              </button>
              <button className="link-btn tree-card__revoke" onClick={() => setConfirming(true)}>
                Revoke
              </button>
            </span>
          )
        )}
      </div>
    </article>
  );
}

/** Inline name editor: Enter or Save keeps it, Esc or Cancel drops it. */
function RenameField({ name, onSave, onCancel }: { name: string; onSave(name: string): void; onCancel(): void }) {
  const [value, setValue] = useState(name);
  const clean = value.trim().slice(0, 60);
  return (
    <form
      className="tree-card__rename"
      onSubmit={(e) => {
        e.preventDefault();
        if (clean) onSave(clean);
      }}
    >
      <input
        autoFocus
        value={value}
        maxLength={60}
        aria-label="Device name"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        onFocus={(e) => e.currentTarget.select()}
      />
      <button className="link-btn tree-card__yes tree-card__save" disabled={!clean}>
        Save
      </button>
      <button type="button" className="link-btn" onClick={onCancel}>
        Cancel
      </button>
    </form>
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
  onRename,
  onAdd,
  selectedId,
  onSelect,
  detail,
  frames,
}: {
  devices: DeviceView[];
  /** Latest live frame per device: shown on the device's own screen while it works. */
  frames?: Record<string, LiveFrame>;
  readOnly: boolean;
  connected: boolean;
  onRevoke(id: string): void;
  onRename(id: string, name: string): void;
  onAdd(): void;
  /** The device whose graphs are open (tap a card to open them). */
  selectedId?: string | null;
  onSelect?(id: string): void;
  /** Shown full-width right under the row of the selected card (the graphs). */
  detail?: ReactNode;
}) {
  const { ordered, dragId, cardRef, dragProps, wasDrag } = useCardOrder(devices, !readOnly);
  return (
    <section className="device-grid" aria-label="Devices">
      {ordered.map((d) => [
        <div
          key={d.id}
          ref={(el) => cardRef(d.id, el)}
          className={`card-slot${dragId === d.id ? " card-slot--dragging" : ""}${selectedId === d.id ? " card-slot--selected" : ""}`}
          {...dragProps(d.id)}
          onClick={(e) => {
            // a tap opens the graphs; a drag, or a click on a button or the rename field, does not
            if (wasDrag() || (e.target as HTMLElement).closest("button, a, input, form")) return;
            onSelect?.(d.id);
          }}
        >
          <TreeCard device={d} readOnly={readOnly} onRevoke={onRevoke} onRename={onRename} frame={frames?.[d.id]} />
        </div>,
        selectedId === d.id && detail ? (
          <div key="detail" className="device-grid__detail">
            {detail}
          </div>
        ) : null,
      ])}
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

/** How much of another card the dragged card must cover before letting go swaps the two. */
const SWAP_COVER = 0.5;

/**
 * Free dragging: the card follows the pointer anywhere (mouse or touch) and nothing else moves meanwhile.
 * When it covers another card by half or more, that card slides over into the dragged card's slot (and
 * slides back if you move off); letting go there keeps the swap, anywhere else glides the card back.
 * The order is remembered here.
 */
function useCardOrder(devices: DeviceView[], enabled: boolean) {
  const [order, setOrder] = useState<string[]>(loadOrder);
  const [dragId, setDragId] = useState<string | null>(null);
  const overRef = useRef<string | null>(null);
  const dragged = useRef(false);
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
      // measure the new slot without any leftover drag offset
      el.style.transition = "none";
      el.style.transform = "";
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

  /** Swaps two cards; every card (the dragged one too, from where it was let go) glides to its new slot. */
  function swap(id: string, targetId: string) {
    if (id === targetId) return;
    const ids = orderedRef.current.map((d) => d.id);
    const from = ids.indexOf(id);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    for (const [k, el] of els.current) before.current.set(k, el.getBoundingClientRect());
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    setOrder(ids);
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify(ids));
    } catch {
      /* private mode: order just isn't remembered */
    }
  }

  /** A card's own slot on screen, ignoring any slide it is doing (so a sliding card can't flicker). */
  function slotRect(el: HTMLElement) {
    const grid = el.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const left = grid.left + el.offsetLeft;
    const top = grid.top + el.offsetTop;
    return { left, top, right: left + el.offsetWidth, bottom: top + el.offsetHeight, width: el.offsetWidth, height: el.offsetHeight };
  }

  /** The card the dragged one covers most, if it covers at least SWAP_COVER of that card's slot. */
  function coveredCard(self: string): string | null {
    const me = els.current.get(self)?.getBoundingClientRect();
    if (!me) return null;
    let best: string | null = null;
    let bestCover = SWAP_COVER;
    for (const [id, el] of els.current) {
      if (id === self) continue;
      const r = slotRect(el);
      const w = Math.min(me.right, r.right) - Math.max(me.left, r.left);
      const h = Math.min(me.bottom, r.bottom) - Math.max(me.top, r.top);
      if (w <= 0 || h <= 0) continue;
      const cover = (w * h) / (r.width * r.height);
      if (cover >= bestCover) {
        bestCover = cover;
        best = id;
      }
    }
    return best;
  }

  /** Slides the covered card over into the dragged card's slot, and the previous one back home. */
  function setOver(id: string | null) {
    const prev = overRef.current;
    if (prev === id) return;
    overRef.current = id;
    const glide = "transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1)";
    const back = prev ? els.current.get(prev) : undefined;
    if (back) {
      back.style.transition = glide;
      back.style.transform = "";
    }
    const self = drag.current ? els.current.get(drag.current.id) : undefined;
    const el = id ? els.current.get(id) : undefined;
    if (el && self) {
      el.style.transition = glide;
      el.style.transform = `translate(${self.offsetLeft - el.offsetLeft}px, ${self.offsetTop - el.offsetTop}px)`;
    }
  }

  function end() {
    const d = drag.current;
    drag.current = null;
    const target = overRef.current;
    overRef.current = null;
    dragged.current = !!d?.active; // the covered card stays where it slid to; the swap below makes that its slot
    setDragId(null);
    if (!d?.active) return;
    if (target) return swap(d.id, target);
    // no card covered enough: glide back to its own slot
    const el = els.current.get(d.id);
    if (el) {
      el.style.transition = "transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1)";
      el.style.transform = "";
    }
  }

  return {
    ordered,
    dragId,
    /** True right after a drag ended, so the click that follows it is ignored. */
    wasDrag: () => {
      const v = dragged.current;
      dragged.current = false;
      return v;
    },
    cardRef: (id: string, el: HTMLElement | null) => {
      if (el) els.current.set(id, el);
      else els.current.delete(id);
    },
    dragProps: (id: string) =>
      enabled
        ? {
            onPointerDown: (e: PointerEvent<HTMLElement>) => {
              if (e.button !== 0 || (e.target as HTMLElement).closest("button, a, input, form")) return;
              const r = e.currentTarget.getBoundingClientRect();
              drag.current = { id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, grabX: e.clientX - r.left, grabY: e.clientY - r.top, active: false, lastX: e.clientX, lastY: e.clientY };
              // capture now, so a fast move that leaves the card before the drag starts still reaches it
              e.currentTarget.setPointerCapture(e.pointerId);
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
                setDragId(id);
              }
              e.preventDefault();
              follow(id, e.clientX, e.clientY);
              setOver(coveredCard(id));
            },
            onPointerUp: (e: PointerEvent<HTMLElement>) => {
              // a quick flick may not have sent a move at the end point: place it there before deciding
              const d = drag.current;
              if (d?.active && d.id === id && d.pointerId === e.pointerId) {
                d.lastX = e.clientX;
                d.lastY = e.clientY;
                follow(id, e.clientX, e.clientY);
                setOver(coveredCard(id));
              }
              end();
            },
            onPointerCancel: end,
          }
        : {},
  };
}
