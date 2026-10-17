// The research agent: Gemini "pro" tier (the free tier maps it to the Flash model). It chooses what
// to read in Papiers, writes a hypothesis that cites what it read and the owner's feedback, and
// analyzes trial results. Every output is structured and validated; nothing is filled in by hand.

import type { AgentConfig, PapiersCitation } from "@co2lab/shared";
import { z } from "zod";
import { config } from "../config.js";
import { callJson, type UsageSink } from "../gemini.js";
import { log } from "../log.js";
import { lastWarnings, papiersList, papiersProblem, papiersRead, papiersSearch, type PapiersHit } from "./papiers.js";

export const RESEARCH_QUESTION = "What is the cheapest agent configuration that still reads in-app deals correctly?";

const MODES_NOTE =
  "Trials replay one live phone capture per app through the hub's real deal extraction. Variables: " +
  "model tier lite | flash | pro; screenshot scale 25 | 50 | 75 | 100 % of the captured full-resolution screenshots; " +
  "mode recipe (screenshots plus the accessibility text the recipe collected) or vision (screenshots only).";

export function modelsNote(): string {
  const m = config.gemini.models;
  const same = m.pro && m.pro === m.flash ? " (pro uses the same model as flash on this hub's free tier, so pro trials only duplicate flash)" : "";
  return `Model ids: lite=${m.lite || "unset"}, flash=${m.flash || "unset"}, pro=${m.pro || "unset"}${same}.`;
}

// ---------- Papiers context ----------

export interface PapiersContext {
  queries: string[];
  hits: (PapiersHit & { key: string })[];
  error: string | null;
}

const QuerySchema = z.object({ queries: z.array(z.string().min(3).max(80)).min(1).max(3) });

export async function gatherPapiers(focus: string, onUsage: UsageSink): Promise<PapiersContext> {
  const problem = papiersProblem();
  if (problem) return { queries: [], hits: [], error: problem };
  // Survey first (what the library actually holds), as the Papiers research skill recommends.
  const listed: PapiersHit[] = [];
  const errors: string[] = [];
  for (const kind of ["document", "note", "highlight", "conversation"]) {
    try {
      listed.push(...(await papiersList(kind, 15)));
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  log.info(`research: papiers library survey: ${listed.length} recent item(s)`);
  const survey = listed.map((h) => `- ${h.title ?? h.id} (${h.kind})`).join("\n");

  let queries: string[];
  try {
    const out = await callJson({
      tier: "lite",
      label: "research queries",
      schema: QuerySchema,
      onUsage,
      system:
        "You search the owner's personal research library (papers, highlights, notes) before designing an experiment. " +
        "Write 2-3 short keyword search queries (3-6 words each) likely to find relevant prior work: vision-language " +
        "models reading screenshots or UI text, image resolution vs. accuracy, OCR, small vs. large model cost/accuracy " +
        "trade-offs, token cost of images, evaluation with human labels.",
      parts: [
        {
          text:
            `Research question: ${RESEARCH_QUESTION}\nCurrent focus: ${focus}\n\n` +
            `Recent items in the library (aim queries at what is actually there; short queries match best):\n${survey || "(listing unavailable)"}`,
        },
      ],
    });
    queries = out.queries;
  } catch (e) {
    queries = ["vision language model image resolution accuracy", "small model OCR screenshots cost"];
    log.warn(`research: query writer failed (${(e as Error).message}); using default queries`);
  }

  const hits: PapiersContext["hits"] = [];
  for (const q of queries) {
    try {
      const found = await papiersSearch(q, 4);
      log.info(`research: papiers search "${q}": ${found.length} hit(s)${lastWarnings.length ? ` (${lastWarnings.join("; ")})` : ""}`);
      for (const h of found) if (!hits.some((x) => x.id === h.id)) hits.push({ ...h, key: "" });
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  // No search hits: fall back to the surveyed items the query writer judged closest (first ones listed).
  if (!hits.length) for (const h of listed.slice(0, 4)) hits.push({ ...h, key: "" });
  // Read the top items in more depth; document hits often carry no snippet of their own.
  for (const h of hits.slice(0, 4)) {
    try {
      const more = await papiersRead(h.id, 2000);
      if (more.trim()) h.text = `${h.text}\n${more}`.trim().slice(0, 2500);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  const kept = hits.filter((h) => h.text.trim() || h.title?.trim()).slice(0, 8);
  for (const h of kept) if (!h.text.trim()) h.text = h.title ?? "";
  kept.forEach((h, i) => (h.key = `P${i + 1}`));
  for (const e of errors) log.warn(`research: ${e}`);
  const error = kept.length ? null : errors[0] ?? `Papiers returned nothing for: ${queries.join("; ")}`;
  return { queries, hits: kept, error };
}

// ---------- Propose ----------

export interface PastExperiment {
  title: string;
  hypothesis: string;
  table: string | null;
  analysis: string | null;
  nextProposal: string | null;
}

export interface FeedbackForAgent {
  id: string;
  kind: string;
  text: string;
  on: string;
}

export interface Proposal {
  title: string;
  hypothesis: string;
  configs: AgentConfig[];
  papiers: PapiersCitation[];
  citesFeedbackIds: string[];
}

const SCALES = { 25: 0.25, 50: 0.5, 75: 0.75, 100: 1 } as const;

export async function proposeExperiment(opts: {
  history: PastExperiment[];
  feedback: FeedbackForAgent[];
  apps: string[];
  papiers: PapiersContext;
  revising: string | null;
  onUsage: UsageSink;
}): Promise<Proposal> {
  const keys = opts.papiers.hits.map((h) => h.key);
  const fbIds = opts.feedback.map((f) => f.id);
  const schema = z.object({
    title: z.string().min(5).max(200),
    hypothesis: z.string().min(20).max(2000),
    configs: z
      .array(z.object({ model: z.enum(["lite", "flash", "pro"]), scalePct: z.enum(["25", "50", "75", "100"]), mode: z.enum(["recipe", "vision"]) }))
      .min(2)
      .max(6),
    citations: keys.length
      ? z.array(z.object({ ref: z.enum(keys as [string, ...string[]]), use: z.string().min(5).max(600) })).min(1).max(4)
      : z.array(z.object({ ref: z.string(), use: z.string() })).max(0),
    citesFeedbackIds: fbIds.length
      ? z.array(z.enum(fbIds as [string, ...string[]])).min(fbIds.length)
      : z.array(z.string()).max(0),
  });

  const library = opts.papiers.hits.length
    ? opts.papiers.hits.map((h) => `[${h.key}] ${h.title ?? h.id} (${h.kind})\n${h.text}`).join("\n\n")
    : `(no Papiers context: ${opts.papiers.error ?? "nothing found"})`;
  const history = opts.history.length
    ? opts.history
        .map(
          (e, i) =>
            `Experiment ${i + 1}: ${e.title}\nHypothesis: ${e.hypothesis}\n` +
            (e.table ? `Results:\n${e.table}\n` : "Not run yet.\n") +
            (e.analysis ? `Analysis: ${e.analysis}\n` : "") +
            (e.nextProposal ? `Proposed next: ${e.nextProposal}\n` : ""),
        )
        .join("\n")
    : "(none yet)";
  const feedback = opts.feedback.length
    ? opts.feedback.map((f) => `- id ${f.id} [${f.kind}] on "${f.on}": ${f.text}`).join("\n")
    : "(none)";

  const out = await callJson({
    tier: "pro",
    label: "research propose",
    schema,
    onUsage: opts.onUsage,
    system:
      `You are the research agent of Co2lab. Research question: ${RESEARCH_QUESTION} ${MODES_NOTE} ` +
      "Give it a short title (at most 10 words). Design the next experiment: a falsifiable hypothesis with concrete numbers, and 2-6 configurations to compare " +
      "(include one reference configuration that the cheaper ones are judged against). " +
      "Ground the hypothesis in the owner's library: cite at least one [P#] item you were given, saying what you took from it, " +
      "and mention it in the hypothesis text as (P#). Be honest about relevance: if an item is only loosely related, say what " +
      "limited idea you take from it in `use` rather than overstating it. " +
      "The owner's feedback overrides your own plan: you must address every feedback item listed, list every feedback id " +
      "in citesFeedbackIds, and quote or paraphrase the feedback in the hypothesis (for example 'Following the owner's flag that ...'). " +
      "A redirect tells you what to test instead; follow it. A flag means a result the owner judged wrong; change the design so " +
      "the next experiment measures that failure. Do not repeat an experiment that was already run unless feedback asks for it.",
    parts: [
      {
        text:
          `${modelsNote()}\nApps with labeled captures: ${opts.apps.join(", ") || "none yet"}\n\n` +
          (opts.revising ? `You are revising this proposal after the owner redirected it:\n${opts.revising}\n\n` : "") +
          `Earlier experiments:\n${history}\n\nOwner feedback to address:\n${feedback}\n\nOwner's Papiers library excerpts:\n${library}`,
      },
    ],
  });

  const seen = new Set<string>();
  const configs: AgentConfig[] = [];
  for (const c of out.configs) {
    const cfg: AgentConfig = { model: c.model, screenshotScale: SCALES[Number(c.scalePct) as keyof typeof SCALES], mode: c.mode };
    const k = `${cfg.model}-${cfg.screenshotScale}-${cfg.mode}`;
    if (!seen.has(k) && seen.add(k)) configs.push(cfg);
  }
  const papiers: PapiersCitation[] = out.citations.map((c) => {
    const h = opts.papiers.hits.find((x) => x.key === c.ref)!;
    return { ref: h.id, title: h.title, excerpt: h.text.slice(0, 600), use: `${c.ref}: ${c.use}` };
  });
  return { title: out.title, hypothesis: out.hypothesis, configs, papiers, citesFeedbackIds: [...new Set(out.citesFeedbackIds)] };
}

// ---------- Analyze ----------

const AnalysisSchema = z.object({
  verdict: z.enum(["supported", "refuted", "inconclusive"]),
  analysis: z.string().min(40).max(4000),
  keyMisreads: z.array(z.string().max(500)).max(8),
  nextProposal: z.string().min(10).max(1000),
  findingSummary: z.string().min(20).max(1200),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

export async function analyzeExperiment(opts: {
  title: string;
  hypothesis: string;
  table: string;
  misreads: string;
  flags: string[];
  onUsage: UsageSink;
}): Promise<Analysis> {
  return callJson({
    tier: "pro",
    label: "research analyze",
    schema: AnalysisSchema,
    onUsage: opts.onUsage,
    system:
      `You are the research agent of Co2lab. Research question: ${RESEARCH_QUESTION} ${MODES_NOTE} ` +
      "Analyze the trial results against the hypothesis. Use the numbers in the table; name specific misreads " +
      "(for example 'lite at 25 % read \"$1\" as \"$7\" on the McDonald's fries deal'). A wrong price is a failure even if " +
      "the deal was found. Say which configuration is the cheapest one that still reads deals correctly, or that none does. " +
      "Then propose one next experiment in one sentence. findingSummary: 1-2 sentences with the key numbers, " +
      "suitable for a lab notebook.",
    parts: [
      {
        text:
          `${modelsNote()}\nExperiment: ${opts.title}\nHypothesis: ${opts.hypothesis}\n\nResults (mean over captures):\n${opts.table}\n\n` +
          `Misreads:\n${opts.misreads || "(none)"}\n\nOwner flags on this experiment so far:\n${opts.flags.join("\n") || "(none)"}`,
      },
    ],
  });
}
