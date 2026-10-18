import { useState, type ReactNode } from "react";
import type { ApprovalView, DeviceView, RankedDeal, RunView, SubtaskView } from "@co2lab/shared";
import { SOURCE_LABEL, capabilityLabel, useNow } from "../format";

const SUB_STATUS: Record<SubtaskView["status"], string> = {
  queued: "Queued",
  running: "Running",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

function SubtaskRow({ s, deviceName }: { s: SubtaskView; deviceName: (id: string | null) => string | null }) {
  const dev = deviceName(s.deviceId);
  let detail: string;
  if (s.status === "failed") detail = `failed: ${s.error ?? "no reason given"}`;
  else if (s.status === "done" && s.findings !== undefined && s.findings !== null) detail = s.findings;
  else if (s.status === "done") detail = s.dealCount === 0 ? "no deals found" : `${s.dealCount} deal${s.dealCount === 1 ? "" : "s"}`;
  else if (s.status === "running") detail = dev ? `on ${dev}` : "running";
  else if (s.status === "cancelled") detail = s.error ?? "cancelled";
  else detail = s.attempt > 1 ? "waiting for another device" : "waiting for a device";

  return (
    <li className={`subtask subtask--${s.status}`}>
      <span className="subtask__name">{s.label ?? capabilityLabel(s.capability)}</span>
      <span className={`pill pill--sub-${s.status}`}>{SUB_STATUS[s.status]}</span>
      <span className="subtask__detail">
        {detail}
        {s.attempt > 1 && <span className="subtask__attempt"> · attempt {s.attempt}</span>}
        {s.status === "done" && dev && <span className="subtask__dev"> · {dev}</span>}
      </span>
    </li>
  );
}

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

function PlanningState({ since }: { since: number }) {
  const now = useNow();
  return (
    <div className="planning" role="status">
      <span className="spinner" aria-hidden />
      <div>
        <b>Planning with Gemini…</b> <span className="planning__secs">{Math.max(0, Math.round((now - since) / 1000))} s</span>
        <p>Checking which devices are online and what each one has (apps, games, browser), then choosing the tasks.</p>
      </div>
    </div>
  );
}

function PlanBox({ plan }: { plan: string }) {
  return (
    <details className="planbox" open>
      <summary>Why this plan</summary>
      {plan.split(/\n\n+/).map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </details>
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
}: {
  children?: ReactNode;
  run: RunView | null;
  devices: DeviceView[];
  readOnly: boolean;
  connected: boolean;
  onShare(runId: string, target: string): void;
}) {
  const deviceName = (id: string | null) => (id ? devices.find((d) => d.id === id)?.name ?? "a removed device" : null);

  if (!run) {
    return (
      <section className="panel results" aria-label="Results">
        <h2 className="panel__title">Results</h2>
        <p className="empty">{readOnly ? "No run yet. Results show up here live." : "Ask for deals above to start a run."}</p>
        {children}
      </section>
    );
  }

  const failed = run.subtasks.filter((s) => s.status === "failed");
  return (
    <section className="panel results" aria-label="Results">
      <h2 className="panel__title">
        Results <span className="results__prompt">“{run.prompt}”</span>
      </h2>

      {run.status === "planning" && <PlanningState since={run.createdAt} />}
      {run.plan && <PlanBox plan={run.plan} />}
      {run.subtasks.length > 0 && (
        <ul className="subtasks" aria-label="Subtasks">
          {run.subtasks.map((s) => (
            <SubtaskRow key={s.id} s={s} deviceName={deviceName} />
          ))}
        </ul>
      )}

      {run.status === "merging" && <p className="results__state">{run.subtasks.some((s) => /^(Web: |Review analysis)/.test(s.label ?? "")) ? "Writing the answer…" : "Merging and ranking deals…"}</p>}
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
          <b>Run failed.</b> {run.error ?? "No subtask finished."}
          {failed.length > 0 && (
            <ul>
              {failed.map((s) => (
                <li key={s.id}>
                  {capabilityLabel(s.capability)}: {s.error ?? "no reason given"}
                </li>
              ))}
            </ul>
          )}
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
      {children}
    </section>
  );
}
