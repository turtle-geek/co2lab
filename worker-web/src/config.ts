// Command-line flags, root .env, and the saved device file.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

export const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: resolve(PKG_DIR, "..", ".env"), quiet: true });

/** Tiny flag parser: `--name X`, `--cloud`, positional args. */
export function parseArgs(argv = process.argv.slice(2)) {
  const flags: Record<string, string | true> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const [key, inline] = a.slice(2).split("=", 2) as [string, string | undefined];
      const next = argv[i + 1];
      if (inline !== undefined) flags[key] = inline;
      else if (next !== undefined && !next.startsWith("--") && !BOOLEAN_FLAGS.has(key)) flags[key] = argv[++i]!;
      else flags[key] = true;
    } else positional.push(a);
  }
  const str = (k: string) => (typeof flags[k] === "string" ? (flags[k] as string) : undefined);
  return { flags, positional, str, has: (k: string) => flags[k] !== undefined };
}
const BOOLEAN_FLAGS = new Set(["cloud", "headless", "headed", "evidence-images"]);

export const DeviceFile = z.object({
  hubUrl: z.string().url(),
  deviceId: z.string(),
  token: z.string(),
  name: z.string(),
  kind: z.enum(["laptop", "cloud"]),
});
export type DeviceFile = z.infer<typeof DeviceFile>;

export function deviceFilePath(override?: string): string {
  return resolve(PKG_DIR, override ?? process.env.WORKER_DEVICE_FILE ?? ".device.json");
}

export function readDeviceFile(path: string): DeviceFile {
  if (!existsSync(path)) {
    throw new Error(`No device file at ${path}. Pair first: npm run pair -- <6-digit code>`);
  }
  return DeviceFile.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function writeDeviceFile(path: string, data: DeviceFile): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
}

export function hubUrlFromEnv(override?: string): string {
  const url = override ?? process.env.WORKER_HUB_URL ?? process.env.HUB_PUBLIC_URL;
  if (!url) throw new Error("Set WORKER_HUB_URL in the root .env (or pass --hub <url>)");
  return url.replace(/\/+$/, "");
}

export function log(...args: unknown[]): void {
  console.log(new Date().toISOString().slice(11, 19), ...args);
}
