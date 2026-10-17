// What this computer can tell the planner (SPEC §4.8): the browser it drives and, if Steam is
// installed, the installed games. Steam's own manifest files are read (appmanifest_*.acf, a few
// lines each); nothing else on disk is touched, and only IDs and names are sent.

import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ContextItem } from "@co2lab/shared";

function regSteamPath(): Promise<string | null> {
  if (process.platform !== "win32") return Promise.resolve(null);
  return new Promise((resolve) =>
    execFile("reg", ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"], { windowsHide: true, timeout: 5_000 }, (err, out) => {
      const m = !err && /SteamPath\s+REG_SZ\s+(.+)/.exec(String(out));
      resolve(m ? m[1]!.trim().replace(/\//g, "\\") : null);
    }),
  );
}

async function steamRoots(): Promise<string[]> {
  const roots = new Set<string>();
  const reg = await regSteamPath();
  if (reg) roots.add(reg);
  if (process.platform === "win32") roots.add("C:\\Program Files (x86)\\Steam");
  else if (process.platform === "darwin") roots.add(join(homedir(), "Library", "Application Support", "Steam"));
  else for (const p of [".steam/steam", ".local/share/Steam"]) roots.add(join(homedir(), p));
  return [...roots];
}

/** Library folders listed in steamapps/libraryfolders.vdf ("path" "D:\\SteamLibrary"). */
async function libraryDirs(root: string): Promise<string[]> {
  const dirs = new Set([join(root, "steamapps")]);
  try {
    const vdf = await readFile(join(root, "steamapps", "libraryfolders.vdf"), "utf8");
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) dirs.add(join(m[1]!.replace(/\\\\/g, "\\"), "steamapps"));
  } catch {
    /* no Steam here */
  }
  return [...dirs];
}

export async function steamGames(): Promise<ContextItem[]> {
  const games = new Map<string, ContextItem>();
  for (const root of await steamRoots()) {
    for (const dir of await libraryDirs(root)) {
      let files: string[];
      try {
        files = (await readdir(dir)).filter((f) => /^appmanifest_\d+\.acf$/.test(f));
      } catch {
        continue;
      }
      for (const f of files.slice(0, 1500)) {
        try {
          const acf = await readFile(join(dir, f), "utf8");
          const id = /"appid"\s+"(\d+)"/.exec(acf)?.[1];
          const name = /"name"\s+"([^"]+)"/.exec(acf)?.[1];
          // Skip Steam's own runtimes and redistributables.
          if (id && name && !/Steamworks Common|Proton|Steam Linux Runtime|Redistributable/i.test(name))
            games.set(id, { kind: "steam_game", id, label: name.slice(0, 200) });
        } catch {
          /* unreadable manifest */
        }
      }
    }
  }
  return [...games.values()];
}

export async function deviceContext(browserLabel: string): Promise<ContextItem[]> {
  return [{ kind: "browser", id: "browser", label: browserLabel }, ...(await steamGames())];
}
