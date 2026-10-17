// Picks the browser Playwright drives: the system Edge or Chrome first (nothing to download),
// then Playwright's own Chromium, which is downloaded once if it is missing.
// WORKER_BROWSER=msedge|chrome|chromium forces one.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { chromium, type Browser, type LaunchOptions } from "playwright";
import { log } from "./config.js";

interface Candidate {
  channel: "msedge" | "chrome" | undefined;
  label: string;
}

const ALL: Record<string, Candidate> = {
  msedge: { channel: "msedge", label: "Microsoft Edge" },
  chrome: { channel: "chrome", label: "Google Chrome" },
  chromium: { channel: undefined, label: "Chromium (Playwright)" },
};

function candidates(): Candidate[] {
  const forced = process.env.WORKER_BROWSER?.trim().toLowerCase();
  if (forced && ALL[forced]) return [ALL[forced]!];
  return [ALL.msedge!, ALL.chrome!, ALL.chromium!];
}

const missingExecutable = (e: unknown) => /Executable doesn't exist|is not found at|not found|Chromium distribution .* is not found/i.test(String(e));

/** Launches the first browser that works. Downloads Chromium only if no system browser launches. */
export async function launchBrowser(opts: LaunchOptions): Promise<{ browser: Browser; label: string }> {
  const errors: string[] = [];
  for (const c of candidates()) {
    try {
      return { browser: await chromium.launch({ ...opts, channel: c.channel }), label: c.label };
    } catch (e) {
      errors.push(`${c.label}: ${firstLine(e)}`);
      if (c.channel === undefined && missingExecutable(e)) {
        log("No Edge or Chrome found; downloading Playwright Chromium (one time, about 150 MB) ...");
        await installChromium();
        return { browser: await chromium.launch(opts), label: c.label };
      }
    }
  }
  throw new Error(`No browser could be started:\n  ${errors.join("\n  ")}`);
}

/** Finds a usable browser without downloading anything (for pairing and the approval screen). */
export async function findBrowser(): Promise<string | null> {
  for (const c of candidates()) {
    try {
      const b = await chromium.launch({ headless: true, channel: c.channel, timeout: 20_000 });
      await b.close();
      return c.label;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

/** Runs `playwright install chromium` with the same playwright-core the worker uses. */
export function installChromium(): Promise<void> {
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve("playwright-core/package.json")), "cli.js");
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" });
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`playwright install chromium exited with ${code}`))));
  });
}

function firstLine(e: unknown): string {
  return String(e instanceof Error ? e.message : e).split("\n")[0]!.slice(0, 160);
}
