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

const secs = (from: number | null | undefined, to: number) => (from ? `${Math.max(0, Math.round((to - from) / 1000))} s` : "");

/** One row in the task tree: icon, name, then device and result on the right (one line, like a task list). */
function Row(props: { state: StepState; name: ReactNode; device?: string | null; result?: ReactNode; bold?: boolean }) {
  return (
    <li className={`trow trow--${props.state}${props.bold ? " trow--group" : ""}`}>
      <StepIcon state={props.state} />
      <span className="trow__name">{props.name}</span>
      {props.device && <span className="trow__device">{props.device}</span>}
      {props.result !== undefined && <span className="trow__result">{props.result}</span>}
    </li>
  );
}

/** What each device told the planner, in a few words ("88 apps", "Microsoft Edge"). */
function shares(d: DeviceView): string {
  const c = d.context ?? [];
  const apps = c.filter((x) => x.kind === "installed_app").length;
  const games = c.filter((x) => x.kind === "steam_game").length;
  const browser = c.find((x) => x.kind === "browser")?.label;
  return [apps ? `${apps} apps` : "", games ? `${games} games` : "", browser ?? ""].filter(Boolean).join(" · ") || d.kind;
}

/**
 * The request as a task tree: a parent row (title, done / to-do counts, time), then groups: the devices
 * the planner looked at, one group per planning round (named by the planner), and the final step.
 */
function Steps({ run, devices }: { run: RunView; devices: DeviceView[] }) {
  const now = useNow();
  const deviceName = (id: string | null) => (id ? devices.find((d) => d.id === id)?.name ?? "removed device" : null);
  const planning = run.status === "planning";
  const general = run.subtasks.some((s) => s.tool && s.tool !== "deals");
  const rounds = new Map<number, SubtaskView[]>();
  for (const s of run.subtasks) rounds.set(s.wave ?? 1, [...(rounds.get(s.wave ?? 1) ?? []), s]);
  const done = run.subtasks.filter((s) => s.status === "done").length;
  const todo = run.subtasks.filter((s) => s.status === "queued" || s.status === "running").length;
  const failed = run.subtasks.filter((s) => s.status === "failed").length;
  const finished = run.status === "done" || run.status === "failed";
  const thinkingAgain = run.status === "running" && general && run.subtasks.length > 0 && run.subtasks.every((s) => s.status !== "queued" && s.status !== "running");
  // Devices the planner could use: the ones it gave work to, plus any online one that shares something.
  const used = new Set(run.subtasks.map((s) => s.deviceId).filter(Boolean));
  const scoped = devices.filter((d) => d.state !== "revoked" && (used.has(d.id) || (d.state !== "offline" && (d.context?.length ?? 0) > 0)));

  const taskState = (s: SubtaskView): StepState =>
    s.status === "done" ? "done" : s.status === "failed" ? "failed" : s.status === "running" ? "running" : s.status === "cancelled" ? "skipped" : "waiting";
  const result = (s: SubtaskView): string => {
    if (s.status === "failed") return s.error ?? "failed";
    if (s.status === "cancelled") return "cancelled";
    if (s.status === "running") return "running…";
    if (s.status === "queued") return s.attempt > 1 ? "waiting for another device" : "waiting";
    if (s.tool && s.tool !== "deals") return s.findings ?? `${s.dealCount} found`;
    return `${s.dealCount} deal${s.dealCount === 1 ? "" : "s"}`;
  };

  return (
    <div className="ttree" aria-label="What the agents are doing">
      <div className="ttree__head">
        <StepIcon state={planning || !finished ? "running" : run.status === "failed" ? "failed" : "done"} />
        <span className="ttree__title">{run.title || (planning ? "Planning" : run.prompt)}</span>
        {done > 0 && <span className="tchip tchip--done">{done} done</span>}
        {todo > 0 && <span className="tchip tchip--todo">{todo} to do</span>}
        {failed > 0 && <span className="tchip tchip--failed">{failed} failed</span>}
        <span className="ttree__time">{secs(run.createdAt, run.finishedAt ?? now)}</span>
      </div>
      <ul className="ttree__body">
        <li className="tgroup">
          <span className="tgroup__name">Check your devices</span>
          <ul>
            {planning && !scoped.length && <Row state="running" name="Reading what each device has" />}
            {scoped.map((d) => (
              <Row key={d.id} state={planning ? "running" : "done"} name={d.name} result={shares(d)} />
            ))}
          </ul>
        </li>
        {planning && (
          <li className="tgroup">
            <span className="tgroup__name">Plan the work</span>
            <ul>
              <Row state="running" name={<span className="thinking">Gemini is choosing the tasks<span className="thinking__dots" aria-hidden /></span>} />
            </ul>
          </li>
        )}
        {[...rounds.entries()].map(([wave, subs]) => (
          <li key={wave} className="tgroup">
            <span className="tgroup__name">{run.stages?.[wave - 1] || (wave === 1 ? (general ? "Do the tasks" : "Collect deals") : "Next step")}</span>
            <ul>
              {subs.map((s) => (
                <Row key={s.id} state={taskState(s)} name={s.name ?? s.label ?? capabilityLabel(s.capability)} device={deviceName(s.deviceId)} result={result(s)} />
              ))}
            </ul>
          </li>
        ))}
        {thinkingAgain && (
          <li className="tgroup">
            <span className="tgroup__name">Plan the next step</span>
            <ul>
              <Row state="running" name={<span className="thinking">Gemini is reading the findings<span className="thinking__dots" aria-hidden /></span>} />
            </ul>
          </li>
        )}
        {run.subtasks.length > 0 && (
          <li className="tgroup">
            <span className="tgroup__name">Finish</span>
            <ul>
              <Row
                state={run.status === "merging" ? "running" : run.status === "done" ? "done" : run.status === "failed" ? "failed" : "waiting"}
                name={general ? "Write the answer" : "Rank the deals"}
                result={
                  run.status === "failed"
                    ? run.error ?? "no task finished"
                    : run.status === "done"
                      ? general
                        ? "answer ready"
                        : `${run.ranked?.length ?? 0} deals ranked`
                      : run.status === "merging"
                        ? "working…"
                        : undefined
                }
              />
            </ul>
          </li>
        )}
      </ul>
    </div>
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
            <Steps run={run} devices={devices} />
          </details>
        </>
      ) : (
        <Steps run={run} devices={devices} />
      )}
      {children}
    </section>
  );
}
