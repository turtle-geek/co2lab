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

/** Research Mode. T7 may extend these through this file and SPEC.md. */
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
    }),
  ),
  analysis: z.string().nullable(),
  nextProposal: z.string().nullable(),
  feedback: z.array(
    z.object({ id: z.string(), kind: z.enum(["flag", "approve", "redirect"]), text: z.string(), createdAt: z.number() }),
  ),
  citesFeedbackIds: z.array(z.string()),
  findingRef: z.string().nullable(),
});
export type ExperimentView = z.infer<typeof ExperimentView>;

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
  /** Approve a pending device-code request (see `POST /api/device-code`). `name` renames the device. */
  z.object({ type: z.literal("devicecode.approve"), userCode: z.string(), name: z.string().trim().min(1).max(60).optional() }),
  z.object({ type: z.literal("devicecode.deny"), userCode: z.string() }),
  z.object({ type: z.literal("device.revoke"), deviceId: z.string() }),
  z.object({ type: z.literal("viewer.create"), ttlMinutes: z.number().int().min(5).max(24 * 60).optional() }),
  z.object({ type: z.literal("share.request"), runId: z.string(), target: z.string() }),
  z.object({ type: z.literal("approval.respond"), approvalId: z.string(), approve: z.boolean() }),
  // Research Mode
  z.object({ type: z.literal("research.capture"), app: AppId }),
  z.object({ type: z.literal("research.label"), captureId: z.string(), deals: z.array(Deal) }),
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
  /** Owners only: sent after the snapshot and whenever the list changes. `hubUrl` fills in the install one-liner. */
  z.object({ type: z.literal("devicecode.list"), hubUrl: z.string(), pending: z.array(PendingDevice) }),
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
