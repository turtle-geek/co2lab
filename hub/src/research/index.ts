import { PgRepository } from "../db/pg.js";
import { PgResearchStore } from "../db/research-pg.js";
import type { Repository } from "../repo/index.js";
import { MemoryResearchStore, type ResearchStore } from "./store.js";

export { ResearchLab, UserError } from "./lab.js";

/** Research data goes where the rest of the hub's data goes: Tiger Data when the repo is Postgres. */
export function researchStoreFor(repo: Repository): ResearchStore {
  return repo instanceof PgRepository ? new PgResearchStore(repo.pool) : new MemoryResearchStore();
}
