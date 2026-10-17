// Co2lab hub entry point: Fastify HTTP + ws WebSocket on one port.

import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import { DeviceCodePollRequest, DeviceCodeStartRequest, LoginRequest, PairRequest, WS_PATH } from "@co2lab/shared";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { checkConfig, config, ownerLoginEnabled } from "./config.js";
import { SESSION_COOKIE, SESSION_TTL_MS, makeSessionValue, parseCookies, safeEqual, verifySessionValue } from "./crypto.js";
import { geminiProblem } from "./gemini.js";
import { Hub, MAX_WS_PAYLOAD } from "./hub.js";
import { log } from "./log.js";
import { createRepository } from "./repo/index.js";

const startedAt = Date.now();
const repo = await createRepository();
const hub = new Hub(repo);
await hub.start();

const app = Fastify({ logger: false, bodyLimit: MAX_WS_PAYLOAD, trustProxy: true });

const secureCookie = config.publicUrl.startsWith("https://");
function sessionCookie(value: string, maxAgeS: number) {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${secureCookie ? "; Secure" : ""}`;
}
const isOwner = (req: FastifyRequest) => verifySessionValue(parseCookies(req.headers.cookie)[SESSION_COOKIE]);

// ---------- Auth ----------

app.post("/api/login", async (req, reply) => {
  if (!ownerLoginEnabled()) return reply.code(503).send({ error: "login_not_configured" });
  const body = LoginRequest.safeParse(req.body);
  if (!body.success || !safeEqual(body.data.passphrase, config.ownerPassphrase)) {
    await new Promise((r) => setTimeout(r, 500)); // slow down guessing
    return reply.code(401).send({ error: "wrong_passphrase" });
  }
  reply.header("set-cookie", sessionCookie(makeSessionValue(), Math.floor(SESSION_TTL_MS / 1000)));
  return reply.code(204).send();
});

app.post("/api/logout", async (_req, reply) => {
  reply.header("set-cookie", sessionCookie("", 0));
  return reply.code(204).send();
});

/** Lets the dashboard know whether to show the login screen. */
app.get("/api/session", async (req) => ({ owner: isOwner(req) }));

// ---------- Pairing ----------

app.post("/api/pair", async (req, reply) => {
  const body = PairRequest.safeParse(req.body);
  if (!body.success) return reply.code(400).send({ error: "bad_request", detail: body.error.issues[0]?.message });
  const r = await hub.pairDevice(body.data);
  if (!r.ok) return reply.code(400).send({ error: r.error });
  return { deviceId: r.deviceId, token: r.token };
});

// ---------- Device-code pairing (computers; see shared/PROTOCOL.md) ----------

app.post("/api/device-code", async (req, reply) => {
  const body = DeviceCodeStartRequest.safeParse(req.body);
  if (!body.success) return reply.code(400).send({ error: "bad_request", detail: body.error.issues[0]?.message });
  const r = hub.startDeviceCode(body.data, req.ip ?? null);
  if (!r.ok) return reply.code(429).send({ error: r.error });
  const verificationUrl = `${config.publicUrl}/approve`;
  return {
    deviceCode: r.deviceCode,
    userCode: r.userCode,
    verificationUrl,
    verificationUrlComplete: `${verificationUrl}?code=${r.userCode}`,
    expiresAt: r.expiresAt,
    intervalS: r.intervalS,
  };
});

app.post("/api/device-code/poll", async (req, reply) => {
  const body = DeviceCodePollRequest.safeParse(req.body);
  if (!body.success) return reply.code(400).send({ error: "bad_request" });
  const r = hub.deviceCodes.poll(body.data.deviceCode);
  if (!r) return reply.code(404).send({ error: "unknown_code" });
  return r;
});

// ---------- One-line installer for computers ----------
// irm https://<hub>/install.ps1 | iex   (Windows)   curl -fsSL https://<hub>/install.sh | sh   (macOS, Linux)

async function sendInstaller(reply: FastifyReply, file: string, type: string) {
  try {
    const text = (await readFile(join(config.installDir, file), "utf8")).replaceAll("__HUB_URL__", config.publicUrl);
    return reply.type(type).header("cache-control", "no-store").send(text);
  } catch {
    return reply.code(404).send({ error: "installer_missing" });
  }
}
app.get("/install.ps1", async (_req, reply) => sendInstaller(reply, "install.ps1", "text/plain; charset=utf-8"));
app.get("/install.sh", async (_req, reply) => sendInstaller(reply, "install.sh", "text/x-shellscript; charset=utf-8"));
app.get("/install/worker.tgz", async (_req, reply) => {
  if (!existsSync(config.workerBundle))
    return reply.code(404).type("text/plain").send("The worker bundle is not built. On the hub run: npm run bundle -w worker-web\n");
  return reply
    .type("application/gzip")
    .header("cache-control", "no-store")
    .header("content-disposition", 'attachment; filename="co2lab-worker.tgz"')
    .send(createReadStream(config.workerBundle));
});

// ---------- Health ----------

app.get("/api/health", async () => ({
  ok: true,
  uptimeS: Math.round((Date.now() - startedAt) / 1000),
  repo: repo.kind,
  gemini: geminiProblem() ?? "configured",
  devices: hub.deviceViews().map((d) => ({ name: d.name, kind: d.kind, state: d.state })),
}));

// ---------- Evidence screenshots (deal.screenshotRef = "frames/<file>.jpg") ----------

app.get("/api/evidence/:file", async (req: FastifyRequest<{ Params: { file: string }; Querystring: { viewer?: string } }>, reply) => {
  if (!isOwner(req) && !(await hub.viewerTokenValid(req.query.viewer))) return reply.code(401).send({ error: "unauthorized" });
  const file = req.params.file;
  if (!/^[A-Za-z0-9_-]+\.jpg$/.test(file)) return reply.code(400).send({ error: "bad_name" });
  try {
    const buf = await readFile(join(config.dataDir, "frames", file));
    return reply.type("image/jpeg").header("cache-control", "private, max-age=3600").send(buf);
  } catch {
    return reply.code(404).send({ error: "not_found" });
  }
});

// ---------- Research Mode (Lab tab) ----------

type ViewerQuery = FastifyRequest<{ Querystring: { viewer?: string } }>;
app.get("/api/research", async (req: ViewerQuery, reply) => {
  if (!isOwner(req) && !(await hub.viewerTokenValid(req.query.viewer))) return reply.code(401).send({ error: "unauthorized" });
  return hub.research.state();
});

app.get("/api/research/findings/:id", async (req: FastifyRequest<{ Params: { id: string }; Querystring: { viewer?: string } }>, reply) => {
  if (!isOwner(req) && !(await hub.viewerTokenValid(req.query.viewer))) return reply.code(401).send({ error: "unauthorized" });
  const id = req.params.id.replace(/\.md$/, "");
  const md = hub.research.findingMarkdown(id);
  if (md === null) return reply.code(404).send({ error: "not_found" });
  return reply.type("text/markdown; charset=utf-8").header("content-disposition", `attachment; filename="finding-${id}.md"`).send(md);
});

// ---------- Dashboard ----------

const hasDashboard = existsSync(join(config.dashboardDist, "index.html"));
if (hasDashboard) {
  await app.register(fastifyStatic, { root: config.dashboardDist, wildcard: false });
  app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split("?")[0] ?? "/";
    if (req.method !== "GET" || path.startsWith("/api") || path === WS_PATH) return reply.code(404).send({ error: "not_found" });
    return reply.sendFile("index.html");
  });
} else {
  app.get("/", async (_req, reply) =>
    reply
      .type("text/plain")
      .send("Co2lab hub is running. The dashboard is not built yet: run `npm run build -w dashboard`, then restart the hub.\n"),
  );
}

// ---------- WebSocket ----------

app.server.on("upgrade", (req, socket, head) => {
  const path = (req.url ?? "").split("?")[0];
  if (path !== WS_PATH) {
    socket.destroy();
    return;
  }
  hub.handleUpgrade(req, socket, head);
});

await app.listen({ port: config.port, host: config.host });
log.info(`hub listening on http://${config.host}:${config.port} (public ${config.publicUrl}), ws ${WS_PATH}`);
log.info(`repo: ${repo.kind}; dashboard: ${hasDashboard ? config.dashboardDist : "not built"}; env: ${config.envLoaded ? config.envPath : "no .env found"}`);
for (const p of checkConfig()) log.warn(p);

const shutdown = async () => {
  hub.stop();
  await app.close();
  await repo.close?.().catch((e) => log.error("repo close", e));
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
