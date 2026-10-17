// Probe server + minimal fake hub: checks the Android agent on a real phone without the real hub.
//
// Fake hub (speaks the real protocol from shared/PROTOCOL.md):
//   GET  /pair?hub=<tunnel url>  page with a fresh 6-digit code and its QR (co2lab://pair?...), localhost only
//   POST /api/pair        the phone pairs here (code from /pair), gets {deviceId, token}
//   WS   /ws              hello {role: device, token} -> hello.ok; unknown token -> close 4001
//   POST /assign          {"capability":"app:tims","mode":"recipe","scale":0.5,"goal":"...","proxyScript":[actions]}
//   POST /cancel          {"subtaskId":"..."}
//   GET  /proxy           pending proxy.request (screenshot saved to out/)
//   POST /proxy           {"action":{"kind":"tapNode","nodeId":"0.1"}} answers the oldest pending request
//   GET  /events          recent device messages (steps, results, failures)
//   GET  /status          connection, heartbeat, subtasks
//
// Probe (debug, needs "Allow probe commands" on the phone):
//   POST /cmd             {"cmd": "...", "args": {...}} -> waits for the phone's probe.reply
//
//   GET  /                status page, GET /apk downloads the debug APK
// Run: node server.mjs (port 8790), expose with: cloudflared tunnel --url http://localhost:8790
// Through the tunnel only /apk, /api/pair, /api/health and /ws are reachable; the rest is localhost-only.
// The pairing code is the credential for /api/pair; devices need their token for /ws.
// Still: shut the tunnel down when not testing.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT ?? 8790);
const here = path.dirname(fileURLToPath(import.meta.url));
const APK = path.resolve(here, "../../android/app/build/outputs/apk/debug/app-debug.apk");
const OUT = path.join(here, "out");
fs.mkdirSync(OUT, { recursive: true });

let phone = null;
let lastHello = null;
let lastHeartbeat = null;
let lastFrame = null;
let nextId = 1;
const pending = new Map();

// Fake hub state
let pairCode = null; // { code, expiresAt, attempts }
// tokenHash -> { deviceId, name, capabilities }; kept on disk so a restart does not unpair the phone.
const DEVICES_FILE = path.join(OUT, "devices.json");
const devices = new Map(fs.existsSync(DEVICES_FILE) ? JSON.parse(fs.readFileSync(DEVICES_FILE, "utf8")) : []);
const saveDevices = () => fs.writeFileSync(DEVICES_FILE, JSON.stringify([...devices]));
const subtasks = new Map(); // id -> { capability, status, error, images, startedAt }
const proxyQueue = []; // pending proxy.request messages (without screenshot)
const proxyScripts = new Map(); // subtaskId -> [actions]
const events = [];

function log(...a) {
  const line = [new Date().toISOString().slice(11, 19), ...a].join(" ");
  console.log(line);
  events.push(line);
  if (events.length > 300) events.shift();
}
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

function newPairCode() {
  pairCode = { code: String(crypto.randomInt(0, 1_000_000)).padStart(6, "0"), expiresAt: Date.now() + 5 * 60_000, attempts: 0 };
  log("pairing code", pairCode.code);
  return pairCode;
}

function hubUrl(req) {
  // /pair is opened on the laptop (localhost); the phone needs the tunnel address.
  return new URL(req.url, "http://x").searchParams.get("hub") ?? process.env.PUBLIC_URL ?? `http://${req.headers.host}`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const route = `${req.method} ${url.pathname}`;
  // Requests through the cloudflared tunnel carry cf-connecting-ip. Only the phone's routes are
  // reachable that way; everything that controls the phone or shows its screen is localhost-only.
  const viaTunnel = !!req.headers["cf-connecting-ip"] || !!req.headers["x-forwarded-for"];
  const PUBLIC = new Set(["GET /apk", "POST /api/pair", "GET /health", "GET /api/health"]);
  if (viaTunnel && !PUBLIC.has(route)) return send(res, 403, "localhost only");
  try {
    switch (route) {
      case "GET /health":
      case "GET /api/health":
        return json(res, 200, { ok: true });
      case "GET /apk": {
        if (!fs.existsSync(APK)) return send(res, 404, "APK not built yet");
        res.writeHead(200, {
          "content-type": "application/vnd.android.package-archive",
          "content-disposition": 'attachment; filename="co2lab-agent.apk"',
        });
        return fs.createReadStream(APK).pipe(res);
      }
      case "GET /frame.jpg": {
        if (!lastFrame) return send(res, 404, "no frame yet");
        res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" });
        return res.end(Buffer.from(lastFrame.jpegBase64, "base64"));
      }
      case "GET /status":
        return json(res, 200, {
          connected: !!phone,
          hello: lastHello,
          heartbeat: lastHeartbeat,
          frameAt: lastFrame?.at ?? null,
          frameSubtask: lastFrame?.subtaskId ?? null,
          devices: [...devices.values()],
          subtasks: Object.fromEntries([...subtasks].map(([k, v]) => [k, { ...v, images: v.images.length }])),
          proxyPending: proxyQueue.length,
        });
      case "GET /events":
        return send(res, 200, events.slice(-Number(url.searchParams.get("n") ?? 60)).join("\n"));
      case "GET /pair": {
        const c = pairCode && pairCode.expiresAt > Date.now() && url.searchParams.get("new") == null ? pairCode : newPairCode();
        const payload = `co2lab://pair?hub=${encodeURIComponent(hubUrl(req))}&code=${c.code}`;
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(`<!doctype html><meta name=viewport content="width=device-width"><title>Pair</title>
<body style="font-family:system-ui;margin:16px"><h2>Pair a device</h2>
<p>Hub: <b>${hubUrl(req)}</b></p><p style="font-size:40px;letter-spacing:6px"><b>${c.code}</b></p>
<div id=q></div><p><a href="${payload}">${payload}</a></p>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>new QRCode(document.getElementById('q'),{text:${JSON.stringify(payload)},width:256,height:256})</script>`);
      }
      case "POST /api/pair": {
        const body = JSON.parse((await readBody(req)) || "{}");
        log("pair request", JSON.stringify(body));
        if (!pairCode || pairCode.expiresAt < Date.now()) return json(res, 400, { error: "code_expired" });
        if (pairCode.attempts >= 5) return json(res, 400, { error: "too_many_attempts" });
        if (body.code !== pairCode.code) {
          pairCode.attempts++;
          return json(res, 400, { error: "code_invalid" });
        }
        if (!body.name || body.kind !== "android" || !Array.isArray(body.capabilities) || body.capabilities.length === 0)
          return json(res, 400, { error: "bad_request" });
        pairCode = null;
        const token = crypto.randomBytes(32).toString("base64url");
        const deviceId = "dev-" + crypto.randomBytes(4).toString("hex");
        devices.set(sha(token), { deviceId, name: body.name, capabilities: body.capabilities });
        saveDevices();
        log("paired", deviceId, body.name, body.capabilities.join(","));
        return json(res, 200, { deviceId, token });
      }
      case "POST /assign": {
        const body = JSON.parse((await readBody(req)) || "{}");
        if (!phone?.device) return json(res, 503, { ok: false, error: "no paired device connected" });
        const subtaskId = "st-" + crypto.randomBytes(3).toString("hex");
        const capability = body.capability ?? "app:settings";
        subtasks.set(subtaskId, { capability, status: "running", error: null, images: [], startedAt: Date.now() });
        if (Array.isArray(body.proxyScript)) proxyScripts.set(subtaskId, [...body.proxyScript]);
        const msg = {
          type: "subtask.assign",
          subtaskId,
          runId: "run-test",
          capability,
          goal: body.goal ?? `Collect all current offers in the ${capability.slice(4)} app`,
          config: { model: "flash", screenshotScale: body.scale ?? 0.5, mode: body.mode ?? "recipe" },
        };
        phone.send(JSON.stringify(msg));
        log("assigned", subtaskId, capability, msg.config.mode);
        return json(res, 200, { ok: true, subtaskId });
      }
      case "POST /cancel": {
        const body = JSON.parse((await readBody(req)) || "{}");
        phone?.send(JSON.stringify({ type: "subtask.cancel", subtaskId: body.subtaskId }));
        const st = subtasks.get(body.subtaskId);
        if (st) st.status = "cancelled";
        log("cancel", body.subtaskId);
        return json(res, 200, { ok: true });
      }
      case "GET /proxy":
        return json(res, 200, proxyQueue);
      case "POST /proxy": {
        const body = JSON.parse((await readBody(req)) || "{}");
        const i = body.requestId ? proxyQueue.findIndex((p) => p.requestId === body.requestId) : 0;
        const p = proxyQueue[i];
        if (!p) return json(res, 404, { ok: false, error: "no pending proxy request" });
        proxyQueue.splice(i, 1);
        phone?.send(JSON.stringify({ type: "proxy.action", requestId: p.requestId, action: body.action }));
        log("proxy.action", p.requestId, JSON.stringify(body.action));
        return json(res, 200, { ok: true });
      }
      case "POST /cmd": {
        const body = JSON.parse((await readBody(req)) || "{}");
        if (!phone) return json(res, 503, { ok: false, error: "phone not connected" });
        const id = String(nextId++);
        const reply = await new Promise((resolve) => {
          const timer = setTimeout(() => {
            pending.delete(id);
            resolve({ ok: false, error: "timeout waiting for phone (is 'Allow probe commands' on?)" });
          }, Number(body.timeoutMs ?? 15000));
          pending.set(id, (r) => {
            clearTimeout(timer);
            resolve(r);
          });
          phone.send(JSON.stringify({ type: "probe.cmd", id, cmd: body.cmd, args: body.args ?? {} }));
        });
        if (reply.data?.jpegBase64) {
          const file = path.join(OUT, `${body.name ?? "shot-" + id}.jpg`);
          fs.writeFileSync(file, Buffer.from(reply.data.jpegBase64, "base64"));
          reply.data.jpegBase64 = undefined;
          reply.data.savedTo = file;
        }
        log("cmd", body.cmd, JSON.stringify(body.args ?? {}).slice(0, 200), "->", reply.ok ? "ok" : `FAIL ${reply.error}`);
        return json(res, 200, reply);
      }
      case "GET /": {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(`<!doctype html><meta name=viewport content="width=device-width">
<title>Co2lab probe</title><body style="font-family:system-ui;margin:16px">
<h2>Co2lab probe / fake hub</h2><p><a href="/apk">Download the agent APK</a> · <a href="/pair">Pair code</a></p>
<img id=f style="max-width:320px;border:1px solid #ccc;float:right"><pre id=s>loading…</pre><pre id=e></pre>
<script>setInterval(async()=>{const s=await (await fetch('/status')).json();document.getElementById('s').textContent=JSON.stringify(s,null,2);
document.getElementById('e').textContent=await (await fetch('/events?n=25')).text();
if(s.frameAt)document.getElementById('f').src='/frame.jpg?'+s.frameAt},1000)</script>`);
      }
    }
    send(res, 404, "not found");
  } catch (e) {
    log("http error", e.message);
    json(res, 500, { error: e.message });
  }
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws, req) => {
  log("socket opened from", req.headers["x-forwarded-for"] ?? req.socket.remoteAddress);
  let authed = false;
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!authed && msg.type !== "hello") return ws.close(4001, "hello first");
    switch (msg.type) {
      case "hello": {
        const dev = devices.get(sha(msg.token ?? ""));
        if (msg.role !== "device" || !dev) {
          log("hello rejected (unknown token)");
          return ws.close(4001, "unknown token");
        }
        authed = true;
        phone = ws;
        ws.device = dev;
        lastHello = { role: msg.role, deviceId: dev.deviceId, at: Date.now() };
        ws.send(JSON.stringify({ type: "hello.ok", deviceId: dev.deviceId, name: dev.name }));
        log("hello.ok", dev.deviceId, dev.name);
        // Like the real hub: cancel subtasks the device no longer owns is done on heartbeat below.
        break;
      }
      case "heartbeat": {
        lastHeartbeat = { ...msg.telemetry, runningSubtaskIds: msg.runningSubtaskIds, at: Date.now() };
        for (const id of msg.runningSubtaskIds ?? []) {
          const st = subtasks.get(id);
          if (!st || st.status !== "running") {
            ws.send(JSON.stringify({ type: "subtask.cancel", subtaskId: id }));
            log("stale subtask, sent cancel", id);
          }
        }
        break;
      }
      case "frame":
        lastFrame = { jpegBase64: msg.jpegBase64, subtaskId: msg.subtaskId, at: Date.now() };
        break;
      case "step":
        log("step", msg.subtaskId, `[${msg.kind}]`, msg.text, msg.progress != null ? `(${Math.round(msg.progress * 100)}%)` : "");
        break;
      case "subtask.result": {
        const st = subtasks.get(msg.subtaskId);
        const images = msg.evidence?.images ?? [];
        images.forEach((b64, i) => fs.writeFileSync(path.join(OUT, `${msg.subtaskId}-${i + 1}.jpg`), Buffer.from(b64, "base64")));
        if (msg.evidence?.text) fs.writeFileSync(path.join(OUT, `${msg.subtaskId}.txt`), msg.evidence.text);
        if (st) Object.assign(st, { status: "done", images, finishedAt: Date.now() });
        log("RESULT", msg.subtaskId, `${images.length} images, ${msg.evidence?.text?.length ?? 0} chars text -> out/${msg.subtaskId}-*.jpg`);
        break;
      }
      case "subtask.failed": {
        const st = subtasks.get(msg.subtaskId);
        if (st) Object.assign(st, { status: "failed", error: msg.reason, finishedAt: Date.now() });
        log("FAILED", msg.subtaskId, msg.reason);
        break;
      }
      case "proxy.request": {
        const file = path.join(OUT, `${msg.requestId}.jpg`);
        fs.writeFileSync(file, Buffer.from(msg.screenshot, "base64"));
        fs.writeFileSync(path.join(OUT, `${msg.requestId}.nodes.json`), JSON.stringify(msg.nodes, null, 1));
        log("proxy.request", msg.requestId, `goal="${msg.goal}"`, `${msg.nodes.length} nodes`, `history=${JSON.stringify(msg.history)}`);
        const script = proxyScripts.get(msg.subtaskId);
        if (script?.length) {
          const action = script.shift();
          ws.send(JSON.stringify({ type: "proxy.action", requestId: msg.requestId, action }));
          log("proxy.action (script)", msg.requestId, JSON.stringify(action));
        } else {
          proxyQueue.push({ requestId: msg.requestId, subtaskId: msg.subtaskId, goal: msg.goal, history: msg.history, screenshot: file, nodes: msg.nodes.map((n) => `${n.id} ${n.text ?? ""} ${n.desc ?? ""}${n.clickable ? " [c]" : ""}`) });
        }
        break;
      }
      case "probe.reply":
        pending.get(msg.id)?.(msg);
        pending.delete(msg.id);
        break;
    }
  });
  ws.on("close", (code) => {
    if (phone === ws) phone = null;
    log("socket closed", code);
  });
});

server.listen(PORT, () => log(`probe / fake hub on http://localhost:${PORT}`));

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });
}
function json(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}
function send(res, code, text) {
  res.writeHead(code, { "content-type": "text/plain" });
  res.end(text);
}
