// npm run bundle -w worker-web
// Builds the prebuilt worker the hub serves at /install/worker.tgz, so a computer can join without git or npm:
//   worker.mjs            the worker and all its JS dependencies in one file (esbuild)
//   node_modules/playwright-core   kept as a real package (it loads its own files at run time)
//   package.json          so Node treats worker.mjs as ESM and the worker finds its install folder
// playwright-core is pure JavaScript, so a bundle built on the Linux hub runs on Windows and macOS too.

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(PKG, "dist", "bundle");
const TGZ = join(PKG, "dist", "co2lab-worker.tgz");
const require = createRequire(join(PKG, "package.json"));
const pkg = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8"));

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

await build({
  entryPoints: [join(PKG, "src", "main.ts")],
  outfile: join(OUT, "worker.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // The worker imports "playwright"; the bundle ships the smaller playwright-core (same API, no test runner).
  alias: { playwright: "playwright-core" },
  // The model runtime (native onnxruntime) is installed on first compute job, see src/compute/runtime.ts.
  external: ["playwright-core", "bufferutil", "utf-8-validate", "osx-temperature-sensor", "@huggingface/transformers"],
  // CommonJS dependencies call require(); give the ESM bundle a real one.
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  legalComments: "none",
  logLevel: "warning",
});

const coreDir = dirname(require.resolve("playwright-core/package.json"));
cpSync(coreDir, join(OUT, "node_modules", "playwright-core"), { recursive: true });
const coreVersion = JSON.parse(readFileSync(join(coreDir, "package.json"), "utf8")).version;

const builtAt = new Date().toISOString();
writeFileSync(
  join(OUT, "package.json"),
  JSON.stringify({ name: "co2lab-worker", version: pkg.version, private: true, type: "module", builtAt, dependencies: { "playwright-core": coreVersion } }, null, 2) + "\n",
);

rmSync(TGZ, { force: true });
// bsdtar (Windows 10+) and GNU tar both read this. Relative paths: GNU tar reads "C:\..." as a remote host.
execFileSync("tar", ["-czf", "../co2lab-worker.tgz", "."], { cwd: OUT, stdio: "inherit" });
console.log(`worker bundle: ${TGZ} (playwright-core ${coreVersion}, built ${builtAt})`);
