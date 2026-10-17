// Loads the root .env (one level above hub/) and exposes typed settings.

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HUB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ROOT_DIR = resolve(HUB_DIR, "..");

const envPath = resolve(ROOT_DIR, ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

function str(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v.trim() === "" ? fallback : v.trim();
}

const port = Number(str("HUB_PORT", "8787"));

export const config = {
  port,
  host: str("HUB_HOST", "0.0.0.0"),
  publicUrl: str("HUB_PUBLIC_URL", `http://localhost:${port}`).replace(/\/+$/, ""),
  ownerPassphrase: str("OWNER_PASSPHRASE"),
  sessionSecret: str("SESSION_SECRET"),
  gemini: {
    apiKey: str("GEMINI_API_KEY"),
    models: {
      lite: str("GEMINI_MODEL_LITE"),
      flash: str("GEMINI_MODEL_FLASH"),
      pro: str("GEMINI_MODEL_PRO"),
    },
  },
  dashboardDist: resolve(ROOT_DIR, "dashboard", "dist"),
  /** install.ps1 / install.sh templates and the prebuilt worker bundle (`npm run bundle -w worker-web`). */
  installDir: resolve(ROOT_DIR, "worker-web", "install"),
  workerBundle: resolve(ROOT_DIR, "worker-web", "dist", "co2lab-worker.tgz"),
  dataDir: resolve(HUB_DIR, "data"),
  envPath,
  envLoaded: existsSync(envPath),
};

export function checkConfig(): string[] {
  const problems: string[] = [];
  if (!config.ownerPassphrase || config.ownerPassphrase === "change-me")
    problems.push("OWNER_PASSPHRASE is not set (or still 'change-me'); owner login is disabled until it is.");
  if (config.sessionSecret.length < 32) problems.push("SESSION_SECRET must be 32+ characters; owner login is disabled until it is.");
  if (!config.gemini.apiKey) problems.push("GEMINI_API_KEY is not set; runs will fail with that reason.");
  return problems;
}

export const ownerLoginEnabled = () =>
  !!config.ownerPassphrase && config.ownerPassphrase !== "change-me" && config.sessionSecret.length >= 32;
