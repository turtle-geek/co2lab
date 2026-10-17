// Probe server: checks the Android agent on a real phone before the real hub exists.
//   GET  /            status page (latest heartbeat + latest frame)
//   GET  /apk         download the debug APK
//   POST /cmd         {"cmd": "...", "args": {...}} -> waits for the phone's probe.reply
//   WS   /ws          the phone connects here
// Run: node server.mjs   (port 8790), expose with: cloudflared tunnel --url http://localhost:8790

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
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

function log(...a) {
  console.log(new Date().toISOString().slice(11, 19), ...a);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/apk") {
    if (!fs.existsSync(APK)) return send(res, 404, "APK not built yet");
    res.writeHead(200, {
      "content-type": "application/vnd.android.package-archive",
      "content-disposition": 'attachment; filename="co2lab-probe.apk"',
    });
    return fs.createReadStream(APK).pipe(res);
  }
  if (req.method === "GET" && req.url === "/frame.jpg") {
    if (!lastFrame) return send(res, 404, "no frame yet");
    res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" });
    return res.end(Buffer.from(lastFrame.jpegBase64, "base64"));
  }
  if (req.method === "GET" && req.url === "/status") {
    return json(res, 200, { connected: !!phone, hello: lastHello, heartbeat: lastHeartbeat, frameAt: lastFrame?.at ?? null });
  }
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(`<!doctype html><meta name=viewport content="width=device-width">
<title>Co2lab probe</title><body style="font-family:system-ui;margin:16px">
<h2>Co2lab probe</h2><p><a href="/apk">Download the agent APK</a></p>
<pre id=s>loading…</pre><img id=f style="max-width:320px;border:1px solid #ccc">
<script>setInterval(async()=>{const s=await (await fetch('/status')).json();document.getElementById('s').textContent=JSON.stringify(s,null,2);
if(s.frameAt)document.getElementById('f').src='/frame.jpg?'+s.frameAt},1000)</script>`);
  }
  if (req.method === "POST" && req.url === "/cmd") {
    const body = JSON.parse((await readBody(req)) || "{}");
    if (!phone) return json(res, 503, { ok: false, error: "phone not connected" });
    const id = String(nextId++);
    const reply = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, error: "timeout waiting for phone" });
      }, Number(body.timeoutMs ?? 15000));
      pending.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      phone.send(JSON.stringify({ type: "probe.cmd", id, cmd: body.cmd, args: body.args ?? {} }));
    });
    // Save screenshots to disk so they can be inspected, and keep responses small.
    if (reply.data?.jpegBase64) {
      const file = path.join(OUT, `${body.name ?? "shot-" + id}.jpg`);
      fs.writeFileSync(file, Buffer.from(reply.data.jpegBase64, "base64"));
      reply.data.jpegBase64 = undefined;
      reply.data.savedTo = file;
    }
    log("cmd", body.cmd, JSON.stringify(body.args ?? {}), "->", reply.ok ? "ok" : `FAIL ${reply.error}`);
    return json(res, 200, reply);
  }
  send(res, 404, "not found");
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws, req) => {
  log("socket opened from", req.headers["x-forwarded-for"] ?? req.socket.remoteAddress);
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    switch (msg.type) {
      case "hello":
        phone = ws;
        lastHello = { role: msg.role, at: Date.now() };
        ws.send(JSON.stringify({ type: "hello.ok", deviceId: "probe-device", name: "Galaxy A54 (probe)" }));
        log("hello from", msg.role);
        break;
      case "heartbeat":
        lastHeartbeat = { ...msg.telemetry, at: Date.now() };
        break;
      case "frame":
        lastFrame = { jpegBase64: msg.jpegBase64, at: Date.now() };
        break;
      case "probe.reply":
        pending.get(msg.id)?.(msg);
        pending.delete(msg.id);
        break;
    }
  });
  ws.on("close", () => {
    if (phone === ws) phone = null;
    log("socket closed");
  });
});

server.listen(PORT, () => log(`probe server on http://localhost:${PORT}`));

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
