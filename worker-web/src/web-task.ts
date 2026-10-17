// One `web` subtask: read current food deals from RedFlagDeals, stream frames and steps,
// and return the page text as evidence. The hub turns the evidence into deals with Gemini.

import type { BrowserContext, Page } from "playwright";
import { FRAME_INTERVAL_MS, FRAME_MAX_WIDTH, type DeviceToHub, type HubToDevice, type StepKind } from "@co2lab/shared";
import {
  FOOD_CATEGORIES,
  RFD_BASE,
  RfdError,
  listPosts,
  listTopics,
  postText,
  scoreTopics,
  sleep,
  topicUrl,
  type RfdTopic,
  type ScoredTopic,
} from "./rfd.js";
import { listingHtml, threadHtml } from "./reader-view.js";
import { log } from "./config.js";

export type Assign = Extract<HubToDevice, { type: "subtask.assign" }>;

export interface WebTaskOptions {
  /** How many threads to open and read. */
  threads: number;
  /** How long each page stays on screen (also keeps the request rate low). */
  dwellMs: number;
  /** Also attach screenshots (scaled by config.screenshotScale) to the evidence. */
  evidenceImages: boolean;
}

export const VIEWPORT = { width: FRAME_MAX_WIDTH, height: 960 };
const MAX_TEXT_PER_THREAD = 2_500;
const MAX_REPLIES = 6;
const MAX_REPLY_CHARS = 350;

class Cancelled extends Error {}

export class WebTask {
  private cancelled = false;
  private page: Page | null = null;
  private framing = false;

  constructor(
    private readonly ctx: BrowserContext,
    private readonly assign: Assign,
    private readonly send: (msg: DeviceToHub) => void,
    private readonly opts: WebTaskOptions,
  ) {}

  get id(): string {
    return this.assign.subtaskId;
  }

  /** Stop right away and send nothing more for this subtask. */
  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    log(`[${this.id}] cancelled`);
    void this.page?.close().catch(() => undefined);
  }

  async run(): Promise<void> {
    const { subtaskId } = this.assign;
    try {
      this.page = await this.ctx.newPage();
      await this.page.setViewportSize(VIEWPORT);
      void this.frameLoop();
      const evidence = await this.collect();
      this.check();
      this.send({ type: "subtask.result", subtaskId, evidence });
      log(`[${subtaskId}] result sent (${evidence.text?.length ?? 0} chars, ${evidence.images.length} images)`);
    } catch (err) {
      if (this.cancelled || err instanceof Cancelled) return;
      const reason = err instanceof RfdError ? err.message : `Web worker error: ${(err as Error).message.split("\n")[0]}`;
      log(`[${subtaskId}] failed: ${reason}`);
      this.send({ type: "subtask.failed", subtaskId, reason });
    } finally {
      this.cancelled = true; // stops the frame loop
      await this.page?.close().catch(() => undefined);
    }
  }

  // ---------- The browsing itself ----------

  private async collect(): Promise<{ images: string[]; text: string | null }> {
    const page = this.page!;
    const isCancelled = () => this.cancelled;
    const images: string[] = [];

    this.step("info", "Opening RedFlagDeals Hot Deals (food categories)", 0.02);
    const found: Array<{ topic: RfdTopic; category: string }> = [];
    const errors: RfdError[] = [];
    for (const [i, cat] of FOOD_CATEGORIES.entries()) {
      this.check();
      this.step("recipe", `Reading "${cat.label}" deals`, 0.05 + i * 0.05);
      try {
        const topics = await listTopics(page.request, cat.id, isCancelled);
        for (const topic of topics) found.push({ topic, category: cat.label });
      } catch (err) {
        this.check();
        if (!(err instanceof RfdError)) throw err;
        errors.push(err);
        if (found.length === 0) break; // site unreachable or blocking: fail now, no more requests
        this.step("info", `Skipped "${cat.label}": ${err.message}`);
      }
      await this.pause(1_200);
    }
    if (found.length === 0 && errors.length > 0) throw errors[0]!;

    const ranked = scoreTopics(found, this.assign.goal);
    const shown = ranked.slice(0, 12);
    const toOpen = ranked.slice(0, this.opts.threads);
    const labels = FOOD_CATEGORIES.map((c) => c.label);
    await page.setContent(listingHtml(labels, shown, new Set()));
    this.step(
      "recipe",
      `Found ${ranked.length} current food deal threads; opening the top ${toOpen.length} for Scarborough / UTSC`,
      0.2,
    );
    await this.dwell();
    if (this.opts.evidenceImages) images.push(await this.screenshot());

    const sections: string[] = [];
    for (const [i, s] of toOpen.entries()) {
      this.check();
      const t = s.topic;
      const progress = 0.25 + (0.7 * i) / Math.max(1, toOpen.length);
      await page.setContent(listingHtml(labels, shown, new Set([t.topic_id])));
      await page.locator(`#t${t.topic_id}`).scrollIntoViewIfNeeded().catch(() => undefined);
      this.step("recipe", `Opening thread ${i + 1}/${toOpen.length}: ${t.title}`, progress);
      await this.pause(900);

      let posts;
      try {
        posts = await listPosts(page.request, t.topic_id, isCancelled);
      } catch (err) {
        this.check();
        if (!(err instanceof RfdError)) throw err;
        this.step("info", `Could not open "${t.title}": ${err.message}`);
        continue;
      }
      this.check();
      const withText = posts.map((post) => ({ post, text: postText(post.body) })).filter((p) => p.text.length > 0);
      await page.setContent(threadHtml(t, withText, `Thread ${i + 1} of ${toOpen.length} · ${withText.length} posts`));
      this.step("screenshot", `Read ${withText.length} posts from the ${t.offer?.dealer_name ?? "deal"} thread`, progress + 0.35 / toOpen.length);
      sections.push(threadSection(i + 1, s, withText));
      await this.dwell();
      if (this.opts.evidenceImages) images.push(await this.screenshot());
    }
    this.check();

    const others = ranked.slice(toOpen.length, 20);
    const text = [
      `Source: RedFlagDeals Hot Deals forum (${new URL(RFD_BASE).host}), food categories: ${labels.join(", ")}.`,
      `Read at ${new Date().toISOString()} by the Co2lab web worker. Goal: ${this.assign.goal}`,
      `Threads were picked for Scarborough / UTSC (Toronto, Ontario, and national chains); threads only valid in other provinces were skipped.`,
      "",
      ...(sections.length ? sections : ["No current food deal threads could be opened."]),
      ...(others.length
        ? [
            "### Other current food deal threads (titles only, not opened)",
            ...others.map(
              ({ topic: o }) =>
                `- ${o.offer?.dealer_name ? `[${o.offer.dealer_name}] ` : ""}${o.title}${o.offer?.expires_at ? ` (expires ${o.offer.expires_at})` : ""} — ${topicUrl(o)}`,
            ),
          ]
        : []),
    ].join("\n");
    this.step("extract", `Collected ${sections.length} threads (${text.length} characters) for the hub to read`, 1);
    return { images, text: ranked.length ? text : `${text}\n\nNo current food deals found on RedFlagDeals.` };
  }

  // ---------- Helpers ----------

  private step(kind: StepKind, text: string, progress?: number): void {
    if (this.cancelled) return;
    log(`[${this.id}] ${text}`);
    this.send({ type: "step", subtaskId: this.id, kind, text, ...(progress !== undefined ? { progress: Math.min(1, progress) } : {}) });
  }

  private check(): void {
    if (this.cancelled) throw new Cancelled();
  }

  private async pause(ms: number): Promise<void> {
    await sleep(ms);
    this.check();
  }

  /** Keep the page on screen for a moment and scroll through it so the live view moves. */
  private async dwell(): Promise<void> {
    const steps = Math.max(1, Math.round(this.opts.dwellMs / 700));
    for (let i = 0; i < steps; i++) {
      await this.pause(700);
      await this.page!.evaluate(() => window.scrollBy({ top: 260, behavior: "instant" })).catch(() => undefined);
    }
    this.check();
  }

  private async frameLoop(): Promise<void> {
    while (!this.cancelled) {
      const started = Date.now();
      if (!this.framing && this.page && !this.page.isClosed()) {
        this.framing = true;
        try {
          const jpeg = await this.page.screenshot({ type: "jpeg", quality: 60, timeout: 3_000 });
          if (!this.cancelled) {
            this.send({
              type: "frame",
              subtaskId: this.id,
              jpegBase64: jpeg.toString("base64"),
              width: VIEWPORT.width,
              height: VIEWPORT.height,
            });
          }
        } catch {
          // page navigating or closing; skip this frame
        } finally {
          this.framing = false;
        }
      }
      await sleep(Math.max(100, FRAME_INTERVAL_MS - (Date.now() - started)));
    }
  }

  /** Screenshot scaled by the subtask's config (Research Mode varies this). */
  private async screenshot(): Promise<string> {
    const page = this.page!;
    const scale = this.assign.config.screenshotScale;
    const cdp = await page.context().newCDPSession(page);
    try {
      const { data } = (await cdp.send("Page.captureScreenshot", {
        format: "jpeg",
        quality: 70,
        clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height, scale },
      })) as { data: string };
      return data;
    } finally {
      await cdp.detach().catch(() => undefined);
    }
  }
}

function threadSection(n: number, s: ScoredTopic, posts: Array<{ post: { number: number; post_time: string }; text: string }>): string {
  const t = s.topic;
  const o = t.offer;
  const op = posts.find((p) => p.post.number === 1) ?? posts[0];
  const replies = posts.filter((p) => p !== op).slice(0, MAX_REPLIES);
  const lines = [
    `### Thread ${n}: ${o?.dealer_name ? `[${o.dealer_name}] ` : ""}${t.title}`,
    `URL: ${topicUrl(t)}`,
    [
      `Category: ${s.category}`,
      o?.price && `Price: ${o.price}`,
      o?.expires_at && `Expires: ${o.expires_at}`,
      `Posted: ${t.post_time.slice(0, 10)}`,
      `Last reply: ${t.last_post_time.slice(0, 10)}`,
      `Votes: ${t.score}`,
      `Replies: ${t.total_replies}`,
    ]
      .filter(Boolean)
      .join(" · "),
    "Original post:",
    op ? op.text.slice(0, 1_400) : "(empty)",
  ];
  if (replies.length) {
    lines.push("Replies:");
    for (const r of replies) lines.push(`- (${r.post.post_time.slice(0, 10)}) ${r.text.replace(/\s+/g, " ").slice(0, MAX_REPLY_CHARS)}`);
  }
  return lines.join("\n").slice(0, MAX_TEXT_PER_THREAD) + "\n";
}
