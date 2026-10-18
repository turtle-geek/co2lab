import { useState, type FormEvent } from "react";
import type { Burn, DeviceView, RunView } from "@co2lab/shared";
import { fmtUsd } from "../format";
import { GRID_G_PER_KWH, deviceUse, fmtGrams } from "../footprint";

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

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/**
 * This request's footprint: the AI calls (Google's published per-prompt figures) plus the electricity
 * the old devices used on Ontario's grid (see footprint.ts), how long those devices worked, and AI cost.
 */
export function BurnMeter({ run, devices }: { run: RunView | null; devices: DeviceView[] }) {
  const b: Burn = run?.burn ?? { tokensIn: 0, tokensOut: 0, costUsd: 0, energyWh: 0, gCo2: 0 };
  const active = run && (run.status === "planning" || run.status === "running" || run.status === "merging");
  const use = deviceUse(run, devices);
  const total = b.gCo2 + use.g;
  return (
    <div className={active ? "burn burn--active" : "burn"} aria-label="Footprint of the current request">
      <span className="burn__title">
        <span className="burn__flame" aria-hidden>🔥</span> Burn
        {run && <span className={`burn__status burn__status--${run.status}`}>{STATUS_TEXT[run.status]}</span>}
      </span>
      <span
        className="burn__stat"
        title={
          `AI: ${fmtGrams(b.gCo2)} (${b.energyWh.toFixed(2)} Wh, Google's per-prompt figures). ` +
          `Your devices: ${fmtGrams(use.g)} (about ${use.wh.toFixed(2)} Wh on Ontario's grid, ${GRID_G_PER_KWH} g CO₂e per kWh). Estimates.`
        }
      >
        <span className="burn__label">Footprint</span>
        <b>{fmtGrams(total)} CO₂e</b>
      </span>
      {use.devices > 0 && (
        <span className="burn__stat burn__stat--green" title="Old devices that worked on this request, and for how long: hardware you already own instead of a new machine.">
          <span className="burn__label">Old devices</span>
          <b>
            {use.devices} · {fmtDuration(use.ms)}
          </b>
        </span>
      )}
      <span className="burn__stat" title="What the Gemini calls cost at list prices (estimate).">
        <span className="burn__label">AI cost</span>
        <b>{fmtUsd(b.costUsd)}</b>
      </span>
    </div>
  );
}
