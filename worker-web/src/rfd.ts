// RedFlagDeals source. The forum's HTML pages sit behind a proof-of-work bot check that
// rejects automated browsers, and we do not try to get around it. The forum also serves a
// public JSON API (the one its own site uses) without that check, so we read that, slowly.

import type { APIRequestContext } from "playwright";

export const RFD_BASE = (process.env.WORKER_RFD_BASE ?? "https://forums.redflagdeals.com").replace(/\/+$/, "");
const HOT_DEALS_FORUM = 9;

/** Hot Deals category IDs that hold food deals (found by reading the API; labels are ours). */
export const FOOD_CATEGORIES = [
  { id: 5150, label: "Restaurants & fast food" },
  { id: 5149, label: "Dining out" },
  { id: 5151, label: "Coffee & treats" },
] as const;

export const REQUEST_TIMEOUT_MS = 15_000;
export const MAX_RETRIES = 2;

export interface RfdTopic {
  topic_id: number;
  title: string;
  web_path: string;
  post_time: string;
  last_post_time: string;
  total_replies: number;
  total_views: number;
  score: number;
  offer: { dealer_name: string | null; price: string; sale_info: string; expires_at: string | null; url: string | null } | null;
}

export interface RfdPost {
  post_id: number;
  number: number;
  post_time: string;
  body: string;
  votes: { total_up: number; total_down: number } | null;
}

/** A failure the hub should see verbatim as the subtask's reason. */
export class RfdError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export async function getJson<T>(request: APIRequestContext, path: string, isCancelled: () => boolean): Promise<T> {
  let lastErr: RfdError | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(2_000 * attempt);
      if (isCancelled()) throw new RfdError("cancelled", false);
    }
    try {
      return await getJsonOnce<T>(request, path);
    } catch (err) {
      lastErr = err instanceof RfdError ? err : classify(err);
      if (!lastErr.retryable || isCancelled()) break;
    }
  }
  const e = lastErr!;
  throw new RfdError(e.retryable ? `${e.message} (gave up after ${MAX_RETRIES + 1} attempts)` : e.message, false);
}

async function getJsonOnce<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(RFD_BASE + path, {
    timeout: REQUEST_TIMEOUT_MS,
    headers: { accept: "application/json" },
  });
  const type = res.headers()["content-type"] ?? "";
  if (res.status() === 429) throw new RfdError("RedFlagDeals rate-limited the worker (HTTP 429)", true);
  if (res.status() === 403) throw new RfdError("RedFlagDeals refused the request (HTTP 403)", false);
  if (res.status() >= 500) throw new RfdError(`RedFlagDeals server error (HTTP ${res.status()})`, true);
  if (!type.includes("json")) {
    throw new RfdError(`RedFlagDeals returned a bot check instead of deal data (HTTP ${res.status()})`, true);
  }
  if (!res.ok()) throw new RfdError(`RedFlagDeals returned HTTP ${res.status()} for ${path}`, false);
  return (await res.json()) as T;
}

function classify(err: unknown): RfdError {
  const msg = err instanceof Error ? err.message : String(err);
  if (/has been closed|disposed/i.test(msg)) return new RfdError("cancelled", false);
  if (/timeout/i.test(msg)) return new RfdError(`RedFlagDeals did not answer within ${REQUEST_TIMEOUT_MS / 1000} s`, true);
  const net = msg.match(/(ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN)/)?.[1];
  if (net) return new RfdError(`Could not reach ${new URL(RFD_BASE).host} (${net})`, true);
  return new RfdError(`RedFlagDeals request failed: ${msg.split("\n")[0]}`, true);
}

export function listTopics(request: APIRequestContext, categoryId: number, isCancelled: () => boolean) {
  return getJson<{ topics?: RfdTopic[] }>(
    request,
    `/api/topics?forum_id=${HOT_DEALS_FORUM}&category_id=${categoryId}&per_page=20&page=1`,
    isCancelled,
  ).then((j) => j.topics ?? []);
}

export function listPosts(request: APIRequestContext, topicId: number, isCancelled: () => boolean) {
  return getJson<{ posts?: RfdPost[] }>(request, `/api/topics/${topicId}/posts?per_page=10&page=1`, isCancelled).then(
    (j) => j.posts ?? [],
  );
}

export const topicUrl = (t: RfdTopic) => `${RFD_BASE}${t.web_path}`;

// ---------- Relevance for "food deals near UTSC / Scarborough" ----------

const NATIONAL_CHAINS =
  /tim hortons|mcdonald|popeyes|burger king|wendy|kfc|a&w|subway|domino|pizza pizza|pizza hut|little caesars|harvey|mary brown|starbucks|taco bell|dairy queen|chick-fil-a|five guys|osmow|firehouse|mucho burrito|swiss chalet|boston pizza|coffee time|second cup|7-eleven|freshii|st-hubert|church's|chipotle|panda express|jack astor|kelsey|montana|east side mario|kinton|chatime|baskin|ikea/i;
const NEAR_US = /scarborough|utsc|markham|pickering|ajax|north york/i;
const TORONTO = /toronto|\bgta\b/i;
const ONTARIO = /\bon\b|ontario/i;
const OTHER_REGION =
  /\b(ab|bc|sk|mb|qc|ns|nb|pei|nl)\b|alberta|british columbia|vancouver|calgary|edmonton|winnipeg|montreal|quebec|saskatoon|regina|halifax|victoria/i;
const STOP_WORDS = new Set(["deals", "deal", "near", "today", "best", "food", "collect", "current", "redflagdeals", "from", "with", "that"]);

export interface ScoredTopic {
  topic: RfdTopic;
  category: string;
  score: number;
  why: string[];
}

export function scoreTopics(topics: Array<{ topic: RfdTopic; category: string }>, goal: string, now = new Date()): ScoredTopic[] {
  const today = now.toISOString().slice(0, 10);
  const goalWords = goal
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
  const seen = new Set<number>();
  const out: ScoredTopic[] = [];
  for (const { topic, category } of topics) {
    if (seen.has(topic.topic_id)) continue;
    seen.add(topic.topic_id);
    const text = `${topic.title} ${topic.offer?.dealer_name ?? ""}`;
    const ageDays = (now.getTime() - Date.parse(topic.last_post_time)) / 86_400_000;
    if (topic.offer?.expires_at && topic.offer.expires_at < today) continue;
    if (ageDays > 45) continue;
    const why: string[] = [];
    let score = 0;
    if (NEAR_US.test(text)) {
      score += 5;
      why.push("Scarborough area");
    } else if (TORONTO.test(text)) {
      score += 3;
      why.push("Toronto");
    } else if (ONTARIO.test(text)) {
      score += 2;
      why.push("Ontario");
    } else if (OTHER_REGION.test(text)) {
      continue; // only valid in another province
    }
    if (NATIONAL_CHAINS.test(text)) {
      score += 3;
      why.push("national chain");
    }
    if (/gift card/i.test(text)) {
      score -= 3;
      why.push("gift card");
    }
    if (ageDays <= 7) {
      score += 2;
      why.push("active this week");
    } else if (ageDays <= 21) score += 1;
    if (topic.offer?.expires_at) score += 1;
    score += Math.max(-2, Math.min(3, (topic.score ?? 0) / 10));
    for (const w of goalWords) {
      if (text.toLowerCase().includes(w)) {
        score += 1;
        why.push(`matches "${w}"`);
      }
    }
    out.push({ topic, category, score, why });
  }
  return out.sort((a, b) => b.score - a.score);
}

// ---------- Text helpers ----------

/** Forum post HTML -> plain text, without quoted earlier posts. */
export function postText(html: string): string {
  return decodeEntities(
    html
      .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, " ")
      .replace(/<iframe[^>]*data-s9e-mediaembed="([\w-]+)"[\s\S]*?<\/iframe>/gi, "[embedded $1 post]")
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, "[embedded content]")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
