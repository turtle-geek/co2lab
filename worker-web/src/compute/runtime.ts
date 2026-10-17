// Loads the model runtime (transformers.js on onnxruntime-node, native CPU) for compute jobs.
// In the repo (laptop dev, Cloud worker) it is a normal dependency. In the installed bundle it is not
// shipped (native binaries, ~300 MB): the first compute job installs it with npm into
// <install>/compute, which the installer never wipes, and models are cached in <install>/compute/models.

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { BUNDLED, PKG_DIR, log } from "../config.js";

export const TRANSFORMERS_VERSION = "4.3.1";
const COMPUTE_DIR = join(PKG_DIR, BUNDLED ? "compute" : "../hub/data/compute-cache");

type Transformers = typeof import("@huggingface/transformers");
let loading: Promise<Transformers> | null = null;

function npmBin(): string {
  // Portable Node and the official installer both put npm next to node.
  const dir = dirname(process.execPath);
  const win = join(dir, "npm.cmd");
  if (process.platform === "win32" && existsSync(win)) return win;
  const unix = join(dir, "npm");
  return existsSync(unix) ? unix : "npm";
}

function installRuntime(): Promise<void> {
  mkdirSync(COMPUTE_DIR, { recursive: true });
  const pkg = join(COMPUTE_DIR, "package.json");
  if (!existsSync(pkg)) writeFileSync(pkg, JSON.stringify({ name: "co2lab-compute", private: true }) + "\n");
  log(`Installing the model runtime (first compute job only, about 300 MB) into ${COMPUTE_DIR} …`);
  return new Promise((resolve, reject) => {
    execFile(
      npmBin(),
      ["install", `@huggingface/transformers@${TRANSFORMERS_VERSION}`, "--no-audit", "--no-fund", "--omit=dev", "--loglevel=error"],
      { cwd: COMPUTE_DIR, shell: process.platform === "win32", timeout: 15 * 60_000, windowsHide: true },
      (err, _out, stderr) => (err ? reject(new Error(`npm install failed: ${String(stderr || err.message).slice(0, 300)}`)) : resolve()),
    );
  });
}

export function loadTransformers(): Promise<Transformers> {
  loading ??= (async () => {
    let mod: Transformers;
    if (!BUNDLED) {
      mod = await import("@huggingface/transformers");
    } else {
      const req = createRequire(join(COMPUTE_DIR, "package.json"));
      let entry: string;
      try {
        entry = req.resolve("@huggingface/transformers");
      } catch {
        await installRuntime();
        entry = req.resolve("@huggingface/transformers");
      }
      mod = (await import(pathToFileURL(entry).href)) as Transformers;
    }
    mod.env.cacheDir = join(COMPUTE_DIR, "models");
    mod.env.allowLocalModels = false;
    log("Model runtime ready");
    return mod;
  })();
  loading.catch(() => (loading = null)); // let a later job try again
  return loading;
}
