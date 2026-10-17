// Spike: fetch up to N English Steam reviews for one app and save them (public appreviews endpoint).
//   node scripts/spike-fetch-reviews.mjs <appid> [max=3000] [out=../hub/data/reviews/<appid>.json]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const appid = Number(process.argv[2]);
const max = Number(process.argv[3] ?? 3000);
const out = resolve(process.argv[4] ?? `../hub/data/reviews/${appid}.json`);
if (!appid) throw new Error("usage: spike-fetch-reviews.mjs <appid> [max] [out]");

const reviews = [];
let cursor = "*";
let summary = null;
while (reviews.length < max) {
  const url =
    `https://store.steampowered.com/appreviews/${appid}?json=1&filter=recent&language=english&purchase_type=all` +
    `&num_per_page=100&cursor=${encodeURIComponent(cursor)}`;
  const res = await fetch(url, { headers: { "user-agent": "co2lab-research/0.1" } });
  if (!res.ok) throw new Error(`steam ${res.status}`);
  const page = await res.json();
  if (!page.success) throw new Error("steam success=0");
  summary ??= page.query_summary;
  if (!page.reviews?.length || page.cursor === cursor) break;
  for (const r of page.reviews)
    reviews.push({
      id: r.recommendationid,
      text: r.review,
      votedUp: r.voted_up,
      createdAt: r.timestamp_created * 1000,
      playtimeAtReviewH: Math.round(((r.author?.playtime_at_review ?? 0) / 60) * 10) / 10,
      gamesOwned: r.author?.num_games_owned ?? null,
      authorReviews: r.author?.num_reviews ?? null,
      steamPurchase: r.steam_purchase,
      receivedForFree: r.received_for_free,
      helpful: r.votes_up,
    });
  cursor = page.cursor;
  process.stdout.write(`\r${reviews.length} reviews`);
  await new Promise((r) => setTimeout(r, 1200)); // stay well under Steam's rate limit
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ appid, fetchedAt: Date.now(), summary, reviews: reviews.slice(0, max) }));
console.log(`\nsaved ${Math.min(reviews.length, max)} reviews to ${out}`);
