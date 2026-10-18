import { useState, type ReactNode } from "react";
import type { ApprovalView, DeviceView, RankedDeal, RunView, SubtaskView } from "@co2lab/shared";
import { EXAMPLE_PROMPTS, SOURCE_LABEL, capabilityLabel, useNow } from "../format";


/** "[Wendy's] $4.99 value combo" -> store "Wendy's", title "$4.99 value combo". */
function splitStore(title: string): { store: string | null; title: string } {
  const m = /^\s*\[([^\]]{1,40})\]\s*(.+)$/.exec(title);
  return m ? { store: m[1]!.trim(), title: m[2]!.trim() } : { store: null, title: title.trim() };
}

/** Keeps the price column short and comparable: "from $8.99", "$4.99", "Free", "2 for $7". */
function shortPrice(p: string | null | undefined): { short: string | null; rest: string | null } {
  if (!p?.trim()) return { short: null, rest: null };
  const t = p.trim();
  if (t.length <= 14) return { short: t, rest: null };
  const m = /(\d+\s*for\s*\$\s?\d+(?:\.\d{2})?|free|\$\s?\d+(?:\.\d{2})?)/i.exec(t);
  if (!m) return { short: null, rest: t };
  const from = /\bfrom\b/i.test(t.slice(0, m.index + 6)) ? "from " : "";
  return { short: `${from}${m[1]!.replace(/\s+/g, " ")}`, rest: t };
}

/** One ranked result, the same layout for deals and for general-agent answers. */
function ResultRow(props: {
  rank: number;
  chip: string;
  chipClass: string;
  title: string;
  url: string | null;
  price: string | null | undefined;
  lines: (string | null | undefined | false)[];
  foot: string | null;
  note?: string | null;
}) {
  const { store, title } = splitStore(props.title);
  const price = shortPrice(props.price);
  return (
    <li className="deal">
      <span className="deal__rank">{props.rank}</span>
      <div className="deal__main">
        <div className="deal__top">
          <span className={`deal__source ${props.chipClass}`}>{props.chip}</span>
          {store && <span className="deal__store">{store}</span>}
        </div>
        <h3 className="deal__title" title={title}>
          {props.url ? (
            <a href={props.url} target="_blank" rel="noreferrer">
              {title}
            </a>
          ) : (
            title
          )}
        </h3>
        {[price.rest && price.rest !== price.short ? price.rest : null, ...props.lines].filter(Boolean).map((l, i) => (
          <p key={i} className="deal__cond">
            {l}
          </p>
        ))}
        {props.foot && <p className="deal__meta">{props.foot}</p>}
        {props.note && <p className="deal__reason">{props.note}</p>}
      </div>
      <span className={price.short ? "deal__price" : "deal__price deal__price--none"}>{price.short ?? "—"}</span>
    </li>
  );
}

function DealCard({ d, deviceName }: { d: RankedDeal; deviceName: (id: string | null) => string | null }) {
  const dev = deviceName(d.deviceId);
  const foot = [d.expiresText ? `Expires ${d.expiresText}` : "No expiry shown", dev && `found by ${dev}`, d.confidence < 0.6 && "low confidence"]
    .filter(Boolean)
    .join(" · ");
  return (
    <ResultRow
      rank={d.rank}
      chip={SOURCE_LABEL[d.source]}
      chipClass={`deal__source--${d.source}`}
      title={d.title}
      url={d.url}
      price={d.priceText}
      lines={[d.conditions]}
      foot={foot}
      note={d.reason}
    />
  );
}

type StepState = "done" | "running" | "waiting" | "failed" | "skipped";

function StepIcon({ state }: { state: StepState }) {
  if (state === "running") return <span className="step__icon step__icon--running" aria-label="running" />;
  // Drawn marks (not font glyphs) so they look the same everywhere: a straight check, a cross, a dash.
  const mark =
    state === "done" ? (
      <path d="M6.5 12.5 L10.5 16.5 L17.5 8" />
    ) : state === "failed" ? (
      <path d="M8 8 L16 16 M16 8 L8 16" />
    ) : state === "skipped" ? (
      <path d="M8 12 H16" />
    ) : null;
  return (
    <span className={`step__icon step__icon--${state}`} aria-label={state}>
      {mark && (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {mark}
        </svg>
      )}
    </span>
  );
}

function Step(props: { state: StepState; title: ReactNode; detail?: ReactNode; meta?: ReactNode; children?: ReactNode }) {
  return (
    <li className={`step step--${props.state}`}>
      <StepIcon state={props.state} />
      <div className="step__body">
        <div className="step__head">
          <span className="step__title">{props.title}</span>
          {props.meta && <span className="step__meta">{props.meta}</span>}
        </div>
        {props.detail && <div className="step__detail">{props.detail}</div>}
        {props.children}
      </div>
    </li>
  );
}

const secs = (from: number | null | undefined, to: number) => (from ? `${Math.max(0, Math.round((to - from) / 1000))} s` : "");

/**
 * What the agents decided and what has run, in order (like CI checks): plan -> tasks per round -> answer.
 * Every row has one clear state, so waiting for Gemini never looks like nothing is happening.
 */
function Steps({ run, deviceName }: { run: RunView; deviceName: (id: string | null) => string | null }) {
  const now = useNow();
  const planning = run.status === "planning";
  const general = run.subtasks.some((s) => /^(Web: |App: |Review analysis)/.test(s.label ?? ""));
  const rounds = new Map<number, SubtaskView[]>();
  for (const s of run.subtasks) rounds.set(s.wave ?? 1, [...(rounds.get(s.wave ?? 1) ?? []), s]);
  const plans = (run.plan ?? "").split(/\n\n+/).filter(Boolean);
  const thinkingAgain = run.status === "running" && general && run.subtasks.every((s) => s.status !== "queued" && s.status !== "running");

  const taskRow = (s: SubtaskView) => {
    const dev = deviceName(s.deviceId);
    const state: StepState =
      s.status === "done" ? "done" : s.status === "failed" ? "failed" : s.status === "running" ? "running" : s.status === "cancelled" ? "skipped" : "waiting";
    let detail: string;
    if (s.status === "failed") detail = s.error ?? "failed";
    else if (s.status === "done") detail = s.findings ?? (s.dealCount === 0 ? "nothing found" : `${s.dealCount} ${general ? "item" : "deal"}${s.dealCount === 1 ? "" : "s"} found`);
    else if (s.status === "running") detail = dev ? `working on ${dev}` : "working";
    else if (s.status === "cancelled") detail = s.error ?? "cancelled";
    else detail = s.attempt > 1 ? "waiting for another device" : "waiting for a free device";
    return (
      <Step
        key={s.id}
        state={state}
        title={s.label ?? capabilityLabel(s.capability)}
        meta={[dev && s.status !== "running" ? dev : null, s.attempt > 1 ? `attempt ${s.attempt}` : null].filter(Boolean).join(" · ") || undefined}
        detail={detail}
      />
    );
  };

  /** The planner's reasoning for a round, shortened to its first sentences, with the rest behind "more". */
  const PlanText = ({ text, subs }: { text?: string; subs: SubtaskView[] }) => {
    if (!text) {
      // Deal-only planner (or an older hub): say what was chosen instead.
      const byDevice = new Map<string, string[]>();
      for (const s of subs) {
        const where = deviceName(s.deviceId) ?? "a free device";
        byDevice.set(where, [...(byDevice.get(where) ?? []), s.label ?? capabilityLabel(s.capability)]);
      }
      if (!byDevice.size) return null;
      return <p className="step__summary">Check {[...byDevice.entries()].map(([d, l]) => `${l.join(", ")} on ${d}`).join("; ")}.</p>;
    }
    const clean = text.replace(/^Follow-up:s*/, "");
    const short = clean.split(/(?<=[.!?])s+/).slice(0, 2).join(" ");
    return (
      <div className="step__summary">
        <p>{short}</p>
        {short.length < clean.length && (
          <details className="step__why">
            <summary>more</summary>
            <p>{clean}</p>
          </details>
        )}
      </div>
    );
  };

  const roundEntries = [...rounds.entries()];
  return (
    <ol className="steps" aria-label="What the agents are doing">
      {roundEntries.length === 0 || planning ? (
        <Step
          state={planning ? "running" : run.status === "failed" ? "failed" : "done"}
          title={planning ? "Planning with Gemini" : "Gemini made a plan"}
          meta={planning ? secs(run.createdAt, now) : undefined}
          detail={
            planning ? (
              <span className="thinking">
                Reading your request and what each device has (apps, games, browser)<span className="thinking__dots" aria-hidden />
              </span>
            ) : undefined
          }
        />
      ) : (
        roundEntries.map(([wave, subs]) => (
          // Each planning round is a step; the tasks it created are its sub-steps.
          <Step
            key={`w${wave}`}
            state="done"
            title={wave === 1 ? "Gemini made a plan" : `Gemini added follow-up ${wave - 1}`}
            meta={`${subs.length} task${subs.length === 1 ? "" : "s"}`}
            detail={<PlanText text={plans[wave - 1]} subs={subs} />}
          >
            <ol className="steps steps--sub">{subs.map(taskRow)}</ol>
          </Step>
        ))
      )}
      {thinkingAgain && (
        <Step
          state="running"
          title="Checking what is still missing"
          detail={
            <span className="thinking">
              Gemini is reading the findings and deciding the next step<span className="thinking__dots" aria-hidden />
            </span>
          }
        />
      )}
      {(run.subtasks.length > 0 || run.status === "done" || run.status === "merging") && (
        <Step
          state={run.status === "merging" ? "running" : run.status === "done" ? "done" : run.status === "failed" ? "failed" : "waiting"}
          title={general ? "Write the answer" : "Rank the deals"}
          meta={run.status === "done" && run.finishedAt ? `total ${secs(run.createdAt, run.finishedAt)}` : undefined}
          detail={
            run.status === "failed" ? (
              run.error ?? "no task finished"
            ) : run.status === "merging" ? (
              <span className="thinking">
                Combining what the devices found<span className="thinking__dots" aria-hidden />
              </span>
            ) : undefined
          }
        />
      )}
    </ol>
  );
}



export function Approvals({
  approvals,
  readOnly,
  connected,
  onRespond,
}: {
  approvals: ApprovalView[];
  readOnly: boolean;
  connected: boolean;
  onRespond(id: string, approve: boolean): void;
}) {
  if (!approvals.length) return null;
  return (
    <section className="approvals" aria-label="Waiting for approval">
      {approvals.map((a) => (
        <div key={a.id} className="approval card">
          <p className="approval__head">
            Send to <b>{a.target}</b> on WhatsApp?
          </p>
          <pre className="approval__msg">{a.message}</pre>
          {readOnly ? (
            <p className="approval__wait">Waiting for the owner to approve.</p>
          ) : (
            <div className="approval__actions">
              <button className="btn btn--primary" disabled={!connected} onClick={() => onRespond(a.id, true)}>
                Approve and send
              </button>
              <button className="btn" disabled={!connected} onClick={() => onRespond(a.id, false)}>
                Deny
              </button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

function ShareToGroup({ onShare, disabled }: { onShare(target: string): void; disabled: boolean }) {
  const [target, setTarget] = useState(() => {
    try {
      return localStorage.getItem("co2lab.shareTarget") ?? "Lunch group";
    } catch {
      return "Lunch group";
    }
  });
  return (
    <form
      className="share-group"
      onSubmit={(e) => {
        e.preventDefault();
        const t = target.trim();
        if (!t) return;
        try {
          localStorage.setItem("co2lab.shareTarget", t);
        } catch {
          /* private mode */
        }
        onShare(t);
      }}
    >
      <input className="input" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="WhatsApp group name" />
      <button className="btn" disabled={disabled}>
        Send to group…
      </button>
    </form>
  );
}

export function Results({
  run,
  devices,
  readOnly,
  connected,
  onShare,
  children,
  onAsk,
}: {
  children?: ReactNode;
  run: RunView | null;
  devices: DeviceView[];
  readOnly: boolean;
  connected: boolean;
  onShare(runId: string, target: string): void;
  onAsk?(prompt: string): boolean;
}) {
  const deviceName = (id: string | null) => (id ? devices.find((d) => d.id === id)?.name ?? "a removed device" : null);

  if (!run) {
    return (
      <section className="panel results" aria-label="Results">
        <h2 className="panel__title">Agent run</h2>
        {readOnly ? (
          <p className="empty">No run yet. Results show up here live.</p>
        ) : (
          <>
            <p className="empty">Ask your devices for something. A few things they can do:</p>
            <div className="suggest">
              {EXAMPLE_PROMPTS.map((p) => (
                <button key={p} className="suggest__chip" disabled={!connected} onClick={() => onAsk?.(p)}>
                  {p}
                </button>
              ))}
            </div>
          </>
        )}
        {children}
      </section>
    );
  }

  const finished = run.status === "done" || run.status === "failed";
  const outcome = (
    <>
        {run.answer && (
          <div className="answer">
            <p className="answer__text">{run.answer.text}</p>
            {run.answer.items.length > 0 && (
              <ol className="deals">
                {run.answer.items.map((it, i) => (
                  <ResultRow
                    key={i}
                    rank={i + 1}
                    chip={it.source}
                    chipClass="deal__source--agent"
                    title={it.title}
                    url={it.url}
                    price={it.price}
                    lines={[it.detail]}
                    foot={deviceName(it.deviceId) ? `found by ${deviceName(it.deviceId)}` : null}
                  />
                ))}
              </ol>
            )}
          </div>
        )}
        {run.status === "failed" && (
          <div className="results__failed">
            <b>Run failed.</b> {run.error ?? "No task finished."}
          </div>
        )}
  
        {run.ranked && (
          <>
            {run.ranked.length === 0 ? (
              <p className="empty">No deals found in any source.</p>
            ) : (
              <ol className="deals">
                {run.ranked.map((d) => (
                  <DealCard key={`${d.rank}-${d.title}`} d={d} deviceName={deviceName} />
                ))}
              </ol>
            )}
            {!readOnly && run.status === "done" && run.ranked.length > 0 && (
              <ShareToGroup disabled={!connected} onShare={(t) => onShare(run.id, t)} />
            )}
          </>
        )}
      </>
  );
  return (
    <section className="panel results" aria-label="Results">
      <h2 className="panel__title">
        Agent run <span className="results__prompt">“{run.prompt}”</span>
      </h2>

      {finished ? (
        // Finished: the answer is the main thing; the steps fold into one line you can open.
        <>
          {outcome}
          <details className="steps-fold">
            <summary>
              <StepIcon state={run.status === "failed" ? "failed" : "done"} />
              <span>
                {run.subtasks.length + 2} steps · {Math.max(1, Math.round(((run.finishedAt ?? Date.now()) - run.createdAt) / 1000))} s
              </span>
              <span className="steps-fold__open">Show steps</span>
            </summary>
            <Steps run={run} deviceName={deviceName} />
          </details>
        </>
      ) : (
        <Steps run={run} deviceName={deviceName} />
      )}
      {children}
    </section>
  );
}
