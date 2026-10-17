// End-to-end check against a running hub (npm run dev -w hub):
//   1. owner logs in and opens the dashboard socket
//   2. two fake web devices pair with codes from pair.start and come online
//   3. a run is created; the device that gets the web subtask is killed
//   4. expect: that device goes offline ~6 s later and the subtask moves to the other device
//   5. the run finishes: done with ranked deals (GEMINI_API_KEY set) or failed with the missing-key reason
//
//   npm run e2e -w hub [-- --hub http://localhost:8787] [--scenario kill|sleep]
//
// --scenario sleep pauses the worker instead of killing it (like closing a laptop lid). When it
// wakes up still holding the old subtask, the hub must send it subtask.cancel.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { HubToClient, WS_PATH, type DeviceView, type RunView } from "@co2lab/shared";
import WebSocket from "ws";

const HUB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(HUB_DIR, "..");
if (existsSync(resolve(ROOT, ".env"))) process.loadEnvFile(resolve(ROOT, ".env"));

const { values: args } = parseArgs({ options: {
    hub: { type: "string" },
    "work-ms": { type: "string", default: "16000" },
    scenario: { type: "string", default: "kill" },
  }, });
const hub = (args.hub ?? process.env.HUB_PUBLIC_URL ?? "http://localhost:8787").replace(/\/+$/, "");
const t0 = Date.now();
const t = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
const say = (...a: unknown[]) => console.log(t(), ...a);
const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  say(ok ? "PASS" : "FAIL", what);
  if (!ok) failures.push(what);
};

// ---------- owner session ----------

const login = await fetch(`${hub}/api/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ passphrase: process.env.OWNER_PASSPHRASE ?? "" }),
});
check(login.status === 204, `owner login (status ${login.status})`);
const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;

const badWs = new WebSocket(hub.replace(/^http/, "ws") + WS_PATH);
const badClose = await new Promise<number>((r) => {
  badWs.on("open", () => badWs.send(JSON.stringify({ type: "run.create", clientRunId: "x", prompt: "x" })));
  badWs.on("close", (code) => r(code));
});
check(badClose === 4001, `socket without hello is closed with 4001 (got ${badClose})`);

const owner = new WebSocket(hub.replace(/^http/, "ws") + WS_PATH, { headers: { cookie } });
const devices = new Map<string, DeviceView>();
const runs = new Map<string, RunView>();
const offlineAt = new Map<string, number>();
let pairCodes: string[] = [];
let viewerUrl: string | null = null;
const waiters: (() => void)[] = [];

owner.on("message", (raw) => {
  const msg = HubToClient.parse(JSON.parse(String(raw)));
  if (msg.type === "state.snapshot") msg.devices.forEach((d) => devices.set(d.id, d));
  if (msg.type === "device.update") {
    const prev = devices.get(msg.device.id);
    if (prev && prev.state !== "offline" && msg.device.state === "offline") offlineAt.set(msg.device.id, Date.now());
    devices.set(msg.device.id, msg.device);
  }
  if (msg.type === "run.update") runs.set(msg.run.id, msg.run);
  if (msg.type === "pair.code") pairCodes.push(msg.code);
  if (msg.type === "viewer.link") viewerUrl = msg.url;
  if (msg.type === "error") say("hub error:", msg.code, msg.message);
  waiters.splice(0).forEach((w) => w());
});
await new Promise<void>((r, j) => {
  owner.on("open", () => {
    owner.send(JSON.stringify({ type: "hello", role: "owner" }));
    r();
  });
  owner.on("error", j);
});

async function until<T>(what: string, fn: () => T | undefined | null | false, timeoutMs: number): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await new Promise<void>((r) => {
      waiters.push(r);
      setTimeout(r, 250);
    });
  }
}

// ---------- auth checks ----------

const wrong = await fetch(`${hub}/api/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ passphrase: "definitely-wrong" }),
});
check(wrong.status === 401, `wrong passphrase is rejected (status ${wrong.status})`);

function openClient(hello: object, headers: Record<string, string> = {}) {
  const ws = new WebSocket(hub.replace(/^http/, "ws") + WS_PATH, { headers });
  const got: HubToClient[] = [];
  const closed = new Promise<number>((r) => ws.on("close", (code) => r(code)));
  ws.on("open", () => ws.send(JSON.stringify(hello)));
  ws.on("message", (raw) => got.push(HubToClient.parse(JSON.parse(String(raw)))));
  return { ws, got, closed };
}

const noCookie = openClient({ type: "hello", role: "owner" });
check((await noCookie.closed) === 4001, "owner hello without a session cookie is closed with 4001");

owner.send(JSON.stringify({ type: "viewer.create", ttlMinutes: 30 }));
await until("viewer link", () => viewerUrl, 5_000);
const viewerToken = new URL(viewerUrl!).searchParams.get("viewer")!;
check(!!viewerToken, `viewer.create returned ${viewerUrl!.replace(viewerToken, "<token>")}`);
const viewer = openClient({ type: "hello", role: "viewer", token: viewerToken });
await until("viewer snapshot", () => viewer.got.find((m) => m.type === "state.snapshot"), 5_000);
check((viewer.got[0] as { role?: string }).role === "viewer", "viewer gets a read-only state.snapshot");
viewer.ws.send(JSON.stringify({ type: "pair.start" }));
await until("viewer command refused", () => viewer.got.find((m) => m.type === "error"), 5_000);
check(!viewer.got.some((m) => m.type === "pair.code"), "viewer cannot send commands (pair.start refused)");
const badViewer = openClient({ type: "hello", role: "viewer", token: "not-a-real-token" });
check((await badViewer.closed) === 4001, "invalid viewer token is closed with 4001");

// ---------- pair two fake devices ----------

owner.send(JSON.stringify({ type: "pair.start" }));
owner.send(JSON.stringify({ type: "pair.start" }));
await until("two pairing codes", () => pairCodes.length >= 2, 5_000);
check(pairCodes.every((c) => /^\d{6}$/.test(c)), `pair.start returned codes ${pairCodes.join(", ")}`);

const children: ChildProcess[] = [];
const byDeviceId = new Map<string, ChildProcess>();
const cancelledOn: { child: ChildProcess; subtaskId: string }[] = [];
const sleepScenario = args.scenario === "sleep";
const proxyActions: { kind: string; reason?: string }[] = [];
function spawnDevice(name: string, code: string): Promise<string> {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/fake-device.ts", "--hub", hub, "--code", code, "--name", name, "--kind", "laptop", "--caps", "web", "--work-ms", args["work-ms"]!, "--proxy"],
    { cwd: HUB_DIR, stdio: ["pipe", "pipe", "inherit"] },
  );
  children.push(child);
  return new Promise((r, j) => {
    child.stdout!.on("data", (buf: Buffer) => {
      for (const line of String(buf).split("\n")) {
        if (!line.trim()) continue;
        if (line.startsWith("EVENT ")) {
          const e = JSON.parse(line.slice(6));
          if (e.kind === "proxy.action") proxyActions.push(e.action);
          if (e.kind === "cancelled") cancelledOn.push({ child, subtaskId: e.subtaskId });
          if (e.kind === "online") {
            byDeviceId.set(e.deviceId, child);
            r(e.deviceId);
          }
        } else console.log(`   ${line}`);
      }
    });
    child.on("exit", (code) => j(new Error(`${name} exited ${code}`)));
  });
}

const [idA, idB] = await Promise.all([spawnDevice("Fake laptop A", pairCodes[0]!), spawnDevice("Fake laptop B", pairCodes[1]!)]);
await until("both devices idle", () => [idA, idB].every((id) => devices.get(id!)?.state === "idle"), 8_000);
check(true, "both fake devices paired and show as idle (online)");

const reuse = await fetch(`${hub}/api/pair`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ code: pairCodes[0], name: "again", kind: "laptop", capabilities: ["web"] }),
});
check(reuse.status === 400, `a used pairing code is rejected (status ${reuse.status})`);

// ---------- run + kill the worker ----------

const clientRunId = `e2e-${Date.now()}`;
const prompt = "Best lunch deals near UTSC today";
owner.send(JSON.stringify({ type: "run.create", clientRunId, prompt }));
owner.send(JSON.stringify({ type: "run.create", clientRunId, prompt })); // duplicate from a "reconnect"
const run0 = await until("run created", () => [...runs.values()].find((r) => r.clientRunId === clientRunId), 5_000);
await new Promise((r) => setTimeout(r, 500));
check([...runs.values()].filter((r) => r.clientRunId === clientRunId).length === 1, "duplicate run.create returns the same run");

const webTask = await until(
  "web subtask running",
  () => runs.get(run0.id)?.subtasks.find((s) => s.capability === "web" && s.status === "running"),
  30_000,
);
const plan = runs.get(run0.id)!.subtasks.map((s) => `${s.capability}=${s.status}${s.error ? ` (${s.error})` : ""}`);
say("plan:", plan.join(" | "));
const victim = webTask.deviceId!;
const other = victim === idA ? idB! : idA!;
await new Promise((r) => setTimeout(r, 3_000)); // let it stream a frame or two
const killedAt = Date.now();
const SLEEP_MS = 12_000;
if (sleepScenario) {
  byDeviceId.get(victim)!.stdin!.write(`sleep ${SLEEP_MS}
`);
  say(`put ${devices.get(victim)?.name} to sleep for ${SLEEP_MS / 1000} s (lid closed)`);
} else {
  byDeviceId.get(victim)!.kill();
  say(`killed ${devices.get(victim)?.name}`);
}

await until("victim offline", () => offlineAt.get(victim), 15_000);
const offlineMs = offlineAt.get(victim)! - killedAt;
check(offlineMs >= 4_000 && offlineMs <= 9_000, `${sleepScenario ? "sleeping" : "killed"} device went offline after ${(offlineMs / 1000).toFixed(1)} s (expect ~6 s)`);

const moved = await until(
  "web subtask reassigned",
  () => runs.get(run0.id)?.subtasks.find((s) => s.id === webTask.id && s.deviceId === other && s.status === "running"),
  10_000,
);
check(moved.attempt === 2, `web subtask reassigned to ${devices.get(other)?.name} (attempt ${moved.attempt})`);

if (sleepScenario) {
  await until("victim back online", () => devices.get(victim)?.state !== "offline" && devices.get(victim), 20_000);
  check(true, `${devices.get(victim)?.name} woke up and is ${devices.get(victim)?.state}`);
  check(viewer.got.some((m) => m.type === "frame"), "viewer received live frames");
  await until(
    "stale subtask cancelled on the woken device",
    () => cancelledOn.find((c) => c.child === byDeviceId.get(victim) && c.subtaskId === webTask.id),
    6_000,
  );
  check(true, "hub sent subtask.cancel to the woken device for the subtask it no longer owns");
}

// ---------- finish ----------

const final = await until(
  "run finished",
  () => {
    const r = runs.get(run0.id);
    return r && (r.status === "done" || r.status === "failed") ? r : null;
  },
  180_000,
);
say(`run ${final.status}${final.error ? `: ${final.error}` : ""}`);
for (const s of final.subtasks) say(`  ${s.capability} ${s.status} on ${s.deviceId ? devices.get(s.deviceId)?.name : "-"} attempt ${s.attempt} deals ${s.dealCount}${s.error ? ` — ${s.error}` : ""}`);
say("burn:", JSON.stringify(final.burn));
const health = (await (await fetch(`${hub}/api/health`)).json()) as { gemini: string };
check(proxyActions.length > 0, `agent proxy answered proxy.request with ${JSON.stringify(proxyActions[0])}`);
if (health.gemini === "configured") {
  check(final.status === "done", "run completed with Gemini");
  for (const d of final.ranked ?? []) say(`  ${d.rank}. [${d.source}] ${d.title} ${d.priceText ?? ""} — ${d.reason}`);
  check(final.burn.tokensIn > 0, "burn-o-meter counted real tokens");
} else {
  check(final.status === "failed" && /GEMINI_API_KEY/.test(final.error ?? ""), "without GEMINI_API_KEY the run fails with that reason");
}

// ---------- clean up ----------

for (const id of [idA!, idB!]) owner.send(JSON.stringify({ type: "device.revoke", deviceId: id }));
await new Promise((r) => setTimeout(r, 500));
for (const c of children) c.kill();
owner.close();
viewer.ws.close();
console.log(failures.length ? `\n${failures.length} check(s) FAILED:\n- ${failures.join("\n- ")}` : "\nAll checks passed.");
process.exit(failures.length ? 1 : 0);
