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

/**
 * npm's own CLI script, run with this Node and no shell (a shell breaks on "C:\Program Files\...").
 * Windows (installer and portable zip): <node dir>/node_modules/npm; Linux/macOS: <prefix>/lib/node_modules/npm.
 */
function npmCommand(): { file: string; args: string[]; shell: boolean } {
  const dir = dirname(process.execPath);
  for (const cli of [join(dir, "node_modules", "npm", "bin", "npm-cli.js"), join(dir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")])
    if (existsSync(cli)) return { file: process.execPath, args: [cli], shell: false };
  return process.platform === "win32" ? { file: "npm.cmd", args: [], shell: true } : { file: "npm", args: [], shell: false };
}

function installRuntime(): Promise<void> {
  mkdirSync(COMPUTE_DIR, { recursive: true });
  const pkg = join(COMPUTE_DIR, "package.json");
  if (!existsSync(pkg)) writeFileSync(pkg, JSON.stringify({ name: "co2lab-compute", private: true }) + "\n");
  log(`Installing the model runtime (first compute job only, about 300 MB) into ${COMPUTE_DIR} …`);
  const npm = npmCommand();
  return new Promise((resolve, reject) => {
    execFile(
      npm.file,
      [...npm.args, "install", `@huggingface/transformers@${TRANSFORMERS_VERSION}`, "--no-audit", "--no-fund", "--omit=dev", "--loglevel=error"],
      { cwd: COMPUTE_DIR, shell: npm.shell, timeout: 15 * 60_000, windowsHide: true },
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
