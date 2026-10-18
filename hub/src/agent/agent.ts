// General agent (SPEC §4.8): Gemini decides WHAT to do from the request and what the devices
// actually have; the scheduler (code) decides WHO does it. Every output is structured and
// validated against the device catalog, so the planner cannot invent a device or an app.

import type { ContextItem, DeviceKind, ProxyAction, RunAnswer, UiNode } from "@co2lab/shared";
import { ProxyAction as ProxyActionSchema } from "@co2lab/shared";
import { z } from "zod";
import { callJson, PLAN_IDS, type PlanId, type UsageSink } from "../gemini.js";
import { log } from "../log.js";

export interface CatalogDevice {
  id: string;
  name: string;
  kind: DeviceKind;
  state: string;
  capabilities: string[];
  context: ContextItem[];
}

export type Tool = "deals" | "web" | "reviews" | "app";

export interface PlannedTask {
  tool: Tool;
  /** app: Android package to open. */
  package?: string | null;
  /** deals: which recipe source. */
  source: PlanId | null;
  goal: string;
  label?: string;
  startUrl: string | null;
  steamAppIds: number[];
}

export interface Plan {
  reasoning: string;
  title: string;
  stage: string;
  tasks: PlannedTask[];
  cannotDo: string | null;
}

const TaskSchema = z.object({
  tool: z.enum(["deals", "web", "reviews", "app"]),
  /** app: the Android package to open (from the catalog). */
  package: z.string().nullable(),
  source: z.enum(PLAN_IDS).nullable(),
  goal: z.string().min(3).max(400),
  /** Shown on the dashboard: 1-4 words, e.g. "Tim Hortons offers", "Steam co-op search". */
  label: z.string().min(1).max(40),
  startUrl: z.string().nullable(),
  steamAppIds: z.array(z.number().int().positive()).max(6),
});
const PlanSchema = z.object({
  reasoning: z.string().max(800),
  /** Dashboard labels (see LABEL_RULES): the whole request, and this round of tasks. */
  title: z.string().min(2).max(48),
  stage: z.string().min(2).max(36),
  tasks: z.array(TaskSchema).max(8),
  cannotDo: z.string().max(400).nullable(),
});

function catalogText(devices: CatalogDevice[]): string {
  if (!devices.length) return "(no devices online)";
  return devices
    .map((d) => {
      const games = d.context.filter((c) => c.kind === "steam_game");
      const apps = d.context.filter((c) => c.kind === "installed_app");
      const browser = d.context.find((c) => c.kind === "browser");
      return [
        `- ${d.name} (${d.kind}, ${d.state}); capabilities: ${d.capabilities.join(", ")}`,
        browser ? `  browser: ${browser.label}` : "",
        apps.length ? `  installed apps: ${apps.slice(0, 200).map((a) => `${a.label} [${a.id}]`).join(", ")}` : "",
        games.length ? `  installed Steam games (${games.length}): ${games.slice(0, 200).map((g) => `${g.label} [${g.id}]`).join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

/**
 * How the planner names things for the dashboard's task tree (a parent row, one group per round,
 * one row per task). Short, plain, sentence case; never "Phase N", step numbers, or device names.
 */
const LABEL_RULES =
  "Labels for the owner's dashboard: title = what this request is, 2-5 words, sentence case, no punctuation " +
  "(e.g. 'Lunch deal search', 'Co-op game finder'). stage = what this round of tasks does, 2-4 words starting with a verb " +
  "(e.g. 'Read in-app offers', 'Search the Steam store', 'Check player reviews'); never 'Phase', 'Step' or numbers. " +
  "Each task label = 1-4 words naming the source or thing (e.g. 'Tim Hortons offers', 'Steam co-op search', 'Your Steam library'); " +
  "no device names, no verbs like 'Collect'. ";

const TOOLS_TEXT =
  "Tools (each task uses exactly one):\n" +
  "- deals: collect current offers from one built-in source (source = app:tims, app:mcdonalds, app:popeyes need an Android device with that capability; web:redflagdeals needs a web device). Always use this tool (never web) for those four sources. For restaurant / food deal requests, use EVERY deal source that has an online device (phone apps and web:redflagdeals) unless the request names specific restaurants.\n" +
  "- web: a browser agent on a laptop or the Cloud worker visits sites and reads them to reach the goal. Give a concrete goal and, when you know it, a startUrl (e.g. a Steam store search URL https://store.steampowered.com/search/?term=...&maxprice=20 or a site's search page). One task per site or sub-question; tasks run in parallel on different devices.\n" +
  "  For games, search the Steam store by tag rather than by words in the title, e.g. https://store.steampowered.com/search/?tags=1685&maxprice=20 (1685 = Co-op, 1662 = Survival, 1742 = Story Rich, 3843 = Online Co-Op) and sort by reviews (&filter=topsellers or &sort_by=Reviews_DESC).\n" +
  "- app: on an Android phone, open one of its installed apps (package = the id in [brackets] in the phone's installed apps) and reach the goal with the phone's screen agent; the hub then reads the screens. Use this for context only the owner's signed-in apps have (e.g. the owner's game library in the Steam app, orders, rewards, saved items). Goals must only read: never buy, send, post, sign in or change settings. Not for the four deal sources (use deals).\n" +
  "- reviews: analyze Steam user reviews on the devices (topics like grind, story, performance, multiplayer, value, content; positive vs negative, by playtime). Needs Steam app IDs (numbers). Use only when you already know the IDs.\n";

export async function planRequest(o: {
  prompt: string;
  devices: CatalogDevice[];
  /** Wave 2: what wave 1 found. */
  findings?: string;
  onUsage: UsageSink;
}): Promise<Plan> {
  const followUp = o.findings !== undefined;
  return withFallback({
    tier: "flash" as const,
    label: followUp ? "agent follow-up" : "agent planner",
    schema: PlanSchema,
    onUsage: o.onUsage,
    system:
      "You are the planner of Co2lab, a team of the owner's own old devices (phone, laptops) plus a Cloud worker. " +
      "Decide what work answers the owner's request, using only the tools and devices listed. Prefer what the devices " +
      "uniquely have (signed-in apps, installed games) and say so in reasoning. Keep it small: 1-4 tasks usually. " +
      "Never plan payments, orders, sign-ins, messages or posts. Set fields a tool does not use to null / []. " +
      LABEL_RULES +
      (followUp
        ? "This is a follow-up round: you see what the earlier tasks found. Decide what is still missing to fully answer the " +
          "request and add the tasks for it; return no tasks only when the findings already answer every part of the request. " +
          "If the request asks for recommendations or to find something and the findings have no candidates yet, add web tasks " +
          "to find candidates, using what was learned (e.g. the genres of games the owner plays, excluding games they own). " +
          "If the request asks about reviews, sentiment, fake/troll reviews, or qualities players report (grind, story, " +
          "performance, value) and the findings list candidate games with Steam app IDs (store.steampowered.com/app/<id>/ links), " +
          "add ONE reviews task for the 3-5 best candidates. Do not repeat a task that already ran."
        : "If no listed device can do anything useful for the request, return no tasks and explain in cannotDo."),
    parts: [
      {
        text:
          `${TOOLS_TEXT}\nDevices online:\n${catalogText(o.devices)}\n\nOwner's request: ${JSON.stringify(o.prompt)}` +
          (followUp ? `\n\nWhat the first tasks found:\n${o.findings}` : ""),
      },
    ],
  });
}

// ---------- Findings from a web task's evidence ----------

const FindingsSchema = z.object({
  summary: z.string().max(800),
  items: z
    .array(
      z.object({
        title: z.string().max(200),
        detail: z.string().max(400),
        url: z.string().nullable(),
        steamAppId: z.number().int().nullable(),
      }),
    )
    .max(15),
});
export type Findings = z.infer<typeof FindingsSchema>;

export async function extractFindings(o: { goal: string; text: string; images: string[]; onUsage: UsageSink }): Promise<Findings> {
  return withFallback({
    tier: "lite" as const,
    label: "findings",
    schema: FindingsSchema,
    onUsage: o.onUsage,
    system:
      "Read what a browser agent saw and report what it found for its goal. Only use facts present in the text or screenshots; " +
      "never invent prices, names or numbers. items: the concrete things found (products, games, offers, places) with the " +
      "useful detail (price, discount, rating, review summary). steamAppId: the number in a store.steampowered.com/app/<id>/ URL when present.",
    parts: [
      { text: `Goal: ${o.goal}\n\nPage text (by URL):\n${o.text.slice(0, 28_000)}` },
      ...o.images.slice(-2).map((data) => ({ inlineData: { mimeType: "image/jpeg", data } })),
    ],
  });
}

// ---------- The browser agent's next action ----------

const WebActionSchema = z.object({
  why: z.string(),
  kind: z.enum(["tapNode", "type", "open", "scroll", "back", "wait", "done", "fail"]),
  nodeId: z.string().nullable(),
  text: z.string().nullable(),
  submit: z.boolean().nullable(),
  url: z.string().nullable(),
  direction: z.enum(["up", "down"]).nullable(),
  reason: z.string().nullable(),
});

export async function chooseWebAction(o: {
  goal: string;
  page: { url: string; title: string; text: string };
  screenshot: string;
  nodes: UiNode[];
  history: string[];
  onUsage: UsageSink;
}): Promise<{ action: ProxyAction; why: string }> {
  const nodes = o.nodes.map((n) => `${n.id} | ${n.viewId ?? ""} | ${n.text ?? ""} | ${n.desc ?? ""}`).join("\n");
  const r = await withFallback({
    tier: "lite" as const,
    label: "web agent",
    schema: WebActionSchema,
    onUsage: o.onUsage,
    system:
      "You control a web browser, one action at a time, to reach the goal. Use the numbered elements: tapNode (click), " +
      "type (fill an input; submit=true presses Enter), open (go to a URL you are sure of), scroll, back, wait. " +
      "Return done as soon as the information the goal asks for is visible in the page text (the hub reads the pages you visited). " +
      "Close cookie banners with the most privacy-preserving choice (reject / necessary only). Never sign in, enter personal data, " +
      "buy, or post. If the goal needs any of that, or the site blocks you, return fail with the reason. Fill only the fields the kind needs.",
    parts: [
      {
        text:
          `Goal: ${o.goal}\nURL: ${o.page.url}\nTitle: ${o.page.title}\nActions so far: ${o.history.join(" -> ") || "none"}\n\n` +
          `Elements (id | tag | text | details):\n${nodes || "(none)"}\n\nVisible text:\n${o.page.text.slice(0, 9_000)}`,
      },
      { inlineData: { mimeType: "image/jpeg", data: o.screenshot } },
    ],
  });
  let raw: unknown;
  switch (r.kind) {
    case "tapNode":
      raw = { kind: "tapNode", nodeId: r.nodeId };
      break;
    case "type":
      raw = { kind: "type", nodeId: r.nodeId, text: r.text ?? "", submit: r.submit ?? true };
      break;
    case "open":
      raw = { kind: "open", url: r.url };
      break;
    case "scroll":
      raw = { kind: "scroll", direction: r.direction ?? "down" };
      break;
    case "wait":
      raw = { kind: "wait", ms: 1500 };
      break;
    case "fail":
      raw = { kind: "fail", reason: r.reason ?? r.why };
      break;
    default:
      raw = { kind: r.kind };
  }
  const parsed = ProxyActionSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`web agent returned an incomplete ${r.kind} action`);
  const action = parsed.data;
  if ((action.kind === "tapNode" || action.kind === "type") && !o.nodes.some((n) => n.id === action.nodeId))
    throw new Error(`web agent chose unknown element ${action.nodeId}`);
  return { action, why: r.why };
}

// ---------- The final answer ----------

export interface AnswerSection {
  /** Shown as the item's source: "RedFlagDeals", "store.steampowered.com", "review analysis". */
  source: string;
  deviceId: string | null;
  text: string;
}

const AnswerSchema = z.object({
  text: z.string().max(2000),
  items: z
    .array(z.object({ title: z.string(), detail: z.string(), price: z.string().nullable(), section: z.number().int().min(0), url: z.string().nullable() }))
    .max(12),
});

export async function composeAnswer(o: { prompt: string; sections: AnswerSection[]; onUsage: UsageSink }): Promise<RunAnswer> {
  const r = await withFallback({
    tier: "flash" as const,
    label: "answer",
    schema: AnswerSchema,
    onUsage: o.onUsage,
    system:
      "Answer the owner's request using only the findings below (each numbered section came from one device task). " +
      "text: a short, direct answer (2-5 sentences) with the key numbers. items: the best concrete options, ranked, each " +
      "with a short title (the product, game or offer name only), price as written but short (e.g. \"$12.49\", \"Free\", \"2 for $7\", null if none), detail = one sentence of evidence, and " +
      "with the section number it came from. If the findings do not answer the request, say exactly what is missing. " +
      "For review analysis, compare games by complaints per 100 reviews (how common a problem is), not by the share of " +
      "negative mentions alone, and say how many reviews were analyzed.",
    parts: [
      {
        text:
          `Request: ${JSON.stringify(o.prompt)}\n\n` +
          o.sections.map((s, i) => `[${i}] from ${s.source}:\n${s.text.slice(0, 6_000)}`).join("\n\n"),
      },
    ],
  });
  return {
    text: r.text,
    items: r.items.map((it) => {
      const s = o.sections[it.section];
      return { title: it.title, detail: it.detail, price: it.price?.trim() ? it.price.trim().slice(0, 24) : null, source: s?.source ?? "?", deviceId: s?.deviceId ?? null, url: it.url };
    }),
  };
}

/**
 * Flash first; if it is overloaded or errors after its retries (e.g. Gemini 503 "high demand"),
 * the same call once more on the Lite model, so a busy model does not end the whole run.
 */
async function withFallback<S extends z.ZodType>(opts: Parameters<typeof callJson<S>>[0]): Promise<z.infer<S>> {
  try {
    return await callJson(opts);
  } catch (e) {
    if (opts.tier === "lite") throw e;
    log.warn(`gemini ${opts.label}: ${(e as Error).message.slice(0, 120)}; trying the lite model`);
    return callJson({ ...opts, tier: "lite", label: `${opts.label} (lite)` });
  }
}
