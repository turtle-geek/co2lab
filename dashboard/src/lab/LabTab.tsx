// Research Mode (SPEC §4.5): captures + ground truth, the experiment timeline, owner feedback, findings.
// Experiments arrive over the WebSocket (props); captures and findings come from GET /api/research.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentConfig, AppId, CaptureView, Deal, ExperimentView, FindingView, LabelItem, ResearchState } from "@co2lab/shared";
import type { LabProps } from "../labSlot";
import "./lab.css";

const APPS: { id: AppId; label: string }[] = [
  { id: "tims", label: "Tim Hortons" },
  { id: "mcdonalds", label: "McDonald's" },
  { id: "popeyes", label: "Popeyes" },
];
const appLabel = (id: string) => APPS.find((a) => a.id === id)?.label ?? id;

const viewer = new URLSearchParams(location.search).get("viewer") ?? new URLSearchParams(location.hash.slice(1)).get("viewer");
const withViewer = (url: string) => (viewer ? `${url}${url.includes("?") ? "&" : "?"}viewer=${encodeURIComponent(viewer)}` : url);
const evidenceUrl = (ref: string) => withViewer(`/api/evidence/${ref.replace(/^frames\//, "")}`);

const pct = (n: number) => `${Math.round(n * 100)} %`;
const cfgLabel = (c: AgentConfig) => `${c.model} · ${Math.round(c.screenshotScale * 100)} % · ${c.mode}`;
const when = (ms: number) => new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function useResearch(experiments: ExperimentView[]) {
  const [data, setData] = useState<ResearchState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch(withViewer("/api/research"), { credentials: "same-origin" });
      if (!r.ok) throw new Error(`hub answered ${r.status}`);
      setData((await r.json()) as ResearchState);
      setError(null);
    } catch (e) {
      setError(`Could not load the Lab: ${(e as Error).message}`);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, experiments]);
  const active = !!data && (!!data.busy || data.captures.some((c) => c.status === "capturing"));
  useEffect(() => {
    const t = setInterval(() => void load(), active ? 2_500 : 10_000);
    return () => clearInterval(t);
  }, [load, active]);
  return { data, error, reload: load };
}

export default function LabTab({ experiments, readOnly, connected, send }: LabProps) {
  const { data, error, reload } = useResearch(experiments);
  const [labeling, setLabeling] = useState<string | null>(null);
  const can = !readOnly && connected;
  const act = (msg: Parameters<typeof send>[0]) => {
    send(msg);
    setTimeout(() => void reload(), 400);
  };

  const timeline = useMemo(() => [...experiments].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)), [experiments]);
  const allFeedback = useMemo(() => new Map(experiments.flatMap((e) => e.feedback.map((f) => [f.id, { ...f, on: e.title ?? "experiment" }] as const))), [experiments]);
  const labelCapture = data?.captures.find((c) => c.id === labeling) ?? null;
  const renderExp = (e: ExperimentView) => (
    <Experiment
      key={e.id}
      e={e}
      captures={data?.captures ?? []}
      allFeedback={allFeedback}
      parentTitle={experiments.find((x) => x.id === e.parentId)?.title ?? null}
      finding={data?.findings.find((f) => f.experimentId === e.id) ?? null}
      can={can && !data?.busy}
      readOnly={readOnly}
      onFeedback={(kind, text) => act({ type: "research.feedback", experimentId: e.id, kind, text })}
    />
  );

  return (
    <div className="lab">
      <section className="panel lab-head">
        <div>
          <h2 className="panel__title">Lab</h2>
          <p className="lab-q">What is the cheapest agent configuration that still reads in-app deals correctly?</p>
          <p className="lab-meta">
            Notebook: {data ? (data.store === "postgres" ? "Tiger Data" : "in memory (not saved)") : "…"} · models:{" "}
            {data ? Object.entries(data.models).map(([k, v]) => `${k}=${v || "unset"}`).join(", ") : "…"}
          </p>
        </div>
        <div className="lab-head__side">
          {data?.busy && (
            <p className="lab-busy">
              <span className="spinner" aria-hidden /> {data.busy}
            </p>
          )}
          {!readOnly && (
            <button className="btn btn--primary" disabled={!can || !!data?.busy} onClick={() => act({ type: "research.propose" })}>
              Propose an experiment
            </button>
          )}
        </div>
      </section>
      {error && <p className="lab-error">{error}</p>}

      <Captures captures={data?.captures ?? []} can={can} readOnly={readOnly} onCapture={(app) => act({ type: "research.capture", app })} onLabel={setLabeling} />

      {labelCapture && can && (
        <Labeler
          capture={labelCapture}
          onCancel={() => setLabeling(null)}
          onSave={(deals, labels) => {
            act({ type: "research.label", captureId: labelCapture.id, deals, labels });
            setLabeling(null);
          }}
        />
      )}

      <section className="panel">
        <h2 className="panel__title">Experiments</h2>
        {timeline.length === 0 && <p className="empty">No experiments yet. Capture and label each app, then propose one.</p>}
        <ol className="exp-list">
          {timeline.filter((e) => !e.supersededBy).map(renderExp)}
        </ol>
        {timeline.some((e) => e.supersededBy) && (
          <details className="exp-drafts">
            <summary>
              Show {timeline.filter((e) => e.supersededBy).length} earlier draft{timeline.filter((e) => e.supersededBy).length === 1 ? "" : "s"} (replaced
              before they ran)
            </summary>
            <ol className="exp-list">{timeline.filter((e) => e.supersededBy).map(renderExp)}</ol>
          </details>
        )}
      </section>

      <section className="panel">
        <h2 className="panel__title">Findings</h2>
        {!data?.findings.length && <p className="empty">Findings appear here after an experiment is analyzed.</p>}
        <ul className="findings">
          {data?.findings.map((f) => (
            <li key={f.id} className="finding">
              <p>{f.summary}</p>
              <p className="lab-meta">
                {when(f.createdAt)} · {experiments.find((e) => e.id === f.experimentId)?.title ?? f.experimentId}
                {f.papiersRef && <> · Papiers: {f.papiersRef}</>} ·{" "}
                <a href={withViewer(`/api/research/findings/${f.id}.md`)} download>
                  Export Markdown
                </a>
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ---------- Captures ----------

function Captures(props: {
  captures: CaptureView[];
  can: boolean;
  readOnly: boolean;
  onCapture(app: AppId): void;
  onLabel(id: string): void;
}) {
  return (
    <section className="panel">
      <h2 className="panel__title">Live captures and ground truth</h2>
      <p className="lab-meta">One capture per app from the phone (full-resolution screenshots). Every trial replays it, so trials are cheap and comparable.</p>
      <div className="caps">
        {APPS.map(({ id, label }) => {
          const latest = props.captures.filter((c) => c.app === id)[0];
          const labeled = props.captures.find((c) => c.app === id && c.groundTruth);
          return (
            <div key={id} className="cap card">
              <div className="cap__top">
                <strong>{label}</strong>
                {latest && <span className={`pill pill--${latest.status}`}>{latest.status}</span>}
              </div>
              {!latest && <p className="empty">No capture yet.</p>}
              {latest && (
                <>
                  <p className="lab-meta">
                    {when(latest.createdAt)}
                    {latest.deviceName && <> · {latest.deviceName}</>} · {latest.frames.length} screenshot(s)
                    {latest.status === "ready" && <> · {latest.candidates.length} deal(s) read live</>}
                  </p>
                  {latest.error && <p className="lab-error">{latest.error}</p>}
                  {latest.frames.length > 0 && (
                    <div className="thumbs">
                      {latest.frames.map((f) => (
                        <a key={f} href={evidenceUrl(f)} target="_blank" rel="noreferrer">
                          <img src={evidenceUrl(f)} alt={`${label} screenshot`} loading="lazy" />
                        </a>
                      ))}
                    </div>
                  )}
                  {latest.groundTruth ? (
                    <p className="cap__truth">Labeled: {latest.groundTruth.deals.length} true deal(s)</p>
                  ) : (
                    latest.status === "ready" && <p className="cap__truth cap__truth--todo">Needs labels before trials</p>
                  )}
                  {!latest.groundTruth && labeled && <p className="lab-meta">Trials still use the labeled capture from {when(labeled.createdAt)}.</p>}
                </>
              )}
              {!props.readOnly && (
                <div className="cap__actions">
                  <button className="btn btn--small" disabled={!props.can || latest?.status === "capturing"} onClick={() => props.onCapture(id)}>
                    {latest?.status === "capturing" ? "Capturing…" : latest ? "Capture again" : "Capture from phone"}
                  </button>
                  {latest?.status === "ready" && (
                    <button className="btn btn--small" disabled={!props.can} onClick={() => props.onLabel(latest.id)}>
                      {latest.groundTruth ? "Edit labels" : "Label deals"}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------- Labeler ----------

interface Row {
  verdict: LabelItem["verdict"];
  title: string;
  priceText: string;
  correctTitle: string;
  correctPrice: string;
}

function Labeler({ capture, onSave, onCancel }: { capture: CaptureView; onSave(deals: Deal[], labels: LabelItem[]): void; onCancel(): void }) {
  const [rows, setRows] = useState<Row[]>(() => {
    if (capture.groundTruth?.labels.length)
      return capture.groundTruth.labels.map((l) => ({
        verdict: l.verdict,
        title: l.title,
        priceText: l.priceText ?? "",
        correctTitle: l.correctTitle ?? "",
        correctPrice: l.correctPrice ?? "",
      }));
    return capture.candidates.map((d) => ({ verdict: "correct", title: d.title, priceText: d.priceText ?? "", correctTitle: "", correctPrice: "" }));
  });
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function save() {
    const source = capture.app as Deal["source"];
    const deal = (title: string, price: string): Deal => ({
      source,
      title: title.trim(),
      priceText: price.trim() || null,
      conditions: null,
      expiresText: null,
      url: null,
      screenshotRef: null,
      confidence: 1,
    });
    const deals: Deal[] = [];
    const labels: LabelItem[] = [];
    for (const r of rows) {
      if (!r.title.trim() && r.verdict === "missing") continue;
      labels.push({
        verdict: r.verdict,
        title: r.title.trim(),
        priceText: r.priceText.trim() || null,
        correctTitle: r.verdict === "wrong" ? r.correctTitle.trim() || null : null,
        correctPrice: r.verdict === "wrong" ? r.correctPrice.trim() || null : null,
      });
      if (r.verdict === "correct" || r.verdict === "missing") deals.push(deal(r.title, r.priceText));
      // "wrong" with a correction is a real deal that was misread; without one it does not exist.
      else if (r.correctTitle.trim() || r.correctPrice.trim()) deals.push(deal(r.correctTitle || r.title, r.correctPrice || r.priceText));
    }
    onSave(deals, labels);
  }

  return (
    <section className="panel labeler">
      <h2 className="panel__title">Label {appLabel(capture.app)} — what does the app really show?</h2>
      <p className="lab-meta">
        Compare with the screenshots. Mark each deal the phone read as correct or wrong (give the real title or price, or leave both empty if the
        deal does not exist), and add deals it missed.
      </p>
      <div className="thumbs thumbs--big">
        {capture.frames.map((f) => (
          <a key={f} href={evidenceUrl(f)} target="_blank" rel="noreferrer">
            <img src={evidenceUrl(f)} alt="capture screenshot" />
          </a>
        ))}
      </div>
      <ul className="label-rows">
        {rows.map((r, i) => (
          <li key={i} className={`label-row label-row--${r.verdict}`}>
            <div className="label-row__deal">
              {r.verdict === "missing" ? (
                <>
                  <input className="input" placeholder="Deal title" value={r.title} onChange={(e) => set(i, { title: e.target.value })} />
                  <input className="input input--price" placeholder="Price" value={r.priceText} onChange={(e) => set(i, { priceText: e.target.value })} />
                </>
              ) : (
                <span>
                  <strong>{r.title}</strong> {r.priceText && <span className="price">{r.priceText}</span>}
                </span>
              )}
            </div>
            {r.verdict !== "missing" && (
              <div className="seg" role="group" aria-label="Verdict">
                {(["correct", "wrong"] as const).map((v) => (
                  <button key={v} className={r.verdict === v ? "seg__on" : ""} onClick={() => set(i, { verdict: v })}>
                    {v}
                  </button>
                ))}
              </div>
            )}
            {r.verdict === "missing" && (
              <button className="link-btn" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                Remove
              </button>
            )}
            {r.verdict === "wrong" && (
              <div className="label-row__fix">
                <input className="input" placeholder="Real title (empty = not a real deal)" value={r.correctTitle} onChange={(e) => set(i, { correctTitle: e.target.value })} />
                <input className="input input--price" placeholder="Real price" value={r.correctPrice} onChange={(e) => set(i, { correctPrice: e.target.value })} />
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="labeler__actions">
        <button className="btn btn--small" onClick={() => setRows((rs) => [...rs, { verdict: "missing", title: "", priceText: "", correctTitle: "", correctPrice: "" }])}>
          + Add a missed deal
        </button>
        <span className="grow" />
        <button className="link-btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn--primary" onClick={save}>
          Save ground truth
        </button>
      </div>
    </section>
  );
}

// ---------- Experiment ----------

function Experiment(props: {
  e: ExperimentView;
  captures: CaptureView[];
  allFeedback: Map<string, ExperimentView["feedback"][number] & { on: string }>;
  parentTitle: string | null;
  /** The saved one-line finding: the card's takeaway. */
  finding: FindingView | null;
  can: boolean;
  readOnly: boolean;
  onFeedback(kind: "flag" | "approve" | "redirect", text: string): void;
}) {
  const { e } = props;
  const [mode, setMode] = useState<"flag" | "redirect" | null>(null);
  const [text, setText] = useState("");
  const status = e.supersededBy ? "superseded" : e.status;
  const cited = e.citesFeedbackIds.map((id) => props.allFeedback.get(id)).filter((f) => !!f);

  const rows = e.configs.map((c, i) => {
    const ts = e.trials.filter((t) => t.configIndex === i);
    const ok = ts.filter((t) => !t.error);
    const mean = (f: (t: (typeof ts)[number]) => number) => (ok.length ? ok.reduce((s, t) => s + f(t), 0) / ok.length : null);
    return { c, ts, ok, p: mean((t) => t.precision), r: mean((t) => t.recall), x: mean((t) => t.priceExactPct), tok: mean((t) => t.tokens), lat: mean((t) => t.latencyMs), cost: mean((t) => t.costUsd) };
  });
  const misreads = e.trials.flatMap((t) => (t.misreads ?? []).map((m) => ({ ...m, cfg: e.configs[t.configIndex] })));
  const failed = e.trials.filter((t) => t.error);
  const actionable = !e.supersededBy && (e.status === "proposed" || e.status === "analyzed") && !(e.error && !e.configs.length);
  const verdict = /verdict:\s*(supported|refuted|partly supported|partially supported|inconclusive)/i.exec(e.analysis ?? "")?.[1]?.toLowerCase() ?? null;
  // The winner: the cheapest setting that found every deal with no fakes; otherwise the one that found the most.
  const tried = rows.map((row, i) => ({ ...row, i })).filter((row) => row.ok.length > 0);
  const perfect = tried.filter((row) => (row.r ?? 0) >= 0.999 && (row.p ?? 0) >= 0.999);
  const best =
    e.status !== "analyzed"
      ? -1
      : ((perfect.length ? [...perfect].sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0)) : [...tried].sort((a, b) => (b.r ?? 0) - (a.r ?? 0)))[0]?.i ?? -1);
  const firstSentence = (t: string) => /^(.{20,240}?[.!?])(\s|$)/.exec(t.replace(/\s+/g, " "))?.[1] ?? t.slice(0, 220);

  return (
    <li className={`exp exp--${status}`}>
      <div className="exp__head">
        <span className={`pill pill--${status}`}>{status}</span>
        <h3>{e.title ?? "Experiment"}</h3>
        <span className="lab-meta">{e.createdAt ? when(e.createdAt) : ""}</span>
      </div>

      {/* Takeaway first: the verdict and the saved one-line finding (or the hypothesis' first sentence before it runs). */}
      <p className="exp__take">
        {verdict && (
          <span className={`verdict verdict--${verdict.startsWith("supported") ? "yes" : verdict === "refuted" ? "no" : "mid"}`}>{verdict}</span>
        )}
        {props.finding ? props.finding.summary : verdict ? firstSentence(e.analysis!.replace(/^verdict:[^\n]*\n*/i, "")) : firstSentence(e.hypothesis)}
      </p>
      {cited.length > 0 && (
        <p className="exp__steer">
          <span className={`fb fb--${cited[0]!.kind}`}>your {cited[0]!.kind}</span> “{cited[0]!.text}”
        </p>
      )}
      {(e.papiers?.length ?? 0) > 0 && (
        <p className="exp__papers">
          Based on
          {e.papiers!.map((pp) => (
            <span key={pp.ref} className="paper-tag" title={pp.title ?? undefined}>
              {(pp.title ?? pp.ref).split(":")[0]!.trim()}
            </span>
          ))}
          <span className="lab-meta">from Papiers</span>
        </p>
      )}
      {e.error && <p className="lab-error">{e.error}</p>}

      {e.configs.length > 0 && (
        <div className="table-wrap">
          <table className="trials">
            <thead>
              <tr>
                <th>Setting</th>
                <th title="Share of the real deals it found (recall)">Found</th>
                <th title="Share of what it reported that is real (precision)">No fakes</th>
                <th title="Real deals read with exactly the right price">Right price</th>
                <th>Cost</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, ts, ok, p, r, x, lat, cost }, i) => (
                <tr key={i} className={i === best ? "trials__best" : ""}>
                  <td>
                    {cfgLabel(c)}
                    {i === best && <span className="best-tag">best</span>}
                  </td>
                  {ts.length === 0 ? (
                    <td colSpan={5} className="lab-meta">
                      {e.status === "running" ? "waiting…" : "not run"}
                    </td>
                  ) : ok.length === 0 ? (
                    <td colSpan={5} className="lab-error">failed</td>
                  ) : (
                    <>
                      <td>{pct(r!)}</td>
                      <td>{pct(p!)}</td>
                      <td className={x! < 1 ? "bad" : ""}>{pct(x!)}</td>
                      <td>${cost!.toFixed(4)}</td>
                      <td>{(lat! / 1000).toFixed(1)} s</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {e.status === "running" && (
            <p className="lab-busy">
              <span className="spinner" aria-hidden /> {e.trials.length} of {e.configs.length * (e.captureIds?.length || 1)} trials done
            </p>
          )}
        </div>
      )}

      {e.nextProposal && actionable && (
        <p className="exp__next">
          <strong>Next idea:</strong> {e.nextProposal}
        </p>
      )}
      {!props.readOnly && actionable && (
        <div className="exp__actions">
          {mode ? (
            <form
              className="fb-form"
              onSubmit={(ev) => {
                ev.preventDefault();
                if (!text.trim()) return;
                props.onFeedback(mode, text.trim());
                setText("");
                setMode(null);
              }}
            >
              <input
                className="input"
                autoFocus
                placeholder={mode === "flag" ? "What is wrong? e.g. it read $1 as $7, that's a failure" : "What to test instead? e.g. test 75 % scale"}
                value={text}
                onChange={(ev) => setText(ev.target.value)}
              />
              <button className="btn btn--small btn--primary" disabled={!props.can || !text.trim()}>
                {mode === "flag" ? "Flag" : "Redirect"}
              </button>
              <button type="button" className="link-btn" onClick={() => setMode(null)}>
                Cancel
              </button>
            </form>
          ) : (
            <>
              <button className="btn btn--small btn--primary" disabled={!props.can} onClick={() => props.onFeedback("approve", "")}>
                {e.status === "proposed" ? "Approve and run trials" : "Approve next step"}
              </button>
              <button className="btn btn--small" disabled={!props.can} onClick={() => setMode("flag")}>
                Flag
              </button>
              <button className="btn btn--small" disabled={!props.can} onClick={() => setMode("redirect")}>
                Redirect
              </button>
            </>
          )}
        </div>
      )}
      <details className="exp__more">
        <summary>Details</summary>
        {props.parentTitle && <p className="lab-meta">Follows “{props.parentTitle}”</p>}
        <p className="exp__hyp">
          <strong>Hypothesis.</strong> {e.hypothesis}
        </p>
        {(e.papiers?.length ?? 0) > 0 && (
          <div className="exp__cites">
            <strong>Read from Papiers</strong>
            <ul>
              {e.papiers!.map((pp) => (
                <li key={pp.ref}>
                  {pp.title}: {pp.use} <code>{pp.ref}</code>
                  <blockquote>{pp.excerpt.replace(/\s+/g, " ").slice(0, 280)}…</blockquote>
                </li>
              ))}
            </ul>
          </div>
        )}
        {e.papiersError && <p className="lab-meta">Papiers: {e.papiersError}</p>}
        {e.analysis && (
          <div className="exp__analysis">
            <strong>Full analysis</strong>
            <p>{e.analysis}</p>
          </div>
        )}
      {(misreads.length > 0 || failed.length > 0) && (
        <details className="exp__mis">
          <summary>
            {misreads.length} misread(s){failed.length ? `, ${failed.length} failed trial(s)` : ""}
          </summary>
          <ul>
            {failed.map((t, i) => (
              <li key={`f${i}`} className="lab-error">
                {cfgLabel(e.configs[t.configIndex]!)}: {t.error}
              </li>
            ))}
            {misreads.slice(0, 80).map((m, i) => (
              <li key={i}>
                <span className="lab-meta">{m.cfg ? cfgLabel(m.cfg) : ""} · {m.app}:</span>{" "}
                {m.kind === "price" && (
                  <>
                    read <b>{m.got ?? "no price"}</b> for “{m.title}” (really <b>{m.expected ?? "none"}</b>)
                  </>
                )}
                {m.kind === "missed" && <>missed “{m.title}” {m.expected && `(${m.expected})`}</>}
                {m.kind === "extra" && <>reported “{m.title}”, which is not there</>}
              </li>
            ))}
          </ul>
        </details>
      )}

        {e.feedback.length > 0 && (
          <ul className="exp__fb">
            {e.feedback.map((f) => (
              <li key={f.id}>
                <span className={`fb fb--${f.kind}`}>{f.kind}</span> {f.text} <span className="lab-meta">{when(f.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
        {e.findingRef && (
          <p className="lab-meta">
            Finding saved ·{" "}
            <a href={withViewer(`/api/research/findings/${e.findingRef}.md`)} download>
              Export Markdown
            </a>
          </p>
        )}
      </details>
    </li>
  );
}

