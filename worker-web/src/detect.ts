// Auto-detects what this computer is, for pairing: kind (laptop or desktop), a default name,
// and the DeviceInfo the owner sees before approving it.

import { hostname } from "node:os";
import si from "systeminformation";
import type { DeviceInfo } from "@co2lab/shared";
import { findBrowser } from "./browser.js";

const PORTABLE_CHASSIS = /notebook|laptop|portable|sub ?notebook|hand ?held|tablet|convertible|detachable/i;
/** Windows' and OEM placeholder hostnames say nothing about the machine. */
const GENERIC_HOSTNAME = /^(desktop|laptop|win|pc|user-pc|localhost)(-[a-z0-9]{4,})?$/i;
/** Placeholder strings that firmware puts in the model fields. */
const JUNK = /to be filled|system product name|system manufacturer|default string|not applicable|^none$|^n\/a$|^x\.x$|^0+$|^$/i;

export interface Detected {
  name: string;
  kind: "laptop" | "desktop";
  capabilities: string[];
  info: DeviceInfo;
}

export async function detectDevice(): Promise<Detected> {
  const [sys, chassis, os, cpu, mem, battery, browser] = await Promise.all([
    si.system().catch(() => null),
    si.chassis().catch(() => null),
    si.osInfo().catch(() => null),
    si.cpu().catch(() => null),
    si.mem().catch(() => null),
    si.battery().catch(() => null),
    findBrowser(),
  ]);

  const hasBattery = !!battery?.hasBattery;
  const kind = hasBattery || PORTABLE_CHASSIS.test(chassis?.type ?? "") ? "laptop" : "desktop";
  const model = modelName(sys);
  const host = hostname();
  const name = (GENERIC_HOSTNAME.test(host) && model ? model : host).slice(0, 60);

  const info: DeviceInfo = {
    hostname: host.slice(0, 100),
    os: os ? [os.distro, os.release && !os.distro.includes(os.release) ? os.release : ""].filter(Boolean).join(" ").slice(0, 100) : process.platform,
    arch: (os?.arch ?? process.arch).slice(0, 20),
    model,
    cpu: cpu ? `${clean(`${cpu.manufacturer} ${cpu.brand}`)} (${cpu.cores} threads)`.slice(0, 100) : null,
    ramGb: mem ? Math.round(mem.total / 1024 ** 3) : null,
    hasBattery,
    browser,
  };
  // Without Edge or Chrome the worker downloads Chromium on first start, so it can always do web work.
  return { name, kind, capabilities: ["web"], info };
}

function modelName(sys: si.Systeminformation.SystemData | null): string | null {
  if (!sys) return null;
  const maker = JUNK.test(sys.manufacturer.trim()) ? "" : sys.manufacturer.trim();
  // Lenovo puts the machine type in `model` and the marketing name ("ThinkPad X1 Carbon Gen 9") in `version`.
  const model = /lenovo/i.test(maker) && sys.version && !JUNK.test(sys.version.trim()) ? sys.version.trim() : sys.model.trim();
  if (JUNK.test(model)) return null;
  const short = maker.replace(/,? ?(inc\.?|corporation|corp\.?|co\.,? ltd\.?|ltd\.?)$/i, "").trim();
  const full = model.toLowerCase().startsWith(short.toLowerCase()) ? model : `${short} ${model}`;
  return clean(full).slice(0, 100) || null;
}

const clean = (s: string) => s.replace(/\((R|TM)\)|[®™]/gi, "").replace(/\s+/g, " ").trim();
