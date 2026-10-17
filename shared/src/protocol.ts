// Co2lab wire protocol. Every WebSocket message is JSON with a `type` field.
// The hub validates everything it receives with these schemas.
// Kotlin mirror and examples: shared/PROTOCOL.md. Change both together.

import { z } from "zod";

// ---------- Common ----------

export const KNOWN_APPS = ["tims", "mcdonalds", "popeyes", "whatsapp"] as const;
export const AppId = z.enum(KNOWN_APPS);
export type AppId = z.infer<typeof AppId>;

/** `web` or `app:<appId>`; the scheduler matches subtasks to devices by this. */
export const Capability = z.string().regex(/^(web|app:[a-z0-9-]+)$/);
export type Capability = z.infer<typeof Capability>;

export const DeviceKind = z.enum(["android", "laptop", "cloud"]);
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
});
export type DeviceView = z.infer<typeof DeviceView>;

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
});
export type SubtaskView = z.infer<typeof SubtaskView>;

export const RunStatus = z.enum(["planning", "running", "merging", "done", "failed"]);
export const RunView = z.object({
  id: z.string(),
  clientRunId: z.string(),
  prompt: z.string(),
  status: RunStatus,
  subtasks: z.array(SubtaskView),
  ranked: z.array(RankedDeal).nullable(),
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
  /** Model ids behind each tier on this hub (the free tier maps pro to the flash model). */
  models: z.record(z.string(), z.string()),
  store: z.string(),
});
export type ResearchState = z.infer<typeof ResearchState>;

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
  }),
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
  }),
  z.object({ type: z.literal("subtask.cancel"), subtaskId: z.string() }),
  z.object({ type: z.literal("proxy.action"), requestId: z.string(), action: ProxyAction }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
]);
export type HubToDevice = z.infer<typeof HubToDevice>;

// ---------- Dashboard (owner / viewer) -> Hub ----------
// Viewers may only send `hello`; the hub drops anything else from them.

export const ClientToHub = z.discriminatedUnion("type", [
  Hello,
  z.object({ type: z.literal("run.create"), clientRunId: z.string().min(1), prompt: z.string().min(1).max(500) }),
  z.object({ type: z.literal("pair.start") }),
  z.object({ type: z.literal("device.revoke"), deviceId: z.string() }),
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
  z.object({ type: z.literal("research.propose") }),
  z.object({
    type: z.literal("research.feedback"),
    experimentId: z.string(),
    kind: z.enum(["flag", "approve", "redirect"]),
    text: z.string(),
  }),
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
  z.object({ type: z.literal("approval.request"), approval: ApprovalView }),
  z.object({ type: z.literal("approval.resolved"), approvalId: z.string(), approved: z.boolean() }),
  z.object({ type: z.literal("research.update"), experiment: ExperimentView }),
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

/** POST /api/login -> sets httpOnly session cookie. */
export const LoginRequest = z.object({ passphrase: z.string().min(1) });

/** QR payload for pairing: co2lab://pair?hub=<url-encoded hub url>&code=<6 digits> */
export function pairingQrPayload(hubUrl: string, code: string): string {
  return `co2lab://pair?hub=${encodeURIComponent(hubUrl)}&code=${code}`;
}
