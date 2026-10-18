import { useState, type ReactNode } from "react";
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

function TelemetryLine({ device, now }: { device: DeviceView; now: number }) {
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
          <h3>{device.name}</h3>
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
            <span className="tree-card__confirm">
              Revoke {device.name}?
              <button className="link-btn tree-card__yes" onClick={() => onRevoke(device.id)}>
                Yes, revoke
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
  return (
    <section className="device-grid" aria-label="Devices">
      {devices.map((d) => (
        <TreeCard key={d.id} device={d} readOnly={readOnly} onRevoke={onRevoke} frame={frames?.[d.id]} />
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
