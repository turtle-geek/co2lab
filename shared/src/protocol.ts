// Co2lab wire protocol. Every WebSocket message is JSON with a `type` field.
// The hub validates everything it receives with these schemas.
// Kotlin mirror and examples: shared/PROTOCOL.md. Change both together.

import { z } from "zod";

// ---------- Common ----------

export const KNOWN_APPS = ["tims", "mcdonalds", "popeyes", "whatsapp"] as const;
export const AppId = z.enum(KNOWN_APPS);
export type AppId = z.infer<typeof AppId>;

/** `web` or `app:<appId>`; the scheduler matches subtasks to devices by this. */
/** `app:<id>` is a recipe app id (tims) or, for the general agent, an Android package name (com.valvesoftware.android.steam.community). */
export const Capability = z.string().regex(/^(web|app:[A-Za-z0-9._-]+)$/);
export type Capability = z.infer<typeof Capability>;

/** `desktop` is a computer without a battery or a portable chassis (found by the web worker's auto-detection). */
export const DeviceKind = z.enum(["android", "laptop", "desktop", "cloud"]);
export type DeviceKind = z.infer<typeof DeviceKind>;

/** Derived by the hub from heartbeat, telemetry, and work. Drives the tree mood. */
export const DeviceState = z.enum(["idle", "working", "offline", "resting", "hot", "error", "revoked"]);
export type DeviceState = z.infer<typeof DeviceState>;

export const Telemetry = z.object({
  batteryPct: z.number().min(0).max(100).nullable(),
  charging: z.boolean().nullable(),
  tempC: z.number().nullable(),
  cpuPct: z.number().min(0).max(100).nullable(),
});
export type Telemetry = z.infer<typeof Telemetry>;

export const ModelTier = z.enum(["lite", "flash", "pro"]);
export type ModelTier = z.infer<typeof ModelTier>;

/** Agent configuration under test in Research Mode; the default comes from the best finding. */
export const AgentConfig = z.object({
  model: ModelTier,
  screenshotScale: z.union([z.literal(0.25), z.literal(0.5), z.literal(0.75), z.literal(1)]),
  mode: z.enum(["recipe", "vision"]),
});
export type AgentConfig = z.infer<typeof AgentConfig>;

export const DealSource = z.enum(["tims", "mcdonalds", "popeyes", "redflagdeals"]);
export type DealSource = z.infer<typeof DealSource>;

export const Deal = z.object({
  source: DealSource,
  title: z.string(),
  priceText: z.string().nullable(),
  conditions: z.string().nullable(),
  expiresText: z.string().nullable(),
  url: z.string().nullable(),
  /** Hub-side path of the screenshot this deal was read from, if any. */
  screenshotRef: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
export type Deal = z.infer<typeof Deal>;

export const RankedDeal = Deal.extend({
  rank: z.number().int().min(1),
  reason: z.string(),
  deviceId: z.string().nullable(),
});
export type RankedDeal = z.infer<typeof RankedDeal>;

/** Burn-o-meter numbers for one run. Energy and CO2 are estimates. */
export const Burn = z.object({
  tokensIn: z.number().int(),
  tokensOut: z.number().int(),
  costUsd: z.number(),
  energyWh: z.number(),
  gCo2: z.number(),
});
export type Burn = z.infer<typeof Burn>;

export const StepKind = z.enum(["recipe", "fallback", "extract", "screenshot", "info"]);
export type StepKind = z.infer<typeof StepKind>;

/** Accessibility node summary the Android agent sends for fallback decisions. */
export const UiNode = z.object({
  id: z.string(),
  text: z.string().nullable(),
  desc: z.string().nullable(),
  viewId: z.string().nullable(),
  clickable: z.boolean(),
  /** [left, top, right, bottom] in screen pixels. */
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});
export type UiNode = z.infer<typeof UiNode>;

/** One action chosen by the hub's agent proxy (Gemini) for the Android agent. */
export const ProxyAction = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tapNode"), nodeId: z.string() }),
  z.object({ kind: z.literal("tapXY"), x: z.number(), y: z.number() }),
  z.object({ kind: z.literal("back") }),
  z.object({ kind: z.literal("scroll"), direction: z.enum(["up", "down"]) }),
  z.object({ kind: z.literal("wait"), ms: z.number().int().min(0).max(10_000) }),
  /** Web agent only: type into an input (and press Enter when submit). */
  z.object({ kind: z.literal("type"), nodeId: z.string(), text: z.string().max(200), submit: z.boolean() }),
  /** Web agent only: go to a URL. */
  z.object({ kind: z.literal("open"), url: z.string().url() }),
  z.object({ kind: z.literal("done") }),
  z.object({ kind: z.literal("fail"), reason: z.string() }),
]);
export type ProxyAction = z.infer<typeof ProxyAction>;

/** What a device gathered; the hub turns this into deals with Gemini. */
export const Evidence = z.object({
  /** JPEG screenshots, base64 without data: prefix. */
  images: z.array(z.string()).default([]),
  /** Page text or accessibility text, when the device has it. */
  text: z.string().nullable().default(null),
});
export type Evidence = z.infer<typeof Evidence>;

// ---------- General agent (P4, SPEC §4.8) ----------

/**
 * One fact a device can tell the planner: an installed app (id = Android package), a Steam game
 * (id = Steam app ID), the browser it drives. Devices send only these, never raw files.
 */
export const ContextItem = z.object({
  kind: z.enum(["installed_app", "steam_game", "browser"]),
  id: z.string().max(200),
  label: z.string().max(200),
});
export type ContextItem = z.infer<typeof ContextItem>;

/** The planner's final answer to a general request. */
export const RunAnswer = z.object({
  text: z.string(),
  items: z.array(
    z.object({
      title: z.string(),
      detail: z.string(),
      /** Short price as shown, e.g. "$12.49", "Free", "2 for $7"; null when not about a price. */
      price: z.string().nullable().optional(),
      /** Where it came from: an app, a site, or "review analysis". */
      source: z.string(),
      deviceId: z.string().nullable(),
      url: z.string().nullable(),
    }),
  ),
});
export type RunAnswer = z.infer<typeof RunAnswer>;

/** Extra instructions on subtask.assign for the web agent loop (absent = the RedFlagDeals recipe). */
export const WebAgentSpec = z.object({ startUrl: z.string().url().nullable(), maxSteps: z.number().int().min(1).max(30) });
export type WebAgentSpec = z.infer<typeof WebAgentSpec>;

// ---------- Views the hub sends to dashboards ----------

export const CurrentTask = z.object({
  subtaskId: z.string(),
  capability: Capability,
  label: z.string(),
  progress: z.number().min(0).max(1),
});

export const DeviceView = z.object({
  id: z.string(),
  name: z.string(),
  kind: DeviceKind,
  capabilities: z.array(Capability),
  state: DeviceState,
  telemetry: Telemetry.nullable(),
  lastSeenAt: z.number().nullable(),
  currentTask: CurrentTask.nullable(),
  /** Short message shown on the card, e.g. "plug in Galaxy A54" or a failure reason. */
  note: z.string().nullable(),
  /** What this device shares with the planner (P4), e.g. installed apps or Steam games. */
  context: z.array(ContextItem).optional(),
});
export type DeviceView = z.infer<typeof DeviceView>;

/** Gemini usage since a time, grouped by device, step kind and model tier (GET /api/impact). */
export interface AiUsageGroup {
  /** Device whose task the call was for; null = the hub itself (planning, writing the answer). */
  deviceId: string | null;
  /** plan | proxy (steering a device) | extract (reading a screen or page) | merge (writing the answer) */
  kind: string;
  tier: ModelTier;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  /** Part of tokensIn from screenshots (0 for calls recorded before this was tracked). */
  imageTokens: number;
  gCo2: number;
  energyWh: number;
  costUsd: number;
}
export interface AiUsage {
  since: number;
  /** Requests (runs) with at least one Gemini call in the window. */
  requests: number;
  groups: AiUsageGroup[];
  /** The same calls per request, newest first. */
  runs: AiUsageRun[];
  /** Every device that ever paired (revoked ones too), so old pairings of the same device can be merged by name. */
  devices: { id: string; name: string; kind: string }[];
}
export interface AiUsageRun {
  runId: string;
  /** The request as typed (or "Lab capture: …" for research captures); null if the run row is gone. */
  prompt: string | null;
  status: string | null;
  firstAt: number;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  gCo2: number;
  costUsd: number;
}

/** One bucket of a device's stored telemetry (GET /api/devices/:id/telemetry). */
export interface TelemetryPoint {
  time: number;
  batteryPct: number | null;
  tempC: number | null;
  charging: boolean | null;
}

export const SubtaskStatus = z.enum(["queued", "running", "done", "failed", "cancelled"]);
export const SubtaskView = z.object({
  id: z.string(),
  capability: Capability,
  goal: z.string(),
  status: SubtaskStatus,
  deviceId: z.string().nullable(),
  attempt: z.number().int(),
  error: z.string().nullable(),
  dealCount: z.number().int(),
  /** General-agent tasks: what was found, in one or two sentences. */
  findings: z.string().nullable().optional(),
  /** Display name, e.g. "Tim Hortons" or "Web: store.steampowered.com". */
  label: z.string().optional(),
  /** General agent: planning round that created this task (1 = first plan, 2+ = follow-ups). */
  wave: z.number().int().optional(),
  /** Short display name from the planner (e.g. "Tim Hortons offers"); falls back to label. */
  name: z.string().optional(),
  /** Which planner tool made this task. */
  tool: z.enum(["deals", "web", "app", "reviews"]).optional(),
  /** When a device started / finished this task (ms), for "time your devices worked". */
  startedAt: z.number().nullable().optional(),
  finishedAt: z.number().nullable().optional(),
  /** Kind and name of the device that ran it, kept even after that device is removed or re-paired. */
  deviceKind: DeviceKind.optional(),
  deviceName: z.string().optional(),
});
export type SubtaskView = z.infer<typeof SubtaskView>;

export const RunStatus = z.enum(["planning", "running", "merging", "done", "failed", "cancelled"]);
export const RunView = z.object({
  id: z.string(),
  clientRunId: z.string(),
  prompt: z.string(),
  status: RunStatus,
  subtasks: z.array(SubtaskView),
  ranked: z.array(RankedDeal).nullable(),
  /** General-agent requests (P4): the answer, with each item's source. Deal requests use `ranked`. */
  answer: RunAnswer.nullable().optional(),
  /** General agent: the planner's reasoning for this run (first plan, then follow-ups). */
  plan: z.string().nullable().optional(),
  /** Planner's short title for the request (e.g. "Lunch deal search") and a name per planning round. */
  title: z.string().nullable().optional(),
  stages: z.array(z.string()).optional(),
  burn: Burn,
  error: z.string().nullable(),
  createdAt: z.number(),
  finishedAt: z.number().nullable(),
});
export type RunView = z.infer<typeof RunView>;

export const ApprovalView = z.object({
  id: z.string(),
  kind: z.enum(["whatsapp-send"]),
  /** Exact text that will be sent if approved. */
  message: z.string(),
  target: z.string(),
  runId: z.string().nullable(),
  createdAt: z.number(),
});
export type ApprovalView = z.infer<typeof ApprovalView>;

/** Research Mode (T7, SPEC §4.5). */
export const FeedbackKind = z.enum(["flag", "approve", "redirect"]);

/** One specific difference between a trial's extraction and the owner's ground truth. */
export const Misread = z.object({
  kind: z.enum(["price", "missed", "extra"]),
  app: z.string(),
  /** Ground-truth title (price/missed) or extracted title (extra). */
  title: z.string(),
  expected: z.string().nullable(),
  got: z.string().nullable(),
});
export type Misread = z.infer<typeof Misread>;

/** Something the research agent read through the Papiers CLI and cites in its hypothesis. */
export const PapiersCitation = z.object({
  ref: z.string(),
  title: z.string().nullable(),
  /** Text the hub actually read from Papiers for this ref. */
  excerpt: z.string(),
  /** Why the agent cites it. */
  use: z.string(),
});
export type PapiersCitation = z.infer<typeof PapiersCitation>;

export const ExperimentView = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  hypothesis: z.string(),
  status: z.enum(["proposed", "approved", "running", "analyzed"]),
  configs: z.array(AgentConfig),
  trials: z.array(
    z.object({
      configIndex: z.number().int(),
      captureId: z.string(),
      precision: z.number(),
      recall: z.number(),
      priceExactPct: z.number(),
      tokens: z.number().int(),
      latencyMs: z.number().int(),
      costUsd: z.number(),
      misreads: z.array(Misread).optional(),
      error: z.string().nullable().optional(),
    }),
  ),
  analysis: z.string().nullable(),
  nextProposal: z.string().nullable(),
  feedback: z.array(z.object({ id: z.string(), kind: FeedbackKind, text: z.string(), createdAt: z.number() })),
  citesFeedbackIds: z.array(z.string()),
  findingRef: z.string().nullable(),
  title: z.string().optional(),
  createdAt: z.number().optional(),
  papiers: z.array(PapiersCitation).optional(),
  /** Why Papiers context is missing, when the CLI failed. */
  papiersError: z.string().nullable().optional(),
  captureIds: z.array(z.string()).optional(),
  /** Set when the agent or a trial run failed; shown as-is. */
  error: z.string().nullable().optional(),
  /** Id of the experiment that replaced this proposal after a redirect. */
  supersededBy: z.string().nullable().optional(),
});
export type ExperimentView = z.infer<typeof ExperimentView>;

/** Owner's verdict on one deal while labeling ground truth. */
export const LabelItem = z.object({
  verdict: z.enum(["correct", "wrong", "missing"]),
  title: z.string(),
  priceText: z.string().nullable(),
  /** For "wrong": what the app really shows (null = the deal does not exist). */
  correctTitle: z.string().nullable().optional(),
  correctPrice: z.string().nullable().optional(),
});
export type LabelItem = z.infer<typeof LabelItem>;

/** GET /api/research: captures and findings (experiments also arrive by WebSocket). */
export const CaptureView = z.object({
  id: z.string(),
  app: AppId,
  createdAt: z.number(),
  status: z.enum(["capturing", "ready", "failed"]),
  error: z.string().nullable(),
  runId: z.string().nullable(),
  deviceName: z.string().nullable(),
  /** Hub evidence refs ("frames/<file>.jpg"). */
  frames: z.array(z.string()),
  hasText: z.boolean(),
  /** Deals the live run extracted (default config); the starting point for labeling. */
  candidates: z.array(Deal),
  groundTruth: z
    .object({ deals: z.array(Deal), labels: z.array(LabelItem), labeledAt: z.number() })
    .nullable(),
});
export type CaptureView = z.infer<typeof CaptureView>;

export const FindingView = z.object({
  id: z.string(),
  experimentId: z.string(),
  summary: z.string(),
  papiersRef: z.string().nullable(),
  createdAt: z.number(),
});
export type FindingView = z.infer<typeof FindingView>;

export const ResearchState = z.object({
  captures: z.array(CaptureView),
  findings: z.array(FindingView),
  /** What the research agent is doing right now, if anything. */
  busy: z.string().nullable(),
  /** The busy job is a proposal the owner may cancel. */
  cancellable: z.boolean().optional(),
  /** Model ids behind each tier on this hub (the free tier maps pro to the flash model). */
  models: z.record(z.string(), z.string()),
  store: z.string(),
});
export type ResearchState = z.infer<typeof ResearchState>;

/** What a computer reports about itself when it asks to join (web worker auto-detection). */
export const DeviceInfo = z.object({
  hostname: z.string().max(100),
  /** e.g. "Windows 11 Pro 10.0.26200" or "Ubuntu 24.04". */
  os: z.string().max(100),
  arch: z.string().max(20),
  /** e.g. "Dell Inc. XPS 13 9310"; null when the firmware reports nothing useful. */
  model: z.string().max(100).nullable(),
  /** e.g. "Intel Core i7-1185G7 (8 threads)". */
  cpu: z.string().max(100).nullable(),
  ramGb: z.number().nullable(),
  hasBattery: z.boolean(),
  /** Browser Playwright will drive, e.g. "Microsoft Edge"; null when none was found. */
  browser: z.string().max(60).nullable(),
});
export type DeviceInfo = z.infer<typeof DeviceInfo>;

/** A device-code request waiting for the owner. */
export const PendingDevice = z.object({
  /** Short code the device prints, e.g. "BKDF-QRWT". */
  userCode: z.string(),
  name: z.string(),
  kind: DeviceKind,
  capabilities: z.array(Capability),
  info: DeviceInfo,
  /** Public IP the request came from, so the owner can spot a stranger. */
  ip: z.string().nullable(),
  createdAt: z.number(),
  expiresAt: z.number(),
});
export type PendingDevice = z.infer<typeof PendingDevice>;

// ---------- Compute jobs (P3, SPEC §4.7) ----------
// Devices pull batches; the hub decides batch size, threads and pauses from the split strategy and live telemetry.

export const ComputeKind = z.enum(["embed"]);
export type ComputeKind = z.infer<typeof ComputeKind>;

export const SplitStrategy = z.enum(["fast", "eco"]);
export type SplitStrategy = z.infer<typeof SplitStrategy>;

export const AspectSpec = z.object({ name: z.string(), seeds: z.array(z.string()).min(1) });
export type AspectSpec = z.infer<typeof AspectSpec>;

export const ComputeItem = z.object({ id: z.string(), text: z.string(), playtimeH: z.number() });
export type ComputeItem = z.infer<typeof ComputeItem>;

const PosNeg = z.object({ pos: z.number().int(), neg: z.number().int() });
/** Sentence counts for one aspect, split by the reviewer's playtime when they wrote the review. */
export const AspectCount = z.object({
  aspect: z.string(),
  pos: z.number().int(),
  neg: z.number().int(),
  byPlaytime: z.object({ under5h: PosNeg, from5to30h: PosNeg, over30h: PosNeg }),
  /** A few example sentences (negative first), for the answer and the dashboard. */
  examples: z.array(z.object({ text: z.string(), positive: z.boolean() })).max(4),
});
export type AspectCount = z.infer<typeof AspectCount>;

export const ComputeDeviceView = z.object({
  deviceId: z.string(),
  name: z.string(),
  state: z.enum(["working", "paused", "idle"]),
  batches: z.number().int(),
  sentences: z.number().int(),
  sentencesPerS: z.number().nullable(),
  batchSize: z.number().int(),
  threads: z.number().int(),
  tempC: z.number().nullable(),
  peakTempC: z.number().nullable(),
  /** Estimate: active seconds x a per-device-kind wattage scaled by CPU load. */
  energyWh: z.number(),
});
export type ComputeDeviceView = z.infer<typeof ComputeDeviceView>;

export const ComputeSetView = z.object({
  id: z.string(),
  appId: z.number().int(),
  title: z.string(),
  strategy: SplitStrategy,
  status: z.enum(["fetching", "running", "done", "failed", "cancelled"]),
  error: z.string().nullable(),
  createdAt: z.number(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
  reviews: z.object({
    fetched: z.number().int(),
    kept: z.number().int(),
    dropped: z.object({ lowPlaytime: z.number().int(), free: z.number().int(), duplicate: z.number().int(), tooShort: z.number().int() }),
    /** Days with a burst of negative reviews (review bombing), as YYYY-MM-DD. */
    bombDays: z.array(z.string()),
  }),
  batches: z.object({
    total: z.number().int(),
    done: z.number().int(),
    inFlight: z.number().int(),
    retried: z.number().int(),
    /** Batches given up after 3 failed tries; their reviews are not in the results. */
    dropped: z.number().int(),
    droppedReviews: z.number().int(),
  }),
  sentences: z.number().int(),
  devices: z.array(ComputeDeviceView),
  /** In-run feedback decisions, newest last (e.g. "paused Dragonfly at 39 °C"). */
  decisions: z.array(z.object({ at: z.number(), deviceId: z.string().nullable(), text: z.string() })),
  aspects: z.array(AspectCount),
  energyWh: z.number(),
});
export type ComputeSetView = z.infer<typeof ComputeSetView>;

// ---------- Handshake (first message on every socket) ----------

export const Hello = z.object({
  type: z.literal("hello"),
  role: z.enum(["device", "owner", "viewer"]),
  /** Device token or viewer token. Owners authenticate with the session cookie and may omit it. */
  token: z.string().optional(),
});
export type Hello = z.infer<typeof Hello>;

// ---------- Device -> Hub ----------

export const DeviceToHub = z.discriminatedUnion("type", [
  Hello,
  z.object({
    type: z.literal("heartbeat"),
    telemetry: Telemetry,
    runningSubtaskIds: z.array(z.string()),
  }),
  z.object({
    type: z.literal("frame"),
    subtaskId: z.string().nullable(),
    jpegBase64: z.string(),
    width: z.number().int(),
    height: z.number().int(),
  }),
  z.object({
    type: z.literal("step"),
    subtaskId: z.string(),
    kind: StepKind,
    text: z.string(),
    progress: z.number().min(0).max(1).optional(),
  }),
  z.object({ type: z.literal("subtask.result"), subtaskId: z.string(), evidence: Evidence }),
  z.object({ type: z.literal("subtask.failed"), subtaskId: z.string(), reason: z.string() }),
  z.object({
    type: z.literal("proxy.request"),
    requestId: z.string(),
    subtaskId: z.string(),
    goal: z.string(),
    screenshot: z.string(),
    nodes: z.array(UiNode),
    history: z.array(z.string()),
    /** Web agent: the page's URL and visible text, so Gemini can read what the screenshot shows. */
    page: z.object({ url: z.string(), title: z.string(), text: z.string().max(12_000) }).optional(),
  }),
  // Compute jobs: an idle device asks for work it can run; it reports how the batch went.
  z.object({ type: z.literal("job.pull"), kinds: z.array(ComputeKind).min(1), cores: z.number().int().min(1) }),
  z.object({
    type: z.literal("job.result"),
    jobId: z.string(),
    durationMs: z.number().int(),
    sentences: z.number().int(),
    threads: z.number().int(),
    cpuPct: z.number().nullable(),
    tempC: z.number().nullable(),
    counts: z.array(AspectCount),
  }),
  z.object({ type: z.literal("job.failed"), jobId: z.string(), reason: z.string() }),
  /** Sent after hello.ok and whenever it changes: what this device can tell the planner. */
  z.object({ type: z.literal("device.context"), items: z.array(ContextItem).max(2000) }),
]);
export type DeviceToHub = z.infer<typeof DeviceToHub>;

// ---------- Hub -> Device ----------

export const HubToDevice = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello.ok"), deviceId: z.string(), name: z.string() }),
  z.object({
    type: z.literal("subtask.assign"),
    subtaskId: z.string(),
    runId: z.string(),
    capability: Capability,
    /** Plain-language goal, e.g. "Collect all current offers in the Tim Hortons app". */
    goal: z.string(),
    config: AgentConfig,
    /** Present for general web tasks: run the browser agent loop instead of a built-in recipe. */
    agent: WebAgentSpec.optional(),
  }),
  z.object({ type: z.literal("subtask.cancel"), subtaskId: z.string() }),
  z.object({ type: z.literal("proxy.action"), requestId: z.string(), action: ProxyAction }),
  z.object({
    type: z.literal("job.assign"),
    jobId: z.string(),
    setId: z.string(),
    kind: ComputeKind,
    /** Pinned so every device scores the same text the same way. */
    models: z.object({ embed: z.string(), sentiment: z.string() }),
    threads: z.number().int().min(1),
    items: z.array(ComputeItem),
    aspects: z.array(AspectSpec),
  }),
  /** Nothing for you now (no work, or the feedback loop paused you); ask again after retryMs. */
  z.object({ type: z.literal("job.none"), retryMs: z.number().int(), reason: z.string() }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
]);
export type HubToDevice = z.infer<typeof HubToDevice>;

// ---------- Dashboard (owner / viewer) -> Hub ----------
// Viewers may only send `hello`; the hub drops anything else from them.

export const ClientToHub = z.discriminatedUnion("type", [
  Hello,
  z.object({ type: z.literal("run.create"), clientRunId: z.string().min(1), prompt: z.string().min(1).max(500) }),
  /** Stop a run: its device tasks are cancelled and nothing more is planned or written. */
  z.object({ type: z.literal("run.cancel"), runId: z.string() }),
  z.object({ type: z.literal("pair.start") }),
  /** Approve a pending device-code request (see `POST /api/device-code`). `name` renames the device. */
  z.object({ type: z.literal("devicecode.approve"), userCode: z.string(), name: z.string().trim().min(1).max(60).optional() }),
  z.object({ type: z.literal("devicecode.deny"), userCode: z.string() }),
  z.object({ type: z.literal("device.revoke"), deviceId: z.string() }),
  /** The owner renames a device; the device learns its new name on its next hello.ok. */
  z.object({ type: z.literal("device.rename"), deviceId: z.string(), name: z.string().trim().min(1).max(60) }),
  z.object({ type: z.literal("viewer.create"), ttlMinutes: z.number().int().min(5).max(24 * 60).optional() }),
  z.object({ type: z.literal("share.request"), runId: z.string(), target: z.string() }),
  z.object({ type: z.literal("approval.respond"), approvalId: z.string(), approve: z.boolean() }),
  // Research Mode
  z.object({ type: z.literal("research.capture"), app: AppId }),
  z.object({
    type: z.literal("research.label"),
    captureId: z.string(),
    /** Ground truth: the deals the app really shows. */
    deals: z.array(Deal),
    /** The owner's per-deal verdicts that produced `deals` (kept for the record). */
    labels: z.array(LabelItem).optional(),
  }),
  /** `idea`: what the owner wants tested, in their words; the agent turns it into the experiment. */
  z.object({ type: z.literal("research.propose"), idea: z.string().trim().max(500).optional() }),
  /** Stop the research agent while it is writing a proposal; its draft is discarded. */
  z.object({ type: z.literal("research.cancel") }),
  z.object({
    type: z.literal("research.feedback"),
    experimentId: z.string(),
    kind: z.enum(["flag", "approve", "redirect"]),
    text: z.string(),
  }),
  // Compute jobs
  z.object({
    type: z.literal("compute.start"),
    appId: z.number().int().positive(),
    strategy: SplitStrategy,
    maxReviews: z.number().int().min(100).max(20_000).optional(),
  }),
  z.object({ type: z.literal("compute.cancel"), setId: z.string() }),
]);
export type ClientToHub = z.infer<typeof ClientToHub>;

// ---------- Hub -> Dashboard ----------

export const HubToClient = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("state.snapshot"),
    role: z.enum(["owner", "viewer"]),
    devices: z.array(DeviceView),
    runs: z.array(RunView),
    approvals: z.array(ApprovalView),
    experiments: z.array(ExperimentView),
    defaultConfig: AgentConfig,
    computeSets: z.array(ComputeSetView).optional(),
  }),
  z.object({ type: z.literal("device.update"), device: DeviceView }),
  z.object({ type: z.literal("device.removed"), deviceId: z.string() }),
  z.object({
    type: z.literal("frame"),
    deviceId: z.string(),
    subtaskId: z.string().nullable(),
    jpegBase64: z.string(),
    width: z.number().int(),
    height: z.number().int(),
    at: z.number(),
  }),
  z.object({
    type: z.literal("step"),
    deviceId: z.string(),
    subtaskId: z.string(),
    kind: StepKind,
    text: z.string(),
    at: z.number(),
  }),
  z.object({ type: z.literal("run.update"), run: RunView }),
  z.object({ type: z.literal("pair.code"), code: z.string().regex(/^\d{6}$/), qrPayload: z.string(), expiresAt: z.number() }),
  z.object({ type: z.literal("viewer.link"), url: z.string(), expiresAt: z.number() }),
  /** Owners only: sent after the snapshot and whenever the list changes. `hubUrl` fills in the install one-liner. */
  z.object({ type: z.literal("devicecode.list"), hubUrl: z.string(), pending: z.array(PendingDevice) }),
  z.object({ type: z.literal("approval.request"), approval: ApprovalView }),
  z.object({ type: z.literal("approval.resolved"), approvalId: z.string(), approved: z.boolean() }),
  z.object({ type: z.literal("research.update"), experiment: ExperimentView }),
  z.object({ type: z.literal("compute.update"), set: ComputeSetView }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
]);
export type HubToClient = z.infer<typeof HubToClient>;

// ---------- HTTP ----------

/** POST /api/pair (unauthenticated; the one-time code is the credential). */
export const PairRequest = z.object({
  code: z.string().regex(/^\d{6}$/),
  name: z.string().min(1).max(60),
  kind: DeviceKind,
  capabilities: z.array(Capability).min(1),
});
export type PairRequest = z.infer<typeof PairRequest>;

export const PairResponse = z.object({ deviceId: z.string(), token: z.string() });
export type PairResponse = z.infer<typeof PairResponse>;

/**
 * Device-code pairing for computers (like `gh auth login`). No secret is needed to start:
 * nothing gets a token until the owner approves the request in the dashboard.
 * POST /api/device-code -> DeviceCodeStartResponse; then POST /api/device-code/poll every `intervalS`.
 */
export const DeviceCodeStartRequest = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(["laptop", "desktop", "cloud"]),
  capabilities: z.array(Capability).min(1),
  info: DeviceInfo,
});
export type DeviceCodeStartRequest = z.infer<typeof DeviceCodeStartRequest>;

export const DeviceCodeStartResponse = z.object({
  /** Secret the device polls with. Never shown to the owner. */
  deviceCode: z.string(),
  userCode: z.string(),
  /** Page where the owner approves; `verificationUrlComplete` has the code filled in. */
  verificationUrl: z.string(),
  verificationUrlComplete: z.string(),
  expiresAt: z.number(),
  intervalS: z.number().int(),
});
export type DeviceCodeStartResponse = z.infer<typeof DeviceCodeStartResponse>;

export const DeviceCodePollRequest = z.object({ deviceCode: z.string().min(1).max(200) });

/** 200 for every state; `slow_down` means poll less often. */
export const DeviceCodePollResponse = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("slow_down") }),
  z.object({ status: z.literal("approved"), deviceId: z.string(), token: z.string(), name: z.string() }),
  z.object({ status: z.literal("denied") }),
  z.object({ status: z.literal("expired") }),
]);
export type DeviceCodePollResponse = z.infer<typeof DeviceCodePollResponse>;

/** POST /api/login -> sets httpOnly session cookie. */
export const LoginRequest = z.object({ passphrase: z.string().min(1) });

/** QR payload for pairing: co2lab://pair?hub=<url-encoded hub url>&code=<6 digits> */
export function pairingQrPayload(hubUrl: string, code: string): string {
  return `co2lab://pair?hub=${encodeURIComponent(hubUrl)}&code=${code}`;
}
