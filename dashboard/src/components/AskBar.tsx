import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Burn, DeviceView, RunView } from "@co2lab/shared";
import { fmtUsd } from "../format";
import { NEW_MACHINE, deviceUse, fmtDuration, fmtGrams } from "../footprint";

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
        placeholder="What should your devices do today?"
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

/**
 * This request's footprint: the AI calls (Google's published per-prompt figures) plus the electricity
 * the old devices used on Ontario's grid (see footprint.ts), how long those devices worked, and AI cost.
 * Pressing it opens a short explanation, including what it took to make the old devices.
 */
export function BurnMeter({ run, devices }: { run: RunView | null; devices: DeviceView[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const b: Burn = run?.burn ?? { tokensIn: 0, tokensOut: 0, costUsd: 0, energyWh: 0, gCo2: 0 };
  const active = run && (run.status === "planning" || run.status === "running" || run.status === "merging");
  const use = deviceUse(run, devices);
  const total = b.gCo2 + use.g;

  return (
    <div className="burn-wrap" ref={box}>
      <button
        type="button"
        className={active ? "burn burn--active" : "burn"}
        aria-expanded={open}
        aria-controls="burn-info"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="burn__title">
          <span className="burn__flame" aria-hidden>🔥</span> Burn
          {run && <span className={`burn__status burn__status--${run.status}`}>{STATUS_TEXT[run.status]}</span>}
        </span>
        <span className="burn__stat">
          <span className="burn__label">Footprint</span>
          <b>{fmtGrams(total)} CO₂e</b>
        </span>
        {use.devices > 0 && (
          <span className="burn__stat burn__stat--green">
            <span className="burn__label">Old devices</span>
            <b>
              {use.devices} · {fmtDuration(use.ms)}
            </b>
          </span>
        )}
        <span className="burn__stat">
          <span className="burn__label">AI cost</span>
          <b>{fmtUsd(b.costUsd)}</b>
        </span>
        <span className="burn__info-icon" aria-hidden>
          <svg viewBox="0 0 20 20" width="18" height="18">
            <circle cx="10" cy="10" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <circle cx="10" cy="6.2" r="1.25" fill="currentColor" />
            <path d="M10 9.2v5.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="burn-info" id="burn-info" role="dialog" aria-label="What Burn means">
          <dl>
            <dt>Saved</dt>
            <dd>
              Your old devices run the agents instead of a new {NEW_MACHINE.name}, saving <b>${NEW_MACHINE.priceCad}</b> and <b>~{NEW_MACHINE.kgCo2e} kg CO₂e</b>.
            </dd>
            <dt>Footprint</dt>
            <dd>
              This request: AI {fmtGrams(b.gCo2)} + your devices {fmtGrams(use.g)}.
            </dd>
            <dt>Old devices</dt>
            <dd>{use.devices ? `${use.devices} worked for ${fmtDuration(use.ms)}.` : "None worked on this request yet."}</dd>
            <dt>AI cost</dt>
            <dd>Gemini calls at list prices.</dd>
          </dl>
          <p className="burn-info__note">Estimates. CO₂e = all greenhouse gases as CO₂.</p>
        </div>
      )}
    </div>
  );
}
