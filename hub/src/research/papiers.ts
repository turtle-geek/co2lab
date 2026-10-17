// Read-only Papiers CLI (`papiers search` / `papiers read`, npm package "papiers").
// The research agent uses it for prior context; findings are stored in Tiger, never written here.
//
// How the CLI is started, first match wins:
//   PAPIERS_BIN=<path to papiers.mjs>   run with this Node binary
//   "papiers" installed in node_modules  run its bin with this Node binary
//   otherwise                            npx --yes papiers@<PAPIERS_VERSION>
// PAPIERS_TOKEN comes from the root .env and is passed through the environment only.

import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export const PAPIERS_VERSION = "0.1.5";
const TIMEOUT_MS = 45_000;

export interface PapiersHit {
  id: string;
  kind: string;
  title: string | null;
  /** Snippets the search returned (result + evidence), joined. */
  text: string;
}

function command(): { file: string; args: string[]; shell: boolean } {
  const bin = process.env.PAPIERS_BIN?.trim();
  if (bin) return { file: process.execPath, args: [bin], shell: false };
  try {
    const pkg = createRequire(import.meta.url).resolve("papiers/package.json");
    return { file: process.execPath, args: [join(dirname(pkg), "bin", "papiers.mjs")], shell: false };
  } catch {
    // On Windows npx is a .cmd, which needs a shell; arguments are sanitized below.
    return { file: "npx", args: ["--yes", `papiers@${PAPIERS_VERSION}`], shell: process.platform === "win32" };
  }
}

export function papiersProblem(): string | null {
  return process.env.PAPIERS_TOKEN?.trim() ? null : "PAPIERS_TOKEN is not set on the hub";
}

function run(args: string[]): Promise<unknown> {
  const problem = papiersProblem();
  if (problem) return Promise.reject(new Error(problem));
  const cmd = command();
  const safe = cmd.shell ? args.map((a) => `"${a.replace(/["%^&|<>!]/g, " ")}"`) : args;
  return new Promise((resolve, reject) => {
    execFile(
      cmd.file,
      [...cmd.args, ...safe],
      { timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, shell: cmd.shell, env: process.env, windowsHide: true },
      (err, stdout, stderr) => {
        const out = String(stdout).trim();
        if (out.startsWith("{")) {
          try {
            const parsed = JSON.parse(out) as { ok?: boolean; error?: { message?: string } };
            if (parsed.ok === false) return reject(new Error(`papiers: ${parsed.error?.message ?? "error"}`));
            return resolve(parsed);
          } catch {
            /* fall through */
          }
        }
        const why = err ? (err.killed ? `timed out after ${TIMEOUT_MS / 1000} s` : String(stderr || err.message)) : "no JSON output";
        reject(new Error(`papiers ${args[0]} failed: ${why.trim().slice(0, 300)}`));
      },
    );
  });
}

const str = (v: unknown) => (typeof v === "string" ? v : null);

export async function papiersSearch(query: string, limit = 5): Promise<PapiersHit[]> {
  const res = (await run(["search", query, "--limit", String(limit), "--json"])) as { results?: unknown[]; items?: unknown[] };
  const list = (res.results ?? res.items ?? []) as Record<string, unknown>[];
  return list
    .map((r) => {
      const evidence = Array.isArray(r.evidence) ? (r.evidence as Record<string, unknown>[]) : [];
      const parts = [str(r.snippet) ?? str(r.preview), ...evidence.map((e) => str(e.snippet))].filter((s): s is string => !!s?.trim());
      return { id: String(r.id ?? ""), kind: String(r.kind ?? ""), title: str(r.title), text: parts.join("\n").slice(0, 1500) };
    })
    .filter((h) => h.id);
}

/** Reads one item as plain text (documents are cut to maxChars). */
export async function papiersRead(id: string, maxChars = 2500): Promise<string> {
  if (!/^[a-z]{3,4}_[A-Za-z0-9_-]+$/.test(id)) throw new Error(`not a Papiers id: ${id}`);
  const res = (await run(["read", id, "--format", "plain", "--max-chars-per-item", String(maxChars), "--json"])) as {
    items?: Record<string, unknown>[];
  };
  const item = res.items?.[0];
  if (!item) return "";
  // The read envelope carries the rendered text in one of these fields depending on kind.
  for (const k of ["content", "text", "plain", "markdown", "body"]) {
    const v = item[k];
    if (typeof v === "string" && v.trim()) return v.slice(0, maxChars);
    if (v && typeof v === "object") {
      const inner = (v as Record<string, unknown>).text ?? (v as Record<string, unknown>).value;
      if (typeof inner === "string" && inner.trim()) return inner.slice(0, maxChars);
    }
  }
  return "";
}
