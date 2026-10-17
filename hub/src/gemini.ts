// All Gemini calls live here. Structured output + zod validation, retries on 429/5xx,
// one retry on invalid JSON. If the key or a model ID is missing we throw GeminiUnavailable;
// callers turn that into a visible failure, never a made-up answer.

import { ApiError, GoogleGenAI, type Part } from "@google/genai";
import { Deal, ProxyAction, type AgentConfig, type Burn, type DealSource, type ModelTier, type UiNode } from "@co2lab/shared";
import { z } from "zod";
import { burnFor } from "./burn.js";
import { config } from "./config.js";
import { log } from "./log.js";

export class GeminiUnavailable extends Error {}

export interface Usage {
  tier: ModelTier;
  model: string;
  tokensIn: number;
  tokensOut: number;
  burn: Burn;
}

/** Called with every real Gemini response, including ones that later fail validation. */
export type UsageSink = (u: Usage) => void;

let client: GoogleGenAI | null = null;

export function geminiProblem(tier?: ModelTier): string | null {
  if (!config.gemini.apiKey) return "GEMINI_API_KEY is not set on the hub";
  if (tier && !config.gemini.models[tier]) return `GEMINI_MODEL_${tier.toUpperCase()} is not set on the hub`;
  return null;
}

function getClient(tier: ModelTier): { ai: GoogleGenAI; model: string } {
  const problem = geminiProblem(tier);
  if (problem) throw new GeminiUnavailable(problem);
  client ??= new GoogleGenAI({ apiKey: config.gemini.apiKey });
  return { ai: client, model: config.gemini.models[tier] };
}

// Keywords Gemini's responseJsonSchema supports (per @google/genai docs); others are dropped.
// zod still validates the full constraints on the response.
const SCHEMA_KEYS = new Set([
  "$id", "$defs", "$ref", "$anchor", "type", "format", "title", "description", "enum", "items", "prefixItems",
  "minItems", "maxItems", "minimum", "maximum", "anyOf", "oneOf", "properties", "additionalProperties", "required",
]);

function sanitize(node: unknown, inProperties = false): unknown {
  if (Array.isArray(node)) return node.map((n) => sanitize(n));
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (inProperties) out[k] = sanitize(v);
    else if ((k === "minimum" || k === "maximum") && Math.abs(Number(v)) >= Number.MAX_SAFE_INTEGER) continue; // zod int bounds
    else if (SCHEMA_KEYS.has(k)) out[k] = sanitize(v, k === "properties" || k === "$defs");
  }
  return out;
}

function jsonSchema(schema: z.ZodType): unknown {
  return sanitize(z.toJSONSchema(schema, { target: "draft-2020-12" }));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

function isRetryable(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 429 || err.status >= 500;
  const msg = err instanceof Error ? err.message : String(err);
  return /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/i.test(msg);
}

function describe(err: unknown): string {
  if (err instanceof ApiError) {
    let m = err.message;
    try {
      const parsed = JSON.parse(m);
      m = parsed?.error?.message ?? m;
    } catch {}
    return `Gemini API ${err.status}: ${m.slice(0, 200)}`;
  }
  return err instanceof Error ? err.message : String(err);
}

async function callJson<S extends z.ZodType>(opts: {
  tier: ModelTier;
  label: string;
  system: string;
  parts: Part[];
  schema: S;
  onUsage: UsageSink;
}): Promise<z.infer<S>> {
  const { ai, model } = getClient(opts.tier);
  const responseJsonSchema = jsonSchema(opts.schema);
  let lastErr = "unknown error";

  for (let parseAttempt = 0; parseAttempt < 2; parseAttempt++) {
    let text: string | undefined;
    for (let i = 0; ; i++) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: opts.parts }],
          config: {
            systemInstruction: opts.system,
            responseMimeType: "application/json",
            responseJsonSchema,
            temperature: 0.2,
          },
        });
        const um = res.usageMetadata;
        const tokensIn = um?.promptTokenCount ?? 0;
        const tokensOut = (um?.candidatesTokenCount ?? 0) + (um?.thoughtsTokenCount ?? 0);
        opts.onUsage({ tier: opts.tier, model, tokensIn, tokensOut, burn: burnFor(opts.tier, tokensIn, tokensOut) });
        text = res.text;
        break;
      } catch (err) {
        if (i < RETRY_DELAYS_MS.length && isRetryable(err)) {
          log.warn(`gemini ${opts.label}: ${describe(err)}; retrying in ${RETRY_DELAYS_MS[i]} ms`);
          await sleep(RETRY_DELAYS_MS[i]!);
          continue;
        }
        throw new Error(describe(err));
      }
    }
    try {
      const parsed = opts.schema.safeParse(JSON.parse(text ?? ""));
      if (parsed.success) return parsed.data;
      lastErr = `invalid structure: ${parsed.error.issues[0]?.message ?? "?"}`;
    } catch {
      lastErr = "response was not valid JSON";
    }
    log.warn(`gemini ${opts.label}: ${lastErr}${parseAttempt === 0 ? "; retrying once" : ""}`);
  }
  throw new Error(`Gemini ${opts.label} failed: ${lastErr}`);
}

// ---------- Planner ----------

export const PLAN_IDS = ["app:tims", "app:mcdonalds", "app:popeyes", "web:redflagdeals"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

const PlanSchema = z.object({
  subtasks: z.array(z.object({ id: z.enum(PLAN_IDS), goal: z.string().min(1).max(300) })).max(8),
});

export async function planRun(prompt: string, available: PlanId[], onUsage: UsageSink) {
  return callJson({
    tier: "lite",
    label: "planner",
    schema: PlanSchema,
    onUsage,
    system:
      "You plan food-deal hunts for an agent team. Pick which sources to check for the user's request, " +
      "from this fixed list only: app:tims (Tim Hortons app offers), app:mcdonalds (McDonald's app deals), " +
      "app:popeyes (Popeyes app offers), web:redflagdeals (RedFlagDeals hot-deals forum, restaurant/food deals). " +
      "For a general deals request pick every source that fits. Each goal is one plain sentence telling the " +
      "device what to collect. Each id appears at most once.",
    parts: [
      {
        text: `Request: ${JSON.stringify(prompt)}\nSources with at least one paired device right now: ${available.join(", ") || "none"}`,
      },
    ],
  });
}

// ---------- Evidence -> deals ----------

const ExtractSchema = z.object({
  deals: z.array(
    z.object({
      title: z.string(),
      priceText: z.string().nullable(),
      conditions: z.string().nullable(),
      expiresText: z.string().nullable(),
      url: z.string().nullable(),
      imageIndex: z.number().int().nullable(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

export async function extractDeals(opts: {
  source: DealSource;
  label: string;
  goal: string;
  images: string[];
  text: string | null;
  imageRefs: (string | null)[];
  config: AgentConfig;
  onUsage: UsageSink;
}): Promise<Deal[]> {
  const parts: Part[] = [
    {
      text:
        `Source: ${opts.label} (${opts.source}). Task was: ${opts.goal}\n` +
        `There are ${opts.images.length} screenshot(s), numbered from 0 in order.` +
        (opts.text ? `\n\nText captured from the screen/page:\n${opts.text.slice(0, 30_000)}` : ""),
    },
  ];
  opts.images.forEach((data, i) => {
    parts.push({ text: `Screenshot ${i}:` });
    parts.push({ inlineData: { mimeType: "image/jpeg", data } });
  });
  const out = await callJson({
    tier: opts.config.model,
    label: `extract ${opts.source}`,
    schema: ExtractSchema,
    onUsage: opts.onUsage,
    system:
      "Extract every food deal or offer visible in the evidence. Only report deals that are actually shown; " +
      "never invent deals, prices or dates. Keep price text as written (e.g. '$1', '2 for $7', 'Free'). " +
      "conditions: purchase requirements or limits, else null. expiresText: expiry as written, else null. " +
      "url: only if a link is given in the text. imageIndex: the screenshot the deal is on, else null. " +
      "confidence: how sure you are the deal is read correctly (0-1). If there are no deals, return an empty list.",
    parts,
  });
  return out.deals.map((d) =>
    Deal.parse({
      source: opts.source,
      title: d.title,
      priceText: d.priceText,
      conditions: d.conditions,
      expiresText: d.expiresText,
      url: d.url,
      screenshotRef: d.imageIndex !== null ? (opts.imageRefs[d.imageIndex] ?? null) : null,
      confidence: d.confidence,
    }),
  );
}

// ---------- Agent proxy (Android fallback) ----------

const ProxySchema = z.object({
  why: z.string(),
  kind: z.enum(["tapNode", "tapXY", "back", "scroll", "wait", "done", "fail"]),
  nodeId: z.string().nullable(),
  x: z.number().nullable(),
  y: z.number().nullable(),
  direction: z.enum(["up", "down"]).nullable(),
  ms: z.number().int().nullable(),
  reason: z.string().nullable(),
});

export async function chooseProxyAction(opts: {
  goal: string;
  screenshot: string;
  nodes: UiNode[];
  history: string[];
  tier: ModelTier;
  onUsage: UsageSink;
}): Promise<{ action: ProxyAction; why: string }> {
  const nodes = opts.nodes
    .slice(0, 300)
    .map(
      (n) =>
        `${n.id} | ${n.text ?? ""} | ${n.desc ?? ""} | ${n.viewId ?? ""} | ${n.clickable ? "clickable" : ""} | ${n.bounds.join(",")}`,
    )
    .join("\n");
  // The device sends a downscaled screenshot but taps in screen pixels (the frame of node bounds;
  // node "0" is the root and spans the full screen).
  const root = opts.nodes.find((n) => n.id === "0") ?? opts.nodes[0];
  const screen = root ? `${root.bounds[2]}x${root.bounds[3]}` : "unknown";
  const r = await callJson({
    tier: opts.tier,
    label: "proxy",
    schema: ProxySchema,
    onUsage: opts.onUsage,
    system:
      "You control an Android phone app through an accessibility service, one action at a time. " +
      "Pick the single next action that moves toward the goal. Prefer tapNode with a node id from the list; " +
      "use tapXY only if no node fits; tapXY x,y are SCREEN pixels in the same frame as the node bounds " +
      "(the screenshot is scaled down, so do not use image pixel positions). Dismiss popups and onboarding with their close/skip/not-now buttons. " +
      "Never type or submit credentials, never place orders or redeem offers. If the app shows a sign-in screen, " +
      "return kind=fail with reason 'app needs sign-in'. Return kind=done when the deals/offers list is on screen. " +
      "Fill only the fields the chosen kind needs; set the rest to null.",
    parts: [
      {
        text:
          `Goal: ${opts.goal}\nScreen size (pixels): ${screen}\nActions so far: ${opts.history.join(" -> ") || "none"}\n` +
          `Nodes (id | text | desc | viewId | clickable | bounds l,t,r,b):\n${nodes}`,
      },
      { inlineData: { mimeType: "image/jpeg", data: opts.screenshot } },
    ],
  });
  let raw: unknown;
  switch (r.kind) {
    case "tapNode":
      raw = { kind: r.kind, nodeId: r.nodeId };
      break;
    case "tapXY":
      raw = { kind: r.kind, x: r.x, y: r.y };
      break;
    case "scroll":
      raw = { kind: r.kind, direction: r.direction ?? "down" };
      break;
    case "wait":
      raw = { kind: r.kind, ms: Math.min(Math.max(r.ms ?? 1000, 0), 10_000) };
      break;
    case "fail":
      raw = { kind: r.kind, reason: r.reason ?? r.why };
      break;
    default:
      raw = { kind: r.kind };
  }
  const parsed = ProxyAction.safeParse(raw);
  if (!parsed.success) throw new Error(`Gemini proxy returned an incomplete ${r.kind} action`);
  const action = parsed.data;
  if (action.kind === "tapNode" && !opts.nodes.some((n) => n.id === action.nodeId))
    throw new Error(`Gemini proxy chose unknown node ${action.nodeId}`);
  return { action, why: r.why };
}

// ---------- Merge ----------

const MergeSchema = z.object({
  ranked: z.array(z.object({ index: z.number().int().min(0), rank: z.number().int().min(1), reason: z.string() })),
});

export async function rankDeals(prompt: string, deals: Deal[], onUsage: UsageSink) {
  const list = deals
    .map(
      (d, i) =>
        `${i}. [${d.source}] ${d.title} | price: ${d.priceText ?? "-"} | conditions: ${d.conditions ?? "-"} | expires: ${d.expiresText ?? "-"} | confidence ${d.confidence}`,
    )
    .join("\n");
  return callJson({
    tier: "flash",
    label: "merge",
    schema: MergeSchema,
    onUsage,
    system:
      "Rank food deals for the user's request. Remove duplicates (same offer from the same chain): keep only the " +
      "clearest copy. Drop items that are not food/restaurant deals. Rank best value first (price, how easy the " +
      "conditions are, how well it fits the request). Use only the indexes given. reason: one short sentence.",
    parts: [{ text: `Request: ${JSON.stringify(prompt)}\nDeals:\n${list}` }],
  });
}
