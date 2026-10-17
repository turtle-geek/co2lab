// Scores one trial's extracted deals against the owner's ground truth. Deterministic, so the same
// extraction always gets the same score.
//
// Matching: deals are paired greedily by title similarity (token Dice coefficient >= 0.5, prices
// that agree break ties). precision = matched / extracted, recall = matched / truth,
// priceExactPct = truth deals read with exactly the right price / truth deals (a missed deal counts
// as a wrong price). Every unmatched or mispriced deal becomes a Misread.

import type { Deal, Misread } from "@co2lab/shared";

const STOP = new Set(["the", "a", "an", "of", "with", "and", "or", "for", "any", "your", "on", "in", "to", "get", "at"]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9$%.]+/g, " ")
    .split(" ")
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter((t) => t && !STOP.has(t));
}

function dice(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const pool = [...tb];
  let hit = 0;
  for (const t of ta) {
    const i = pool.indexOf(t);
    if (i >= 0) {
      hit++;
      pool.splice(i, 1);
    }
  }
  return (2 * hit) / (ta.length + tb.length);
}

/** "$1.00" == "$1", "2 for $7" == "2 For $7.00", "FREE" == "free". */
export function normPrice(p: string | null): string {
  if (!p) return "";
  return p
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/(\d)\.00\b/g, "$1")
    .replace(/[^a-z0-9$%. ]/g, "")
    .trim();
}

export interface Score {
  precision: number;
  recall: number;
  priceExactPct: number;
  misreads: Misread[];
}

export function scoreDeals(app: string, extracted: Deal[], truth: Deal[]): Score {
  const pairs: { e: number; t: number; sim: number }[] = [];
  extracted.forEach((e, ei) =>
    truth.forEach((t, ti) => {
      const sim = dice(e.title, t.title) + (normPrice(e.priceText) && normPrice(e.priceText) === normPrice(t.priceText) ? 0.05 : 0);
      if (sim >= 0.5) pairs.push({ e: ei, t: ti, sim });
    }),
  );
  pairs.sort((a, b) => b.sim - a.sim);
  const usedE = new Set<number>();
  const usedT = new Set<number>();
  const matched: { e: Deal; t: Deal }[] = [];
  for (const p of pairs) {
    if (usedE.has(p.e) || usedT.has(p.t)) continue;
    usedE.add(p.e);
    usedT.add(p.t);
    matched.push({ e: extracted[p.e]!, t: truth[p.t]! });
  }

  const misreads: Misread[] = [];
  let exact = 0;
  for (const { e, t } of matched) {
    if (normPrice(e.priceText) === normPrice(t.priceText)) exact++;
    else misreads.push({ kind: "price", app, title: t.title, expected: t.priceText, got: e.priceText });
  }
  truth.forEach((t, i) => {
    if (!usedT.has(i)) misreads.push({ kind: "missed", app, title: t.title, expected: t.priceText, got: null });
  });
  extracted.forEach((e, i) => {
    if (!usedE.has(i)) misreads.push({ kind: "extra", app, title: e.title, expected: null, got: e.priceText });
  });

  const ratio = (n: number, d: number, empty: number) => (d === 0 ? empty : n / d);
  return {
    // No extractions and no truth is a perfect read; no extractions with truth is precision 1, recall 0.
    precision: ratio(matched.length, extracted.length, 1),
    recall: ratio(matched.length, truth.length, 1),
    priceExactPct: ratio(exact, truth.length, extracted.length === 0 ? 1 : 0),
    misreads,
  };
}
