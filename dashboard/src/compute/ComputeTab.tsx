// Compute jobs (SPEC §4.7): start a Steam review analysis, watch the devices split it live
// (with every in-run feedback decision), and compare fast vs. eco runs.

import { useEffect, useState } from "react";
import type { AspectCount, ClientToHub, ComputeSetView, DeviceView, SplitStrategy } from "@co2lab/shared";
import "./compute.css";

const GAMES = [
  { id: 553850, name: "Helldivers 2" },
  { id: 1086940, name: "Baldur's Gate 3" },
  { id: 1091500, name: "Cyberpunk 2077" },
  { id: 1716740, name: "Starfield" },
];

const STRATEGY_TEXT: Record<SplitStrategy, string> = {
  fast: "Big batches, up to 8 threads, pause only at the safety limit (laptop CPU 90 °C, phone battery 42 °C).",
  eco: "Small batches, 2 threads, halve batches when warm (CPU 70 °C, phone 35 °C), pause at CPU 80 °C / phone 38 °C, plugged-in devices only.",
};

interface Props {
  sets: ComputeSetView[];
  devices: DeviceView[];
  readOnly: boolean;
  connected: boolean;
  send(msg: ClientToHub): boolean;
}

const secs = (s: ComputeSetView, now: number) => Math.max(0, ((s.finishedAt ?? now) - (s.startedAt ?? s.createdAt)) / 1000);
const pct = (n: number) => `${Math.round(n * 100)} %`;
const deg = (n: number | null) => (n === null ? "–" : `${n.toFixed(1)} °C`);

export function ComputeTab({ sets, devices, readOnly, connected, send }: Props) {
  const [game, setGame] = useState<string>(String(GAMES[0]!.id));
  const [custom, setCustom] = useState("");
  const [strategy, setStrategy] = useState<SplitStrategy>("eco");
  const [reviews, setReviews] = useState(3000);
  const [now, setNow] = useState(Date.now());
  const sorted = [...sets].sort((a, b) => b.createdAt - a.createdAt);
  const current = sorted[0] ?? null;
  const running = current && (current.status === "running" || current.status === "fetching");

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const appId = game === "custom" ? Number(custom) : Number(game);
  const can = !readOnly && connected;

  return (
    <div className="compute">
      {!readOnly && (
        <section className="panel">
          <h2 className="panel__title">Is this game worth it?</h2>
          <p className="cmp-meta">
            The hub fetches the game's Steam reviews and drops spam. Your old devices then analyze what players praise and complain about, in
            batches they pull themselves. The split strategy decides batch size and when a device gets paused.
          </p>
          <div className="cmp-form">
            <label>
              Game
              <select className="input" value={game} onChange={(e) => setGame(e.target.value)}>
                {GAMES.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
                <option value="custom">Other (Steam app ID)…</option>
              </select>
            </label>
            {game === "custom" && (
              <label>
                Steam app ID
                <input className="input" inputMode="numeric" placeholder="e.g. 730" value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, ""))} />
              </label>
            )}
            <label>
              Reviews
              <select className="input" value={reviews} onChange={(e) => setReviews(Number(e.target.value))}>
                <option value={1000}>1,000</option>
                <option value={3000}>3,000</option>
                <option value={6000}>6,000</option>
              </select>
            </label>
            <div className="seg" role="group" aria-label="Split strategy">
              {(["fast", "eco"] as const).map((s) => (
                <button key={s} className={strategy === s ? "seg__on" : ""} onClick={() => setStrategy(s)}>
                  {s}
                </button>
              ))}
            </div>
            {running ? (
              <button className="btn" disabled={!can} onClick={() => send({ type: "compute.cancel", setId: current!.id })}>
                Cancel
              </button>
            ) : (
              <button
                className="btn btn--primary"
                disabled={!can || !appId}
                onClick={() => send({ type: "compute.start", appId, strategy, maxReviews: reviews })}
              >
                Analyze
              </button>
            )}
          </div>
          <p className="cmp-meta">
            <b>{strategy}</b>: {STRATEGY_TEXT[strategy]}
          </p>
        </section>
      )}

      {!current && <p className="empty">No analysis yet.</p>}
      {current && <SetView s={current} devices={devices} now={now} />}
      {sorted.length > 1 && <History sets={sorted} now={now} />}
    </div>
  );
}

function SetView({ s, devices, now }: { s: ComputeSetView; devices: DeviceView[]; now: number }) {
  const done = s.batches.total ? s.batches.done / s.batches.total : 0;
  const t = secs(s, now);
  return (
    <>
      <section className="panel">
        <div className="cmp-head">
          <h2 className="panel__title">{s.title}</h2>
          <span className={`pill pill--${s.status}`}>{s.status}</span>
          <span className="pill">{s.strategy}</span>
        </div>
        {s.error && <p className="cmp-error">{s.error}</p>}
        <div className="cmp-stats">
          <Stat label="Time" value={`${t.toFixed(0)} s`} />
          <Stat label="Batches" value={`${s.batches.done} / ${s.batches.total || "…"}`} />
          <Stat label="Sentences" value={s.sentences.toLocaleString()} />
          <Stat label="Energy (est.)" value={`${s.energyWh.toFixed(3)} Wh`} />
          <Stat label="Retried" value={String(s.batches.retried)} />
        </div>
        <div className="bar" aria-label="progress">
          <div className="bar__fill" style={{ width: `${Math.round(done * 100)}%` }} />
        </div>
        <p className="cmp-meta">
          Reviews: {s.reviews.fetched.toLocaleString()} fetched, {s.reviews.kept.toLocaleString()} kept · dropped {s.reviews.dropped.lowPlaytime} under 0.5 h
          played, {s.reviews.dropped.free} free copies, {s.reviews.dropped.duplicate} templated, {s.reviews.dropped.tooShort} too short
          {s.reviews.bombDays.length > 0 && <> · review-bomb days: {s.reviews.bombDays.join(", ")}</>}
        </p>
      </section>

      <section className="panel">
        <h2 className="panel__title">Devices</h2>
        <div className="table-wrap">
          <table className="cmp-table">
            <thead>
              <tr>
                <th>Device</th>
                <th>State</th>
                <th>Batches</th>
                <th>Sentences/s</th>
                <th>Batch · threads</th>
                <th>Temp now</th>
                <th>Peak</th>
                <th>Energy (est.)</th>
              </tr>
            </thead>
            <tbody>
              {s.devices.length === 0 && (
                <tr>
                  <td colSpan={8} className="cmp-meta">
                    Waiting for a device to pull the first batch…
                  </td>
                </tr>
              )}
              {s.devices.map((d) => {
                const live = devices.find((x) => x.id === d.deviceId)?.telemetry?.tempC ?? d.tempC;
                return (
                  <tr key={d.deviceId}>
                    <td>{d.name}</td>
                    <td>
                      <span className={`pill pill--${d.state}`}>{d.state}</span>
                    </td>
                    <td>{d.batches}</td>
                    <td>{d.sentencesPerS ?? "–"}</td>
                    <td>
                      {d.batchSize || "–"} · {d.threads || "–"}
                    </td>
                    <td>{deg(live)}</td>
                    <td>{deg(d.peakTempC)}</td>
                    <td>{d.energyWh.toFixed(3)} Wh</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <h3 className="cmp-sub">Feedback decisions</h3>
        <ol className="cmp-log">
          {[...s.decisions].reverse().map((d, i) => (
            <li key={i}>
              <span className="cmp-meta">{new Date(d.at).toLocaleTimeString()}</span> {d.text}
            </li>
          ))}
        </ol>
      </section>

      {s.aspects.length > 0 && <Aspects aspects={s.aspects} />}
    </>
  );
}

function Aspects({ aspects }: { aspects: AspectCount[] }) {
  const rows = [...aspects].sort((a, b) => b.pos + b.neg - (a.pos + a.neg));
  const negShare = (p: { pos: number; neg: number }) => (p.pos + p.neg ? pct(p.neg / (p.pos + p.neg)) : "–");
  return (
    <section className="panel">
      <h2 className="panel__title">What players say</h2>
      <p className="cmp-meta">Share of sentences about each aspect that are negative, split by how long the reviewer had played when writing.</p>
      <div className="table-wrap">
        <table className="cmp-table">
          <thead>
            <tr>
              <th>Aspect</th>
              <th>Mentions</th>
              <th>Negative</th>
              <th>&lt; 5 h</th>
              <th>5–30 h</th>
              <th>30 h +</th>
              <th>Example</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.aspect}>
                <td>
                  <b>{a.aspect}</b>
                </td>
                <td>{a.pos + a.neg}</td>
                <td className={a.neg > a.pos ? "bad" : ""}>{negShare(a)}</td>
                <td>{negShare(a.byPlaytime.under5h)}</td>
                <td>{negShare(a.byPlaytime.from5to30h)}</td>
                <td>{negShare(a.byPlaytime.over30h)}</td>
                <td className="cmp-quote">{a.examples[0] ? `“${a.examples[0].text}”` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function History({ sets, now }: { sets: ComputeSetView[]; now: number }) {
  return (
    <section className="panel">
      <h2 className="panel__title">Runs compared</h2>
      <div className="table-wrap">
        <table className="cmp-table">
          <thead>
            <tr>
              <th>Game</th>
              <th>Strategy</th>
              <th>Status</th>
              <th>Time</th>
              <th>Sentences</th>
              <th>Energy (est.)</th>
              <th>Peak temp</th>
              <th>Pauses</th>
            </tr>
          </thead>
          <tbody>
            {sets.map((s) => (
              <tr key={s.id}>
                <td>{s.title}</td>
                <td>{s.strategy}</td>
                <td>{s.status}</td>
                <td>{secs(s, now).toFixed(0)} s</td>
                <td>{s.sentences.toLocaleString()}</td>
                <td>{s.energyWh.toFixed(3)} Wh</td>
                <td>{deg(s.devices.reduce<number | null>((m, d) => (d.peakTempC === null ? m : Math.max(m ?? -1, d.peakTempC)), null))}</td>
                <td>{s.decisions.filter((d) => d.text.startsWith("Paused")).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="cmp-stat">
      <span className="cmp-stat__v">{value}</span>
      <span className="cmp-stat__l">{label}</span>
    </div>
  );
}
