// Simulated device for testing the hub without a phone or Playwright.
//
//   npm run fake-device -w hub -- --code 123456 [--name "Fake laptop"] [--kind laptop] [--caps web]
//   npm run fake-device -w hub -- --token <token>
//
// It pairs (with --code) or connects (with --token), sends heartbeats, accepts subtask.assign,
// streams a few frames + steps, then sends subtask.result. Evidence is real text: for `web` it fetches
// the live RedFlagDeals Hot Deals RSS feed; for `app:*` it sends a clearly labelled text fixture
// (only a real phone can open the apps). Frames reuse "Mock UI/Tree UI.jpg" as a placeholder image.
//
// Type "sleep <ms>" on stdin to simulate a closed lid (no heartbeats, work paused) for that long.
// --proxy sends one proxy.request (agent fallback) per subtask and logs the hub's proxy.action.
// Other flags: --hub <url>, --work-ms <ms per subtask, default 12000>, --fail "<reason>",
//   --battery <pct>, --temp <C>, --not-charging, --state <file to save {deviceId, token}>.
// Machine-readable lines start with "EVENT " (used by scripts/e2e.ts).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { HEARTBEAT_MS, HubToDevice, RECONNECT_MAX_MS, RECONNECT_MIN_MS, WS_PATH, type DeviceToHub } from "@co2lab/shared";
import WebSocket from "ws";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
if (existsSync(resolve(ROOT, ".env"))) process.loadEnvFile(resolve(ROOT, ".env"));

const { values: args } = parseArgs({
  options: {
    hub: { type: "string" },
    code: { type: "string" },
    token: { type: "string" },
    name: { type: "string", default: "Fake device" },
    kind: { type: "string", default: "laptop" },
    caps: { type: "string", default: "web" },
    "work-ms": { type: "string", default: "12000" },
    fail: { type: "string" },
    proxy: { type: "boolean", default: false },
    battery: { type: "string", default: "80" },
    temp: { type: "string", default: "35" },
    "not-charging": { type: "boolean", default: false },
    state: { type: "string" },
  },
});

const hub = (args.hub ?? process.env.WORKER_HUB_URL ?? process.env.HUB_PUBLIC_URL ?? "http://localhost:8787").replace(/\/+$/, "");
const wsUrl = hub.replace(/^http/, "ws") + WS_PATH;
const workMs = Number(args["work-ms"]);
const tag = `[${args.name}]`;

const event = (kind: string, data: Record<string, unknown> = {}) => console.log(`EVENT ${JSON.stringify({ kind, ...data })}`);
const say = (...a: unknown[]) => console.log(tag, ...a);

const framePath = resolve(ROOT, "Mock UI", "Tree UI.jpg");
const frameJpeg = existsSync(framePath) ? readFileSync(framePath).toString("base64") : null;

async function pair(code: string): Promise<{ deviceId: string; token: string }> {
  const res = await fetch(`${hub}/api/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, name: args.name, kind: args.kind, capabilities: args.caps!.split(",").map((s) => s.trim()) }),
  });
  const body = (await res.json()) as { deviceId?: string; token?: string; error?: string };
  if (!res.ok || !body.token || !body.deviceId) throw new Error(`pairing failed: ${body.error ?? res.status}`);
  return { deviceId: body.deviceId, token: body.token };
}

const RFD_FEED = "https://forums.redflagdeals.com/feed/forum/9";

async function webEvidence(): Promise<string> {
  const res = await fetch(RFD_FEED, { signal: AbortSignal.timeout(15_000), headers: { "user-agent": "Co2lab fake-device test" } });
  if (!res.ok) throw new Error(`RedFlagDeals feed returned ${res.status}`);
  const xml = await res.text();
  // Atom feed: <entry><link href=.../><title><![CDATA[...]]></title><content><![CDATA[...]]></content></entry>
  const items = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0, 40).map((m) => {
    const get = (t: string) =>
      (m[1]!.match(new RegExp(`<${t}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${t}>`))?.[1] ?? "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim();
    const link = (m[1]!.match(/<link href="([^"]+)"/)?.[1] ?? "").replace(/&amp;/g, "&");
    return `- ${get("title")} | ${link} | ${get("content").slice(0, 200)}`;
  });
  if (items.length === 0) throw new Error("RedFlagDeals feed had no items");
  return `RedFlagDeals Hot Deals forum (live RSS ${RFD_FEED}, fetched ${new Date().toISOString()}):\n${items.join("\n")}`;
}

function appFixture(cap: string): string {
  return (
    `TEST FIXTURE from fake-device (not a real app capture) for ${cap}.\n` +
    `Accessibility text dump of the Offers screen:\n` +
    `Offers\nFree medium fries with any $1 purchase. Valid until Oct 31. Mobile order only.\n` +
    `2 for $7 mix and match. Ends Sunday.\n$1 any size coffee. Today only.`
  );
}

let token = args.token;
let deviceId: string | null = null;
let ws: WebSocket | null = null;
let backoff = RECONNECT_MIN_MS;
const running = new Map<string, { cancelled: boolean }>();
/** Simulated suspend (lid closed): nothing is sent and work pauses until this time. */
let asleepUntil = 0;
const asleep = () => Date.now() < asleepUntil;

function send(msg: DeviceToHub) {
  if (asleep()) return;
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function work(ms: number) {
  await sleep(ms);
  while (asleep()) await sleep(200);
}

async function runSubtask(subtaskId: string, capability: string, goal: string) {
  const job = { cancelled: false };
  running.set(subtaskId, job);
  event("assigned", { subtaskId, capability });
  say(`assigned ${capability}: ${goal}`);
  const steps = 4;
  for (let i = 1; i <= steps; i++) {
    await work(workMs / steps);
    if (job.cancelled) return;
    send({ type: "step", subtaskId, kind: "info", text: `fake step ${i}/${steps} for ${capability}`, progress: i / (steps + 1) });
    if (frameJpeg) send({ type: "frame", subtaskId, jpegBase64: frameJpeg, width: 720, height: 1280 });
  }
  if (job.cancelled) return;
  if (args.proxy && frameJpeg) {
    send({
      type: "proxy.request",
      requestId: `r-${subtaskId}`,
      subtaskId,
      goal: "Open the Offers tab",
      screenshot: frameJpeg,
      nodes: [
        { id: "0", text: null, desc: null, viewId: null, clickable: false, bounds: [0, 0, 1080, 2340] },
        { id: "0.1", text: "Offers", desc: null, viewId: "fake:id/tab_offers", clickable: true, bounds: [0, 2200, 360, 2340] },
      ],
      history: [],
    });
    await work(3_000);
    if (job.cancelled) return;
  }
  running.delete(subtaskId);
  if (args.fail) {
    send({ type: "subtask.failed", subtaskId, reason: args.fail });
    event("failed", { subtaskId });
    return;
  }
  let text: string;
  try {
    text = capability === "web" ? await webEvidence() : appFixture(capability);
  } catch (e) {
    send({ type: "subtask.failed", subtaskId, reason: e instanceof Error ? e.message : String(e) });
    event("failed", { subtaskId });
    return;
  }
  send({ type: "subtask.result", subtaskId, evidence: { images: [], text } });
  event("result", { subtaskId, chars: text.length });
  say(`sent result for ${capability} (${text.length} chars of text evidence)`);
}

function connect() {
  ws = new WebSocket(wsUrl);
  ws.on("open", () => {
    backoff = RECONNECT_MIN_MS;
    send({ type: "hello", role: "device", token });
  });
  ws.on("message", (raw) => {
    const parsed = HubToDevice.safeParse(JSON.parse(String(raw)));
    if (!parsed.success) return say("unexpected message", String(raw).slice(0, 200));
    const msg = parsed.data;
    switch (msg.type) {
      case "hello.ok":
        deviceId = msg.deviceId;
        event("online", { deviceId });
        say(`connected as ${msg.name} (${msg.deviceId})`);
        break;
      case "subtask.assign":
        void runSubtask(msg.subtaskId, msg.capability, msg.goal);
        break;
      case "subtask.cancel": {
        const job = running.get(msg.subtaskId);
        if (job) job.cancelled = true;
        running.delete(msg.subtaskId);
        event("cancelled", { subtaskId: msg.subtaskId });
        say(`cancelled ${msg.subtaskId}`);
        break;
      }
      case "proxy.action":
        event("proxy.action", { requestId: msg.requestId, action: msg.action });
        say("proxy.action", JSON.stringify(msg.action));
        break;
      case "error":
        say(`hub error ${msg.code}: ${msg.message}`);
        break;
    }
  });
  ws.on("close", (code, reason) => {
    if (code === 4001) {
      say(`hub rejected us: ${reason}`);
      event("rejected", { reason: String(reason) });
      clearInterval(heartbeat);
      process.stdin.destroy();
      process.exitCode = 2;
      return;
    }
    say(`disconnected (${code}); reconnecting in ${backoff} ms`);
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
  });
  ws.on("error", (e) => say("socket error:", e.message));
}

if (!token) {
  if (!args.code) {
    console.error("give --code <6 digits> to pair, or --token <token> to connect");
    process.exit(1);
  }
  const p = await pair(args.code);
  token = p.token;
  deviceId = p.deviceId;
  event("paired", { deviceId: p.deviceId, token: p.token });
  say(`paired as ${p.deviceId}`);
  if (args.state) writeFileSync(args.state, JSON.stringify(p, null, 2));
}

const heartbeat = setInterval(() => {
  send({
    type: "heartbeat",
    telemetry: {
      batteryPct: Number(args.battery),
      charging: !args["not-charging"],
      tempC: Number(args.temp),
      cpuPct: null,
    },
    runningSubtaskIds: [...running.keys()],
  });
}, HEARTBEAT_MS);

// stdin commands (used by e2e.ts): "sleep <ms>" simulates a closed lid for that long.
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  for (const line of chunk.split("\n")) {
    const m = line.trim().match(/^sleep (\d+)$/);
    if (!m) continue;
    asleepUntil = Date.now() + Number(m[1]);
    event("sleeping", { ms: Number(m[1]) });
    say(`simulating sleep for ${m[1]} ms`);
    setTimeout(() => {
      event("awake");
      say("awake");
    }, Number(m[1]));
  }
});

connect();
