import { PgRepository } from "../db/pg.js";
import { log } from "../log.js";
import { MemoryRepository } from "./memory.js";
import type { Repository } from "./types.js";

export type * from "./types.js";

/**
 * Picks the storage backend: Postgres (Tiger Data, hub/src/db/) when DATABASE_URL is set,
 * otherwise the in-memory store. If the database cannot be reached after a few tries the hub
 * still starts on the in-memory store (health then reports repo "memory").
 */
export async function createRepository(): Promise<Repository> {
  if (!process.env.DATABASE_URL?.trim()) return new MemoryRepository();
  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    try {
      const repo = await PgRepository.open();
      log.info(`postgres connected and schema applied in ${Date.now() - started} ms`);
      return repo;
    } catch (e) {
      if (attempt >= 3) {
        log.error("postgres unavailable; falling back to the in-memory store (pairings will not survive a restart)", e);
        return new MemoryRepository();
      }
      log.warn(`postgres connect attempt ${attempt} failed: ${(e as Error).message}; retrying`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}
