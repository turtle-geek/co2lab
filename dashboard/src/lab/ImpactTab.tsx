// Lab → Impact: what each request to the agents cost the planet, and how much work the old devices
// did instead of a new machine. One row per request (newest on top), straight from the runs the hub
// already sends (burn + subtask timings), so a new request shows up here as soon as it runs.

import { useState } from "react";
import type { DeviceView, RunView } from "@co2lab/shared";
import { NEW_MACHINE, deviceUse, fmtDuration, fmtGrams } from "../footprint";

const MAX_ROWS = 12;
/** Validated with the dataviz palette checks (light surface): AI vs your devices. */
const AI_COLOR = "#a0582a";
const DEVICE_COLOR = "#5c9f4c";
/** Per-device colours, assigned by device (sorted id), never by rank. Validated as a set. */
const DEVICE_COLORS = ["#5c9f4c", "#3a82c9", "#c4851b", "#8a5cc4"];
const OTHER_COLOR = "#9aa093";

type Seg = { key: string; label: string; value: number; color: string };
type Row = { run: RunView; segs: Seg[]; total: number; text: string; detail: string };

export function ImpactTab({ runs, devices }: { runs: RunView[]; devices: DeviceView[] }) {
  const recent = [...runs]
    .filter((r) => r.status !== "planning" || r.subtasks.length)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_ROWS);

  if (!recent.length) {
    return (
      <section className="panel impact">
        <h2 className="panel__title">Impact</h2>
        <p className="empty">No requests yet. Ask your devices something and its footprint shows up here.</p>
      </section>
    );
  }

  // ---- footprint per request: AI vs your devices ----
  const foot: Row[] = recent.map((run) => {
    const ai = run.burn.gCo2;
    const dev = deviceUse(run, devices);
    return {
      run,
      total: ai + dev.g,
      segs: [
        { key: "ai", label: "AI", value: ai, color: AI_COLOR },
        { key: "dev", label: "Your devices", value: dev.g, color: DEVICE_COLOR },
      ],
      text: `${fmtGrams(ai + dev.g)}`,
      detail: `AI ${fmtGrams(ai)} · your devices ${fmtGrams(dev.g)}`,
    };
  });
  const footTotal = foot.reduce((n, r) => n + r.total, 0);
  const aiTotal = foot.reduce((n, r) => n + r.segs[0]!.value, 0);
  const aiShare = footTotal ? Math.round((100 * aiTotal) / footTotal) : 0;

  // ---- old-device work per request, one segment per device ----
  const kind = new Map(devices.map((d) => [d.id, d]));
  const old = devices.filter((d) => d.kind !== "cloud").sort((a, b) => a.id.localeCompare(b.id));
  const colorOf = (id: string) => {
    const i = old.findIndex((d) => d.id === id);
    return i >= 0 && i < DEVICE_COLORS.length ? DEVICE_COLORS[i]! : OTHER_COLOR;
  };
  const nameOf = (id: string) => kind.get(id)?.name ?? "Removed device";
  const work: Row[] = recent.map((run) => {
    const per = new Map<string, number>();
    for (const s of run.subtasks) {
      if (!s.deviceId || !s.startedAt || kind.get(s.deviceId)?.kind === "cloud") continue;
      per.set(s.deviceId, (per.get(s.deviceId) ?? 0) + Math.max(0, (s.finishedAt ?? Date.now()) - s.startedAt));
    }
    const segs = [...per.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([id, ms]) => ({ key: id, label: nameOf(id), value: ms, color: colorOf(id) }));
    const total = segs.reduce((n, s) => n + s.value, 0);
    return {
      run,
      segs,
      total,
      text: total ? fmtDuration(total) : "none",
      detail: segs.length ? segs.map((s) => `${s.label} ${fmtDuration(s.value)}`).join(" · ") : "No old device worked on this one",
    };
  });
  const workTotal = work.reduce((n, r) => n + r.total, 0);
  const usedIds = new Set(work.flatMap((r) => r.segs.map((s) => s.key)));
  const workLegend = [...usedIds].sort().map((id) => ({ label: nameOf(id), color: colorOf(id) }));

  return (
    <div className="impact">
      <section className="panel impact__card" aria-label="Footprint per request">
        <h2 className="panel__title">Footprint per request</h2>
        <p className="impact__lead">
          <b>{fmtGrams(footTotal)} CO₂e</b> across {recent.length} request{recent.length === 1 ? "" : "s"}. {aiShare}% of it is the AI; your devices
          run on Ontario's low-carbon grid.
        </p>
        <Legend items={[{ label: "AI", color: AI_COLOR }, { label: "Your devices", color: DEVICE_COLOR }]} />
        <Bars rows={foot} />
      </section>

      <section className="panel impact__card" aria-label="Work done on old devices">
        <h2 className="panel__title">Work done on old devices</h2>
        <p className="impact__lead">
          Your old devices worked <b>{fmtDuration(workTotal)}</b> on these requests, instead of a new {NEW_MACHINE.name} (
          <b>${NEW_MACHINE.priceCad}</b>, <b>~{NEW_MACHINE.kgCo2e} kg CO₂e</b> to make).
        </p>
        {workLegend.length > 1 && <Legend items={workLegend} />}
        <Bars rows={work} />
      </section>
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="impact__legend">
      {items.map((i) => (
        <li key={i.label}>
          <span className="impact__swatch" style={{ background: i.color }} aria-hidden />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

const STATUS: Record<RunView["status"], string> = {
  planning: "planning",
  running: "running",
  merging: "writing the answer",
  done: "done",
  failed: "failed",
  cancelled: "cancelled",
};

/** Horizontal stacked bars, one row per request: name on the left, bar, total on the right. */
function Bars({ rows }: { rows: Row[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(...rows.map((r) => r.total), 0) || 1;
  return (
    <ol className="impact__rows">
      {rows.map((r) => {
        const tasks = r.run.subtasks.length;
        const when = new Date(r.run.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        return (
          <li
            key={r.run.id}
            className="impact__row"
            onPointerEnter={() => setHover(r.run.id)}
            onPointerLeave={() => setHover(null)}
            tabIndex={0}
            onFocus={() => setHover(r.run.id)}
            onBlur={() => setHover(null)}
          >
            <span className="impact__name" title={r.run.prompt}>
              {r.run.title || r.run.prompt}
              <small>
                {when} · {tasks} task{tasks === 1 ? "" : "s"} · {STATUS[r.run.status]}
              </small>
            </span>
            <span className="impact__track" aria-hidden>
              {r.segs
                .filter((s) => s.value > 0)
                .map((s) => (
                  <span key={s.key} className="impact__seg" style={{ width: `${(100 * s.value) / max}%`, background: s.color }} />
                ))}
            </span>
            <span className="impact__value">{r.text}</span>
            {hover === r.run.id && (
              <span className="impact__tip" role="tooltip">
                <b>“{r.run.prompt}”</b>
                <br />
                {r.detail}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
