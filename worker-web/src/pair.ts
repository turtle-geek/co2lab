// npm run pair -- <code> [--name "Dragonfly"] [--cloud] [--hub <url>] [--device-file <path>]

import { hostname } from "node:os";
import { PairRequest, PairResponse } from "@co2lab/shared";
import { parseArgs, hubUrlFromEnv, deviceFilePath, writeDeviceFile, log } from "./config.js";

const args = parseArgs();
const code = args.positional[0];
if (!code || !/^\d{6}$/.test(code)) {
  console.error("Usage: npm run pair -- <6-digit code> [--name <name>] [--cloud] [--hub <url>]");
  process.exit(2);
}

const cloud = args.has("cloud");
const hubUrl = hubUrlFromEnv(args.str("hub"));
const body = PairRequest.parse({
  code,
  name: args.str("name") ?? (cloud ? "Cloud worker" : hostname()),
  kind: cloud ? "cloud" : "laptop",
  capabilities: ["web"],
});

log(`Pairing "${body.name}" (${body.kind}) with ${hubUrl} ...`);
let res: Response;
try {
  res = await fetch(`${hubUrl}/api/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
} catch (err) {
  console.error(`Could not reach the hub at ${hubUrl}: ${(err as Error).message}`);
  process.exit(1);
}

const json: unknown = await res.json().catch(() => null);
if (!res.ok) {
  const reason = (json as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
  console.error(`Pairing failed: ${reason}`);
  process.exit(1);
}

const { deviceId, token } = PairResponse.parse(json);
const path = deviceFilePath(args.str("device-file"));
writeDeviceFile(path, { hubUrl, deviceId, token, name: body.name, kind: body.kind as "laptop" | "cloud" });
log(`Paired as ${deviceId}. Saved token to ${path}`);
log(cloud ? "Start with: npm start -- --cloud" : "Start with: npm start");
