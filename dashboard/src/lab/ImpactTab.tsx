// Lab → Impact: where the AI footprint comes from. Almost all of a request's CO2e is the Gemini calls,
// and the hub stores every call (agent_step: device, step kind, model, tokens), so this breaks that
// footprint down by what the AI was doing and which device's work it was for, as shares of the whole.

import { useEffect, useState } from "react";
import type { AiUsage, AiUsageGroup, DeviceView, RunView } from "@co2lab/shared";
import { NEW_MACHINE, fmtGrams } from "../footprint";
import { fmtInt, fmtUsd } from "../format";

const RANGES = [
  { hours: 24, label: "Last 24 h" },
  { hours: 24 * 7, label: "Last 7 days" },
];
/** Single-series bars: the AI colour (validated against the light chart surface). */
const BAR = "#a0582a";

const KIND: Record<string, { label: string; lever: string }> = {
  plan: { label: "Planning the tasks", lever: "Fewer re-plans would cut it most." },
  proxy: { label: "Steering devices (taps, clicks)", lever: "Saved step-by-step recipes instead of live steering would cut it most." },
  extract: { label: "Reading screens and pages", lever: "Smaller screenshots or less page text would cut it most." },
  merge: { label: "Writing the answer", lever: "Shorter answers would cut it most." },
};

type Part = { key: string; label: string; g: number; tokens: number; calls: number };

function sum(groups: AiUsageGroup[], keyOf: (g: AiUsageGroup) => string, labelOf: (key: string) => string): Part[] {
  const m = new Map<string, Part>();
  for (const g of groups) {
    const key = keyOf(g);
    const p = m.get(key) ?? { key, label: labelOf(key), g: 0, tokens: 0, calls: 0 };
    p.g += g.gCo2;
    p.tokens += g.tokensIn + g.tokensOut;
    p.calls += g.calls;
    m.set(key, p);
  }
  return [...m.values()].sort((a, b) => b.g - a.g);
}

export function ImpactTab({ load, runs, devices }: { load(hours: number): Promise<AiUsage>; runs: RunView[]; devices: DeviceView[] }) {
  const [hours, setHours] = useState(RANGES[0]!.hours);
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [failed, setFailed] = useState(false);
  // Refetch when a request changes state (a new run, or one finishing), and every 30 s.
  const runKey = runs.map((r) => `${r.id}:${r.status}`).join(",");

  useEffect(() => {
    let live = true;
    const get = () =>
      load(hours)
        .then((u) => live && (setUsage(u), setFailed(false)))
        .catch(() => live && setFailed(true));
    void get();
    const t = setInterval(get, 30_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [hours, load, runKey]);

  const groups = usage?.groups ?? [];
  const totalG = groups.reduce((n, g) => n + g.gCo2, 0);
  const tokens = groups.reduce((n, g) => n + g.tokensIn + g.tokensOut, 0);
  const calls = groups.reduce((n, g) => n + g.calls, 0);
  const cost = groups.reduce((n, g) => n + g.costUsd, 0);
  const requests = usage?.requests ?? 0;
  const perRequest = requests ? totalG / requests : 0;
  const fitInMacMini = perRequest ? Math.round((NEW_MACHINE.kgCo2e * 1000) / perRequest) : 0;

  const name = (id: string) => (id === "hub" ? "Hub (planning and answers)" : devices.find((d) => d.id === id)?.name ?? "Removed device");
  const byKind = sum(groups, (g) => g.kind, (k) => KIND[k]?.label ?? k);
  const byDevice = sum(groups, (g) => g.deviceId ?? "hub", name);
  const tierTokens = sum(groups, (g) => g.tier, (t) => t[0]!.toUpperCase() + t.slice(1));
  const top = byKind[0];

  return (
    <div className="impact">
      <div className="impact__bar">
        <div className="seg lab-switch impact__range" role="tablist" aria-label="Time range">
          {RANGES.map((r) => (
            <button key={r.hours} role="tab" aria-selected={hours === r.hours} className={hours === r.hours ? "seg__on" : ""} onClick={() => setHours(r.hours)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {failed ? (
        <section className="panel">
          <p className="empty">Couldn't load the AI usage. It retries every 30 s.</p>
        </section>
      ) : usage === null ? (
        <section className="panel">
          <p className="empty">Loading…</p>
        </section>
      ) : !calls ? (
        <section className="panel">
          <p className="empty">No Gemini calls in this range yet. Ask your devices something and it shows up here.</p>
        </section>
      ) : (
        <>
          <section className="panel impact__hero" aria-label="Summary">
            <p className="impact__big">
              ≈ {fmtInt(fitInMacMini)} requests
            </p>
            <p className="impact__lead">
              like yours fit in the carbon of making one new {NEW_MACHINE.name} (~{NEW_MACHINE.kgCo2e} kg CO₂e). Reusing old devices skips that
              cost entirely.
            </p>
            <dl className="impact__stats">
              <div>
                <dt>Requests</dt>
                <dd>{fmtInt(requests)}</dd>
              </div>
              <div>
                <dt>Gemini calls</dt>
                <dd>{fmtInt(calls)}</dd>
              </div>
              <div>
                <dt>Tokens</dt>
                <dd>{fmtInt(tokens)}</dd>
              </div>
              <div>
                <dt>AI footprint</dt>
                <dd>{fmtGrams(totalG)} CO₂e</dd>
              </div>
              <div>
                <dt>Per request</dt>
                <dd>{fmtGrams(perRequest)}</dd>
              </div>
              <div>
                <dt>AI cost</dt>
                <dd>{fmtUsd(cost)}</dd>
              </div>
            </dl>
          </section>

          <section className="panel" aria-label="Where the AI footprint comes from">
            <h2 className="panel__title">Where the AI footprint comes from</h2>
            {top && (
              <p className="impact__lead">
                <b>{top.label}</b> is {Math.round((100 * top.g) / totalG)}% of it. {KIND[top.key]?.lever ?? ""}
              </p>
            )}
            <Shares parts={byKind} total={totalG} />
          </section>

          <section className="panel" aria-label="AI use per device">
            <h2 className="panel__title">AI use per device</h2>
            <p className="impact__lead">Gemini calls made for each device's tasks. The hub plans each request and writes the answer.</p>
            <Shares parts={byDevice} total={totalG} />
            <p className="impact__note">
              Model mix:{" "}
              {tierTokens.map((t, i) => (
                <span key={t.key}>
                  {i > 0 && " · "}
                  {t.label} {Math.round((100 * t.tokens) / tokens)}% of tokens
                </span>
              ))}
              . Lite uses about 40% of Flash's energy per token.
            </p>
          </section>
          <p className="impact__foot">
            From every Gemini call stored in Tiger Data. Energy and CO₂e are estimates from Google's published per-prompt figures.
          </p>
        </>
      )}
    </div>
  );
}

/** Shares of the whole: each row's bar is its % of the total, so rows add up to 100%. */
function Shares({ parts, total }: { parts: Part[]; total: number }) {
  return (
    <ol className="impact__rows">
      {parts.map((p) => {
        const pct = total ? (100 * p.g) / total : 0;
        return (
          <li key={p.key} className="impact__row">
            <span className="impact__name">
              {p.label}
              <small>
                {fmtInt(p.tokens)} tokens · {fmtInt(p.calls)} call{p.calls === 1 ? "" : "s"}
              </small>
            </span>
            <span className="impact__track" aria-hidden>
              <span className="impact__seg" style={{ width: `${pct}%`, background: BAR }} />
            </span>
            <span className="impact__value">
              {Math.round(pct)}%<small>{fmtGrams(p.g)}</small>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
