import { log } from "../log.js";
import { MemoryRepository } from "./memory.js";
import type { Repository } from "./types.js";

export type * from "./types.js";

/**
 * Picks the storage backend. T6: when DATABASE_URL is set, return the Postgres
 * repository from hub/src/db/ here instead.
 */
export async function createRepository(): Promise<Repository> {
  if (process.env.DATABASE_URL) {
    log.warn("DATABASE_URL is set but the Postgres repository is not built yet (T6); using in-memory store.");
  }
  return new MemoryRepository();
}
