// Two ways for a computer to get a device token:
//   device code (default): ask the hub for a code, show it with the approve link and a QR,
//                          and poll until the owner approves this computer in the dashboard
//   6-digit code (legacy): redeem a code from the dashboard's Android pairing screen

import QRCode from "qrcode";
import { DeviceCodePollResponse, DeviceCodeStartResponse, PairRequest, PairResponse } from "@co2lab/shared";
import { writeDeviceFile, log, type DeviceFile } from "./config.js";
import { detectDevice, type Detected } from "./detect.js";

export interface PairOptions {
  hubUrl: string;
  deviceFile: string;
  cloud: boolean;
  /** --name overrides the detected name (the owner can still rename on approval). */
  name?: string;
}

async function post(hubUrl: string, path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  let res: Response;
  try {
    res = await fetch(`${hubUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new Error(`Could not reach the hub at ${hubUrl}: ${(err as Error).message}`);
  }
  return { status: res.status, json: await res.json().catch(() => null) };
}

const errorOf = (json: unknown, status: number) => (json as { error?: string } | null)?.error ?? `HTTP ${status}`;

type Me = Omit<Detected, "kind"> & { kind: DeviceFile["kind"] };

async function detect(opts: PairOptions): Promise<Me> {
  log("Detecting this computer ...");
  const d = await detectDevice();
  const kind = opts.cloud ? "cloud" : d.kind;
  const name = opts.name ?? (opts.cloud ? "Cloud worker" : d.name);
  const i = d.info;
  log(`  ${name} · ${kind} · ${i.os} · ${i.model ?? "unknown model"}`);
  log(`  ${i.cpu ?? "unknown CPU"} · ${i.ramGb ?? "?"} GB RAM · battery: ${i.hasBattery ? "yes" : "no"}`);
  log(`  browser: ${i.browser ?? "none found (Chromium will be downloaded on first start)"}`);
  return { ...d, name, kind };
}

/** Device-code flow. Resolves once the owner approves; asks for a new code when one expires. */
export async function pairWithDeviceCode(opts: PairOptions): Promise<DeviceFile> {
  const d = await detect(opts);
  for (;;) {
    const start = await post(opts.hubUrl, "/api/device-code", { name: d.name, kind: d.kind, capabilities: d.capabilities, info: d.info });
    if (start.status !== 200) throw new Error(`The hub refused the pairing request: ${errorOf(start.json, start.status)}`);
    const code = DeviceCodeStartResponse.parse(start.json);

    const qr = await QRCode.toString(code.verificationUrlComplete, { type: "terminal", small: true, errorCorrectionLevel: "L" });
    console.log("");
    console.log(qr);
    console.log(`  To add this computer to CO2LAB, open:\n\n    ${code.verificationUrlComplete}\n`);
    console.log(`  and check that the code matches:   ${code.userCode}\n`);
    console.log(`  (or open ${code.verificationUrl} and type the code). It expires in ${Math.round((code.expiresAt - Date.now()) / 60_000)} minutes.\n`);
    log("Waiting for the owner to approve ...");

    let intervalMs = code.intervalS * 1000;
    for (;;) {
      await new Promise((r) => setTimeout(r, intervalMs));
      let poll: { status: number; json: unknown };
      try {
        poll = await post(opts.hubUrl, "/api/device-code/poll", { deviceCode: code.deviceCode });
      } catch (e) {
        log(`${(e as Error).message}; retrying`);
        continue;
      }
      if (poll.status === 404) break; // the hub restarted and forgot the code: get a new one
      if (poll.status !== 200) throw new Error(`Pairing failed: ${errorOf(poll.json, poll.status)}`);
      const r = DeviceCodePollResponse.parse(poll.json);
      if (r.status === "pending") continue;
      if (r.status === "slow_down") {
        intervalMs += 2000;
        continue;
      }
      if (r.status === "denied") throw new Error("The owner denied this computer.");
      if (r.status === "expired") {
        log("The code expired. Getting a new one ...");
        break;
      }
      const file: DeviceFile = { hubUrl: opts.hubUrl, deviceId: r.deviceId, token: r.token, name: r.name, kind: d.kind };
      writeDeviceFile(opts.deviceFile, file);
      log(`Approved as "${r.name}" (${r.deviceId}). Saved the token to ${opts.deviceFile}`);
      return file;
    }
  }
}

/** Legacy flow with a 6-digit code from the dashboard. */
export async function pairWithCode(code: string, opts: PairOptions): Promise<DeviceFile> {
  const d = await detect(opts);
  const body = PairRequest.parse({ code, name: d.name, kind: d.kind, capabilities: d.capabilities });
  log(`Pairing "${body.name}" (${body.kind}) with ${opts.hubUrl} ...`);
  const res = await post(opts.hubUrl, "/api/pair", body);
  if (res.status !== 200) throw new Error(`Pairing failed: ${errorOf(res.json, res.status)}`);
  const { deviceId, token } = PairResponse.parse(res.json);
  const file: DeviceFile = { hubUrl: opts.hubUrl, deviceId, token, name: body.name, kind: d.kind };
  writeDeviceFile(opts.deviceFile, file);
  log(`Paired as ${deviceId}. Saved the token to ${opts.deviceFile}`);
  return file;
}
