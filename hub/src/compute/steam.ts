// Steam reviews for compute jobs (SPEC §4.7): public appreviews endpoint, cached on the hub disk so
// every trial replays the same data. Then the cheap spam / review-bomb rules that run on the hub.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";
import { log } from "../log.js";

export interface SteamReview {
  id: string;
  text: string;
  votedUp: boolean;
  createdAt: number;
  playtimeAtReviewH: number;
  receivedForFree: boolean;
}

export interface ReviewFile {
  appid: number;
  title: string;
  fetchedAt: number;
  reviews: SteamReview[];
}

const dir = () => join(config.dataDir, "reviews");
const PAGE_GAP_MS = 1_200; // well under Steam's rate limit

async function appTitle(appid: number): Promise<string> {
  try {
    const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&filters=basic`);
    const body = (await res.json()) as Record<string, { success: boolean; data?: { name?: string } }>;
    return body[appid]?.data?.name ?? `Steam app ${appid}`;
  } catch {
    return `Steam app ${appid}`;
  }
}

/** Cached reviews when this app was fetched before (so trials replay the same data), else fetch newest-first English reviews. */
export async function loadReviews(appid: number, max: number, onProgress?: (n: number) => void): Promise<ReviewFile> {
  const file = join(dir(), `${appid}.json`);
  try {
    const cached = JSON.parse(await readFile(file, "utf8")) as ReviewFile & { title?: string };
    if (cached.reviews.length > 0) {
      cached.title ??= await appTitle(appid);
      return { ...cached, title: cached.title, reviews: cached.reviews.slice(0, max) };
    }
  } catch {
    /* not cached yet */
  }
  const reviews: SteamReview[] = [];
  let cursor = "*";
  while (reviews.length < max) {
    const url =
      `https://store.steampowered.com/appreviews/${appid}?json=1&filter=recent&language=english&purchase_type=all` +
      `&num_per_page=100&cursor=${encodeURIComponent(cursor)}`;
    const res = await fetch(url, { headers: { "user-agent": "co2lab-hub/0.1" } });
    if (!res.ok) throw new Error(`Steam answered ${res.status}`);
    const page = (await res.json()) as {
      success: number;
      cursor: string;
      reviews?: {
        recommendationid: string;
        review: string;
        voted_up: boolean;
        timestamp_created: number;
        received_for_free: boolean;
        author?: { playtime_at_review?: number };
      }[];
    };
    if (!page.success) throw new Error(`Steam has no reviews for app ${appid}`);
    if (!page.reviews?.length || page.cursor === cursor) break;
    for (const r of page.reviews)
      reviews.push({
        id: r.recommendationid,
        text: r.review,
        votedUp: r.voted_up,
        createdAt: r.timestamp_created * 1000,
        playtimeAtReviewH: Math.round(((r.author?.playtime_at_review ?? 0) / 60) * 10) / 10,
        receivedForFree: r.received_for_free,
      });
    cursor = page.cursor;
    onProgress?.(reviews.length);
    await new Promise((r) => setTimeout(r, PAGE_GAP_MS));
  }
  if (!reviews.length) throw new Error(`Steam returned no English reviews for app ${appid}`);
  const out: ReviewFile = { appid, title: await appTitle(appid), fetchedAt: Date.now(), reviews: reviews.slice(0, max) };
  await mkdir(dir(), { recursive: true });
  await writeFile(file, JSON.stringify(out));
  log.info(`compute: fetched ${out.reviews.length} reviews for ${out.title} (${appid})`);
  return out;
}

export interface FilterResult {
  kept: SteamReview[];
  dropped: { lowPlaytime: number; free: number; duplicate: number; tooShort: number };
  bombDays: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Spam rules: under 0.5 h played when reviewing, key/free copies, too short to say anything,
 * and templated text (the same normalized text 3+ times: every copy is dropped).
 * Review bombing: a day with at least 20 negative reviews and more than 5x the median daily
 * negative count. Those days are reported (not dropped) so the answer can show their effect.
 */
export function filterReviews(reviews: SteamReview[]): FilterResult {
  const counts = new Map<string, number>();
  for (const r of reviews) counts.set(norm(r.text), (counts.get(norm(r.text)) ?? 0) + 1);
  const dropped = { lowPlaytime: 0, free: 0, duplicate: 0, tooShort: 0 };
  const kept: SteamReview[] = [];
  for (const r of reviews) {
    const n = norm(r.text);
    if (n.length < 20) dropped.tooShort++;
    else if (r.receivedForFree) dropped.free++;
    else if (r.playtimeAtReviewH < 0.5) dropped.lowPlaytime++;
    else if ((counts.get(n) ?? 0) >= 3) dropped.duplicate++;
    else kept.push(r);
  }

  const negPerDay = new Map<string, number>();
  for (const r of reviews) {
    if (r.votedUp) continue;
    const day = new Date(r.createdAt).toISOString().slice(0, 10);
    negPerDay.set(day, (negPerDay.get(day) ?? 0) + 1);
  }
  const sorted = [...negPerDay.values()].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
  const bombDays = [...negPerDay.entries()]
    .filter(([, n]) => n >= 20 && n > 5 * Math.max(1, median))
    .map(([d]) => d)
    .sort();
  return { kept, dropped, bombDays };
}
