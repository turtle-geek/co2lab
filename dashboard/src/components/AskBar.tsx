import { useState, type FormEvent } from "react";
import type { Burn, RunView } from "@co2lab/shared";
import { fmtInt, fmtUsd } from "../format";

const EXAMPLE = "Best lunch deals near UTSC today";

export function AskBar({
  readOnly,
  connected,
  busy,
  onAsk,
  onCancel,
}: {
  readOnly: boolean;
  connected: boolean;
  busy: boolean;
  onAsk(prompt: string): boolean;
  /** Set while a run is going: shows Cancel next to Ask. */
  onCancel?: () => void;
}) {
  const [text, setText] = useState("");
  if (readOnly) return null;
  const example = EXAMPLE;

  function submit(e: FormEvent) {
    e.preventDefault();
    const prompt = (text.trim() || example).slice(0, 500);
    if (onAsk(prompt)) setText("");
  }

  return (
    <form className="ask" onSubmit={submit}>
      <input
        className="ask__input"
        value={text}
        maxLength={500}
        onChange={(e) => setText(e.target.value)}
        placeholder="Ask your devices, e.g. lunch deals near UTSC"
        aria-label="Ask your devices"
        enterKeyHint="go"
      />
      <button className="btn btn--primary ask__go" disabled={!connected || busy}>
        {busy ? "Sending…" : "Ask"}
      </button>
      {onCancel && (
        <button type="button" className="btn ask__cancel" disabled={!connected} onClick={onCancel}>
          Cancel
        </button>
      )}
    </form>
  );
}

const STATUS_TEXT: Record<RunView["status"], string> = {
  planning: "Planning",
  running: "Running",
  merging: "Merging",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Time each device spent on this request's tasks: work done on reused hardware instead of new machines. */
function deviceWork(run: RunView | null): { ms: number; devices: number } {
  const per = new Map<string, number>();
  for (const st of run?.subtasks ?? []) {
    if (!st.deviceId || !st.startedAt) continue;
    const end = st.finishedAt ?? Date.now();
    per.set(st.deviceId, (per.get(st.deviceId) ?? 0) + Math.max(0, end - st.startedAt));
  }
  return { ms: [...per.values()].reduce((a, b) => a + b, 0), devices: per.size };
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** A 10 W LED bulb: an easy picture for small amounts of energy. */
const LED_W = 10;
function ledTime(wh: number): string {
  const min = (wh / LED_W) * 60;
  return min < 1 ? `${Math.max(1, Math.round(min * 60))} s` : min < 90 ? `${Math.round(min)} min` : `${(min / 60).toFixed(1)} h`;
}

export function BurnMeter({ run }: { run: RunView | null }) {
  const b: Burn = run?.burn ?? { tokensIn: 0, tokensOut: 0, costUsd: 0, energyWh: 0, gCo2: 0 };
  const active = run && (run.status === "planning" || run.status === "running" || run.status === "merging");
  const work = deviceWork(run);
  return (
    <div className={active ? "burn burn--active" : "burn"} aria-label="Burn-o-meter for the current request">
      <span className="burn__title">
        <span className="burn__flame" aria-hidden>🔥</span> Burn
        {run && <span className={`burn__status burn__status--${run.status}`}>{STATUS_TEXT[run.status]}</span>}
      </span>
      <span
        className="burn__stat burn__stat--green"
        title={`Time your old devices worked on this request${work.devices ? ` (${work.devices} device${work.devices === 1 ? "" : "s"})` : ""}: work on hardware you already own instead of new machines.`}
      >
        <span className="burn__label">Old devices</span>
        <b>{fmtDuration(work.ms)}</b>
      </span>
      <span
        className="burn__stat"
        title={`AI energy: ${b.energyWh.toFixed(2)} Wh, about a 10 W LED bulb for that long; ${b.gCo2.toFixed(1)} g CO₂ (estimates from Google's published per-prompt figures).`}
      >
        <span className="burn__label">Energy</span>
        <b>{b.energyWh > 0 ? `💡 ${ledTime(b.energyWh)}` : "0"}</b>
      </span>
      <span className="burn__stat" title={`What the Gemini calls cost at list prices (estimate): ${fmtInt(b.tokensIn + b.tokensOut)} tokens.`}>
        <span className="burn__label">AI cost</span>
        <b>{fmtUsd(b.costUsd)}</b>
      </span>
    </div>
  );
}
