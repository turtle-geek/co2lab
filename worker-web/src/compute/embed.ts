// The "embed" compute job (SPEC §4.7): aspect-based sentiment on a batch of reviews, on this CPU.
//  1. split reviews into sentences (sorted by length: much less padding per model call)
//  2. embed each sentence (all-MiniLM-L6-v2, 8-bit) and match it to the closest aspect by cosine
//     similarity to that aspect's seed phrases
//  3. a small sentiment model labels the matched sentences positive / negative
//  4. return counts per aspect and playtime bucket (a few KB), never the review text itself

import type { AspectCount, AspectSpec, HubToDevice } from "@co2lab/shared";
import { loadTransformers } from "./runtime.js";

const MATCH_MIN = 0.42; // cosine similarity a sentence needs to count as being about an aspect
const CALL_BATCH = 32;

type Assign = Extract<HubToDevice, { type: "job.assign" }>;
// Pipelines per (model, threads): a new thread count needs a new ONNX session.
const pipes = new Map<string, Promise<any>>();
const seedCache = new Map<string, { name: string; vecs: Float32Array[] }[]>();

async function pipe(task: "feature-extraction" | "sentiment-analysis", model: string, threads: number) {
  const key = `${task}|${model}|${threads}`;
  let p = pipes.get(key);
  if (!p) {
    const { pipeline } = await loadTransformers();
    p = pipeline(task, model, { dtype: "q8", session_options: { intraOpNumThreads: threads, interOpNumThreads: 1 } } as never);
    pipes.set(key, p);
    p.catch(() => pipes.delete(key));
  }
  return p;
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\[\/?[a-z0-9*]+\]/gi, " ") // Steam BBCode tags
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12 && s.length <= 400);
}

function rows(t: { data: Float32Array | number[]; dims: number[] }): Float32Array[] {
  const [n, d] = t.dims as [number, number];
  const data = t.data instanceof Float32Array ? t.data : Float32Array.from(t.data);
  return Array.from({ length: n }, (_, i) => data.subarray(i * d, (i + 1) * d));
}

const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
};

const bucket = (h: number) => (h < 5 ? "under5h" : h <= 30 ? "from5to30h" : "over30h") as "under5h" | "from5to30h" | "over30h";

export async function runEmbedJob(job: Assign): Promise<{ sentences: number; counts: AspectCount[] }> {
  const embed = await pipe("feature-extraction", job.models.embed, job.threads);
  const sentiment = await pipe("sentiment-analysis", job.models.sentiment, job.threads);

  const aspectsKey = JSON.stringify(job.aspects) + job.models.embed;
  let aspects = seedCache.get(aspectsKey);
  if (!aspects) {
    aspects = [];
    for (const a of job.aspects as AspectSpec[])
      aspects.push({ name: a.name, vecs: rows(await embed(a.seeds, { pooling: "mean", normalize: true })) });
    seedCache.set(aspectsKey, aspects);
  }

  const sents = job.items
    .flatMap((it) => splitSentences(it.text).map((text) => ({ text, playtimeH: it.playtimeH })))
    .sort((a, b) => a.text.length - b.text.length);

  // 1-2: embed and match to an aspect
  const matched: { text: string; playtimeH: number; aspect: string }[] = [];
  for (let i = 0; i < sents.length; i += CALL_BATCH) {
    const chunk = sents.slice(i, i + CALL_BATCH);
    const vecs = rows(await embed(chunk.map((s) => s.text), { pooling: "mean", normalize: true }));
    vecs.forEach((v, j) => {
      let best = "";
      let bestSim = MATCH_MIN;
      for (const a of aspects!) for (const sv of a.vecs) {
        const sim = dot(v, sv);
        if (sim > bestSim) {
          bestSim = sim;
          best = a.name;
        }
      }
      if (best) matched.push({ ...chunk[j]!, aspect: best });
    });
  }

  // 3: sentiment on matched sentences only
  const counts = new Map<string, AspectCount>();
  for (const a of job.aspects)
    counts.set(a.name, {
      aspect: a.name,
      pos: 0,
      neg: 0,
      byPlaytime: { under5h: { pos: 0, neg: 0 }, from5to30h: { pos: 0, neg: 0 }, over30h: { pos: 0, neg: 0 } },
      examples: [],
    });
  for (let i = 0; i < matched.length; i += CALL_BATCH) {
    const chunk = matched.slice(i, i + CALL_BATCH);
    const out = (await sentiment(chunk.map((m) => m.text))) as { label: string; score: number }[];
    out.forEach((o, j) => {
      const m = chunk[j]!;
      const c = counts.get(m.aspect)!;
      const positive = o.label.toUpperCase().startsWith("POS");
      if (positive) c.pos++;
      else c.neg++;
      c.byPlaytime[bucket(m.playtimeH)][positive ? "pos" : "neg"]++;
      if (c.examples.length < 4 && m.text.length > 40 && m.text.length < 220) c.examples.push({ text: m.text, positive });
    });
  }
  return { sentences: sents.length, counts: [...counts.values()].filter((c) => c.pos + c.neg > 0) };
}
