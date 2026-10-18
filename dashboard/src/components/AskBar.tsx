import { useEffect, useState, type FormEvent } from "react";
import type { Burn, RunView } from "@co2lab/shared";
import { EXAMPLE_PROMPTS, fmtInt, fmtUsd } from "../format";

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
  const [focused, setFocused] = useState(false);
  const [i, setI] = useState(0);
  // Rotate through real examples while the box is empty and idle; Enter on an empty box runs the one shown.
  useEffect(() => {
    if (focused || text) return;
    const t = setInterval(() => setI((n) => (n + 1) % EXAMPLE_PROMPTS.length), 4_000);
    return () => clearInterval(t);
  }, [focused, text]);
  if (readOnly) return null;
  const example = EXAMPLE_PROMPTS[i] ?? EXAMPLE;

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
        placeholder={example}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-label="Ask your devices"
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
      <span className="burn__stat" title="What the Gemini calls for this request cost, at list prices (estimate)">
        <span className="burn__label">AI cost</span>
        <b>{fmtUsd(b.costUsd)}</b>
      </span>
      <span className="burn__stat" title={`${b.energyWh.toFixed(2)} Wh of data-centre energy (estimate from Google's published per-prompt figures). A phone charge is about ${PHONE_CHARGE_WH} Wh.`}>
        <span className="burn__label">Energy</span>
        <b>{phoneCharges(b.energyWh)}</b>
      </span>
      <span className="burn__stat" title={`${b.gCo2.toFixed(2)} g CO₂ (estimate). A petrol car emits about ${CAR_G_PER_KM} g per km.`}>
        <span className="burn__label">CO₂</span>
        <b>{carDistance(b.gCo2)}</b>
      </span>
      <span className="burn__stat burn__stat--minor" title="Tokens: the amount of text and images the AI read and wrote">
        {fmtInt(b.tokensIn + b.tokensOut)} tokens
      </span>
    </div>
  );
}

/** Everyday comparisons for the burn-o-meter (rough, labeled as estimates in the tooltips). */
const PHONE_CHARGE_WH = 12;
const CAR_G_PER_KM = 150;

function phoneCharges(wh: number): string {
  if (wh <= 0) return "0";
  const n = wh / PHONE_CHARGE_WH;
  return n < 0.1 ? `${Math.max(1, Math.round(n * 100))}% of a phone charge` : `${n.toFixed(1)} phone charges`;
}

function carDistance(g: number): string {
  if (g <= 0) return "0";
  const m = (g / CAR_G_PER_KM) * 1000;
  return m < 1000 ? `≈ ${Math.max(1, Math.round(m))} m of driving` : `≈ ${(m / 1000).toFixed(1)} km of driving`;
}
