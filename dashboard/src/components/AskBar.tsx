import { useState, type FormEvent } from "react";
import type { Burn, RunView } from "@co2lab/shared";
import { fmtInt, fmtUsd } from "../format";

const EXAMPLE = "Best lunch deals near UTSC today";

export function AskBar({
  readOnly,
  connected,
  busy,
  onAsk,
}: {
  readOnly: boolean;
  connected: boolean;
  busy: boolean;
  onAsk(prompt: string): boolean;
}) {
  const [text, setText] = useState("");
  if (readOnly) return null;

  function submit(e: FormEvent) {
    e.preventDefault();
    const prompt = (text.trim() || EXAMPLE).slice(0, 500);
    if (onAsk(prompt)) setText("");
  }

  return (
    <form className="ask" onSubmit={submit}>
      <input
        className="ask__input"
        value={text}
        maxLength={500}
        onChange={(e) => setText(e.target.value)}
        placeholder={EXAMPLE}
        aria-label="What should the devices look for?"
        enterKeyHint="go"
      />
      <button className="btn btn--primary ask__go" disabled={!connected || busy}>
        {busy ? "Sending…" : "Ask"}
      </button>
    </form>
  );
}

const STATUS_TEXT: Record<RunView["status"], string> = {
  planning: "Planning",
  running: "Running",
  merging: "Merging",
  done: "Done",
  failed: "Failed",
};

export function BurnMeter({ run }: { run: RunView | null }) {
  const b: Burn = run?.burn ?? { tokensIn: 0, tokensOut: 0, costUsd: 0, energyWh: 0, gCo2: 0 };
  const active = run && (run.status === "planning" || run.status === "running" || run.status === "merging");
  return (
    <div className={active ? "burn burn--active" : "burn"} aria-label="Burn-o-meter for the current run">
      <span className="burn__title">
        <span className="burn__flame" aria-hidden>🔥</span> Burn
        {run && <span className={`burn__status burn__status--${run.status}`}>{STATUS_TEXT[run.status]}</span>}
      </span>
      <span className="burn__stat">
        <b>{fmtInt(b.tokensIn + b.tokensOut)}</b> tokens
      </span>
      <span className="burn__stat">
        <b>{fmtUsd(b.costUsd)}</b> est.
      </span>
      <span className="burn__stat">
        <b>{b.energyWh.toFixed(2)}</b> Wh
      </span>
      <span className="burn__stat">
        <b>{b.gCo2.toFixed(2)}</b> gCO₂
      </span>
    </div>
  );
}
