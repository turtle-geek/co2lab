// Dev-only stand-in for the hub, to test the worker alone.
//   npm run fake-hub -- [--port 8799] [--cancel-after 8000] [--capability web] [--goal "..."]
// Accepts pairing code 123456, assigns one subtask after the first heartbeat, validates
// every message against the shared zod schemas, and prints a pass/fail summary.

import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { DeviceToHub, Evidence, PairRequest, WS_PATH, type HubToDevice } from "@co2lab/shared";
import { parseArgs, PKG_DIR, log } from "../config.js";

const args = parseArgs();
const port = Number(args.str("port") ?? 8799);
const cancelAfter = args.str("cancel-after") ? Number(args.str("cancel-after")) : null;
const capability = args.str("capability") ?? "web";
const goal = args.str("goal") ?? "Find current food and restaurant deals on RedFlagDeals usable near UTSC (Scarborough) today";
const CODE = "123456";
const outDir = resolve(PKG_DIR, "out");
mkdirSync(outDir, { recursive: true });

const devices = new Map<string, { id: string; name: string; kind: string }>();
const stats = { heartbeats: 0, frames: 0, steps: 0, invalid: 0, afterCancel: 0, maxFrameWidth: 0 };
const subtaskId = `sub-${randomUUID().slice(0, 8)}`;
let cancelledAt: number | null = null;
let finished = false;

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/pair") {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const parsed = PairRequest.safeParse(JSON.parse(body || "null"));
      const reply = (status: number, json: unknown) => {
        res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(json));
      };
      if (!parsed.success) return reply(400, { error: "bad_request" });
      if (parsed.data.code !== CODE) return reply(400, { error: "code_invalid" });
      const id = `dev-${randomUUID().slice(0, 8)}`;
      const token = `tok-${randomUUID()}`;
      devices.set(token, { id, name: parsed.data.name, kind: parsed.data.kind });
      log(`paired ${parsed.data.name} (${parsed.data.kind}, ${parsed.data.capabilities.join(",")}) as ${id}`);
      reply(200, { deviceId: id, token });
    });
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server, path: WS_PATH });
wss.on("connection", (ws) => {
  let device: { id: string; name: string } | null = null;
  let assigned = false;
  const send = (m: HubToDevice) => ws.send(JSON.stringify(m));

  ws.on("message", (data) => {
    const parsed = DeviceToHub.safeParse(JSON.parse(data.toString()));
    if (!parsed.success) {
      stats.invalid++;
      log("INVALID message:", parsed.error.issues.slice(0, 3), data.toString().slice(0, 200));
      return;
    }
    const msg = parsed.data;
    if (!device) {
      // Device tokens survive fake-hub restarts only if --any-token is passed.
      const d = msg.type === "hello" && msg.token ? (devices.get(msg.token) ?? (args.has("any-token") ? { id: "dev-any", name: "any" } : null)) : null;
      if (!d) return ws.close(4001, "bad hello");
      device = d;
      send({ type: "hello.ok", deviceId: d.id, name: d.name });
      return;
    }
    if ("subtaskId" in msg && msg.subtaskId === subtaskId && cancelledAt !== null) {
      stats.afterCancel++;
      log(`VIOLATION: ${msg.type} for cancelled subtask ${Date.now() - cancelledAt} ms after cancel`);
    }
    switch (msg.type) {
      case "heartbeat":
        stats.heartbeats++;
        if (stats.heartbeats === 1 || stats.heartbeats % 5 === 0) log("heartbeat", JSON.stringify(msg.telemetry), msg.runningSubtaskIds);
        if (!assigned) {
          assigned = true;
          log(`assigning ${subtaskId} (${capability})`);
          send({
            type: "subtask.assign",
            subtaskId,
            runId: "run-test",
            capability,
            goal,
            config: { model: "flash", screenshotScale: 0.5, mode: "recipe" },
          });
          if (cancelAfter !== null) {
            setTimeout(() => {
              log(`sending subtask.cancel for ${subtaskId}`);
              cancelledAt = Date.now();
              send({ type: "subtask.cancel", subtaskId });
              setTimeout(() => finish(ws, "cancel"), 8_000);
            }, cancelAfter);
          }
        }
        break;
      case "frame":
        stats.frames++;
        stats.maxFrameWidth = Math.max(stats.maxFrameWidth, msg.width);
        writeFileSync(resolve(outDir, "last-frame.jpg"), Buffer.from(msg.jpegBase64, "base64"));
        if (stats.frames === 1) log(`first frame ${msg.width}x${msg.height}`);
        break;
      case "step":
        stats.steps++;
        log(`step [${msg.kind}] ${msg.progress !== undefined ? `${Math.round(msg.progress * 100)}% ` : ""}${msg.text}`);
        break;
      case "subtask.result": {
        const ev = Evidence.safeParse(msg.evidence);
        log(`RESULT evidence valid=${ev.success} text=${msg.evidence.text?.length ?? 0} chars images=${msg.evidence.images.length}`);
        writeFileSync(resolve(outDir, "evidence.txt"), msg.evidence.text ?? "");
        msg.evidence.images.forEach((img, i) => writeFileSync(resolve(outDir, `evidence-${i}.jpg`), Buffer.from(img, "base64")));
        console.log("----- evidence text (first 1500 chars) -----\n" + (msg.evidence.text ?? "").slice(0, 1500) + "\n-----");
        if (cancelAt() === null) finish(ws, ev.success ? "result" : "invalid-result");
        break;
      }
      case "subtask.failed":
        log(`FAILED: ${msg.reason}`);
        if (cancelAt() === null) finish(ws, "failed");
        break;
      default:
        log("other message", msg.type);
    }
  });
  ws.on("close", (code) => log(`socket closed (${code})`));
});

const cancelAt = () => cancelledAt;

function finish(ws: WebSocket, outcome: string) {
  if (finished) return;
  finished = true;
  log(`SUMMARY outcome=${outcome} ${JSON.stringify(stats)}`);
  if (args.has("stay")) return;
  ws.close(1000);
  setTimeout(() => process.exit(stats.invalid || stats.afterCancel ? 1 : 0), 200);
}

server.listen(port, () => log(`fake hub on http://localhost:${port} (pairing code ${CODE})`));
