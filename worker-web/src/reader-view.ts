// What the worker's browser window shows while it reads RedFlagDeals: a plain reader view of
// the real API data, so the laptop screen and the dashboard live frame show the actual deals.

import { RFD_BASE, topicUrl, type RfdPost, type RfdTopic, type ScoredTopic } from "./rfd.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const STYLE = `
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.45 system-ui, "Segoe UI", Roboto, sans-serif; background: #f3f3f1; color: #222; }
  header { background: #c8102e; color: #fff; padding: 14px 18px; position: sticky; top: 0; }
  header h1 { margin: 0; font-size: 19px; }
  header p { margin: 2px 0 0; font-size: 12px; opacity: .85; }
  main { padding: 12px 14px 40px; }
  .row { background: #fff; border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; display: flex; gap: 10px; align-items: flex-start; border: 2px solid transparent; transition: border-color .2s, background .2s; }
  .row.open { border-color: #c8102e; background: #fff4f4; }
  .votes { min-width: 38px; text-align: center; font-weight: 700; color: #2b7a2b; }
  .votes.neg { color: #a33; }
  .dealer { display: inline-block; font-size: 12px; font-weight: 600; background: #eee; border-radius: 4px; padding: 1px 6px; margin-right: 6px; }
  .meta { font-size: 12px; color: #666; margin-top: 3px; }
  .why { font-size: 11px; color: #c8102e; }
  .post { background: #fff; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; white-space: pre-wrap; word-wrap: break-word; }
  .post .n { font-size: 12px; color: #888; margin-bottom: 4px; white-space: normal; }
  .op { border-left: 4px solid #c8102e; }
  .status { position: fixed; bottom: 0; left: 0; right: 0; background: #222; color: #fff; font-size: 12px; padding: 6px 12px; }
`;

function page(title: string, sub: string, body: string, status: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}</style></head>
<body><header><h1>${esc(title)}</h1><p>${esc(sub)}</p></header><main>${body}</main>
<div class="status" id="status">${esc(status)}</div></body></html>`;
}

const day = (iso: string) => iso.slice(0, 10);

export function listingHtml(categoryLabels: string[], picked: ScoredTopic[], openIds: Set<number>): string {
  const rows = picked
    .map(({ topic: t, why }) => {
      const v = Math.round(t.score ?? 0);
      return `<div class="row${openIds.has(t.topic_id) ? " open" : ""}" id="t${t.topic_id}">
  <div class="votes${v < 0 ? " neg" : ""}">${v > 0 ? "+" : ""}${v}</div>
  <div><div>${t.offer?.dealer_name ? `<span class="dealer">${esc(t.offer.dealer_name)}</span>` : ""}${esc(t.title)}</div>
  <div class="meta">${t.total_replies} replies · last reply ${day(t.last_post_time)}${t.offer?.expires_at ? ` · expires ${t.offer.expires_at}` : ""}</div>
  ${why.length ? `<div class="why">${esc(why.join(" · "))}</div>` : ""}</div></div>`;
    })
    .join("\n");
  return page(
    "RedFlagDeals · Hot Deals · food",
    `${categoryLabels.join(", ")} — read-only from ${new URL(RFD_BASE).host} public API`,
    rows || "<p>No current food deals found.</p>",
    `${picked.length} relevant threads, sorted for Scarborough / UTSC`,
  );
}

export function threadHtml(t: RfdTopic, posts: Array<{ post: RfdPost; text: string }>, status: string): string {
  const body = posts
    .map(({ post, text }) => {
      const v = post.votes ? post.votes.total_up - post.votes.total_down : 0;
      return `<div class="post${post.number === 1 ? " op" : ""}"><div class="n">#${post.number} · ${day(post.post_time)}${v ? ` · ${v > 0 ? "+" : ""}${v}` : ""}</div>${esc(text)}</div>`;
    })
    .join("\n");
  const o = t.offer;
  const sub = [o?.dealer_name, o?.price && `price ${o.price}`, o?.expires_at && `expires ${o.expires_at}`, topicUrl(t)]
    .filter(Boolean)
    .join(" · ");
  return page(t.title, sub, body, status);
}

export function blankHtml(status: string): string {
  return page("Co2lab web worker", "Waiting for work", "", status);
}
