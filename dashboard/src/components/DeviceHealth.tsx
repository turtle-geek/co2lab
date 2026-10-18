// A device's last hour of temperature and battery, from the hub's telemetry table. Two separate charts
// (never one with two y-axes), each with the limit the hub enforces drawn in, and a one-line reading of
// what it means: a device kept cool and charged sensibly keeps working instead of becoming e-waste.

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { BATTERY_REST_BELOW_PCT, tempLimits, type DeviceView, type TelemetryPoint } from "@co2lab/shared";

const MINUTES = 60;
const REFRESH_MS = 30_000;

export function DeviceHealth({
  device,
  load,
  onClose,
}: {
  device: DeviceView;
  load(deviceId: string, minutes: number): Promise<TelemetryPoint[]>;
  onClose(): void;
}) {
  const [points, setPoints] = useState<TelemetryPoint[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setPoints(null);
    setFailed(false);
    const get = () =>
      load(device.id, MINUTES)
        .then((p) => live && (setPoints(p), setFailed(false)))
        .catch(() => live && setFailed(true));
    void get();
    const t = setInterval(get, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [device.id, load]);

  const sensors = device.kind !== "cloud";
  const limit = tempLimits(device.kind);
  const temps = (points ?? []).filter((p) => p.tempC !== null);
  const batts = (points ?? []).filter((p) => p.batteryPct !== null);
  const safePct = temps.length ? Math.round((100 * temps.filter((p) => p.tempC! < limit.pauseAtC).length) / temps.length) : null;
  const peak = temps.length ? Math.max(...temps.map((p) => p.tempC!)) : null;
  const bucketMin = points && points.length > 1 ? (points[points.length - 1]!.time - points[0]!.time) / (points.length - 1) / 60_000 : 0.5;
  const chargingMin = Math.min(MINUTES, Math.round(batts.filter((p) => p.charging).length * bucketMin));
  const what = device.kind === "android" ? "phone" : device.kind === "laptop" ? "laptop" : "device";

  return (
    <section className="panel health" aria-label={`${device.name}: last hour`}>
      <div className="health__head">
        <h2 className="panel__title">
          {device.name} <span className="health__span">· last hour</span>
        </h2>
        <button className="link-btn" onClick={onClose}>
          Close
        </button>
      </div>

      {!sensors ? (
        <p className="empty">The cloud worker has no battery or temperature sensors.</p>
      ) : failed ? (
        <p className="empty">Couldn't load the history. It retries every 30 s.</p>
      ) : points === null ? (
        <p className="empty">Loading…</p>
      ) : !temps.length && !batts.length ? (
        <p className="empty">No history yet. It fills in as the device reports, every 10 s.</p>
      ) : (
        <>
          <p className="health__why">
            {device.kind === "android" ? "Heat wears batteries out fastest." : "Heat wears out chips and batteries."} CO₂LAB pauses this {what} at{" "}
            {limit.pauseAtC} °C, so it keeps working instead of becoming e-waste.
          </p>
          <div className="health__stats">
            {safePct !== null && (
              <div className="health__stat">
                <b>{safePct}%</b>
                <span>of the hour under {limit.pauseAtC} °C</span>
              </div>
            )}
            {peak !== null && (
              <div className="health__stat">
                <b>{Math.round(peak)} °C</b>
                <span>peak temperature</span>
              </div>
            )}
            {batts.length > 0 &&
              (chargingMin > 0 ? (
                <div className="health__stat">
                  <b>{chargingMin} min</b>
                  <span>on the charger</span>
                </div>
              ) : (
                <div className="health__stat">
                  <b>{Math.max(0, Math.round(batts[0]!.batteryPct! - batts[batts.length - 1]!.batteryPct!))}%</b>
                  <span>battery used</span>
                </div>
              ))}
          </div>
          {temps.length > 0 && (
            <LineChart
              title="Temperature"
              unit="°C"
              color="var(--red)"
              points={points.map((p) => ({ t: p.time, v: p.tempC }))}
              yMin={Math.floor(Math.min(25, Math.min(...temps.map((p) => p.tempC!)) - 2) / 5) * 5}
              yMax={Math.ceil(Math.max(limit.pauseAtC + 4, peak! + 2) / 5) * 5}
              limit={{ value: limit.pauseAtC, label: `pauses at ${limit.pauseAtC} °C`, above: true }}
            />
          )}
          {batts.length > 0 && (
            <LineChart
              title="Battery"
              unit="%"
              color="var(--green)"
              area
              points={points.map((p) => ({ t: p.time, v: p.batteryPct, band: !!p.charging }))}
              yMin={0}
              yMax={100}
              limit={{ value: BATTERY_REST_BELOW_PCT, label: `rests below ${BATTERY_REST_BELOW_PCT}%`, above: false }}
              bandLabel="charging"
            />
          )}
        </>
      )}
    </section>
  );
}

// ---------- chart ----------

type Pt = { t: number; v: number | null; band?: boolean };

const H = 150;
const PAD = { l: 40, r: 12, t: 12, b: 22 };

function LineChart({
  title,
  unit,
  color,
  points,
  yMin,
  yMax,
  limit,
  area,
  bandLabel,
}: {
  title: string;
  unit: string;
  color: string;
  points: Pt[];
  yMin: number;
  yMax: number;
  limit: { value: number; label: string; above: boolean };
  area?: boolean;
  bandLabel?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const now = Date.now();
  const t0 = now - MINUTES * 60_000;
  const x = (t: number) => PAD.l + ((t - t0) / (now - t0)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b);
  const step = points.length > 1 ? (points[points.length - 1]!.t - points[0]!.t) / (points.length - 1) : 30_000;

  // Break the line where readings are missing for more than three buckets (device offline).
  const runs: Pt[][] = [];
  let cur: Pt[] = [];
  let prev: Pt | null = null;
  for (const p of points) {
    if (p.v === null || (prev && p.t - prev.t > step * 3.5)) {
      if (cur.length) runs.push(cur);
      cur = [];
    }
    if (p.v !== null) cur.push(p);
    prev = p;
  }
  if (cur.length) runs.push(cur);
  const path = (r: Pt[]) => r.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v!).toFixed(1)}`).join("");

  // Charging (or other) bands: contiguous runs of band=true.
  const bands: { from: number; to: number }[] = [];
  for (const p of points) {
    if (!p.band) continue;
    const last = bands[bands.length - 1];
    if (last && p.t - last.to <= step * 1.5) last.to = p.t;
    else bands.push({ from: p.t, to: p.t });
  }

  const ticks = [yMin, Math.round((yMin + yMax) / 2), yMax];
  const valid = points.filter((p) => p.v !== null);
  const hp = hover !== null ? valid[hover] : null;
  const latest = valid[valid.length - 1];

  function move(e: PointerEvent<SVGSVGElement>) {
    const r = svg.current!.getBoundingClientRect();
    const t = t0 + (((e.clientX - r.left) / r.width) * W - PAD.l) / (W - PAD.l - PAD.r) * (now - t0);
    let best = -1;
    let dist = Infinity;
    valid.forEach((p, i) => {
      const d = Math.abs(p.t - t);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    setHover(best >= 0 && dist < step * 4 ? best : null);
  }

  const fmt = (v: number) => `${unit === "%" ? Math.round(v) : v.toFixed(1)}${unit === "%" ? "%" : ` ${unit}`}`;
  const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <figure className="chart">
      <figcaption className="chart__head">
        <span className="chart__title">{title}</span>
        {latest && <span className="chart__now">now {fmt(latest.v!)}</span>}
      </figcaption>
      <div className="chart__plot" ref={box}>
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          role="img"
          aria-label={`${title} over the last hour${latest ? `, now ${fmt(latest.v!)}` : ""}. ${limit.label}.`}
          onPointerMove={move}
          onPointerLeave={() => setHover(null)}
        >
          {/* the zone past the limit, tinted */}
          <rect
            className="chart__danger"
            x={PAD.l}
            width={W - PAD.l - PAD.r}
            y={limit.above ? PAD.t : y(limit.value)}
            height={limit.above ? Math.max(0, y(limit.value) - PAD.t) : Math.max(0, H - PAD.b - y(limit.value))}
          />
          {bands.map((b, i) => (
            <rect key={i} className="chart__band" x={x(b.from)} width={Math.max(4, x(b.to) - x(b.from))} y={2} height={5} rx={2.5} />
          ))}
          {ticks.map((v) => (
            <g key={v}>
              <line className="chart__grid" x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} />
              <text className="chart__tick" x={PAD.l - 6} y={y(v)} dy="0.32em" textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          <line className="chart__limit" x1={PAD.l} x2={W - PAD.r} y1={y(limit.value)} y2={y(limit.value)} />
          {area &&
            runs.map((r, i) => (
              <path key={i} className="chart__area" style={{ fill: color }} d={`${path(r)}L${x(r[r.length - 1]!.t).toFixed(1)},${y(yMin)}L${x(r[0]!.t).toFixed(1)},${y(yMin)}Z`} />
            ))}
          {runs.map((r, i) => (
            <path key={i} className="chart__line" style={{ stroke: color }} d={path(r)} />
          ))}
          {hp && <line className="chart__cross" x1={x(hp.t)} x2={x(hp.t)} y1={PAD.t} y2={H - PAD.b} />}
          {(["60 min ago", "30 min ago", "now"] as const).map((l, i) => (
            <text key={l} className="chart__tick" x={PAD.l + (i / 2) * (W - PAD.l - PAD.r)} y={H - 6} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}>
              {l}
            </text>
          ))}
        </svg>
        {/* labels and the hover dot live in HTML so they stay crisp and round at any width */}
        <span className="chart__limit-label" style={{ top: `${(y(limit.value) / H) * 100}%` }}>
          {limit.label}
        </span>
        {bandLabel && bands[0] && (
          <span className="chart__band-label" style={{ left: `${(x(bands[0].from) / W) * 100}%` }}>
            {bandLabel}
          </span>
        )}
        {hp && (
          <>
            <span className="chart__dot" style={{ left: `${(x(hp.t) / W) * 100}%`, top: `${(y(hp.v!) / H) * 100}%`, background: color }} />
            <span
              className={x(hp.t) > W * 0.7 ? "chart__tip chart__tip--left" : "chart__tip"}
              style={{ left: `${(x(hp.t) / W) * 100}%`, top: `${(y(hp.v!) / H) * 100}%` }}
            >
              <b>{fmt(hp.v!)}</b> {clock(hp.t)}
              {hp.band && bandLabel ? ` · ${bandLabel}` : ""}
            </span>
          </>
        )}
      </div>
    </figure>
  );
}
