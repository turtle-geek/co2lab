# db

- `schema.sql`: tables from SPEC §6. `telemetry`, `agent_step` and `trial` are Timescale hypertables. The file is idempotent; the hub applies it on every start.
- `timescale-ca.pem`: Tiger Data's CA. The hub trusts only this CA and checks that the server certificate has subject `O=Timescale Inc` (the leaf names an internal proxy host, so a normal hostname check fails). See `hub/src/db/connect.ts`.

## How the hub uses it

- `DATABASE_URL` is set: the hub uses the Postgres repository (`hub/src/db/pg.ts`). `/api/health` reports `"repo": "postgres"`. The password comes from `DATABASE_PASSWORD`, not from the URL.
- `DATABASE_URL` is empty: the hub uses the in-memory store.
- The database cannot be reached after 3 tries: the hub logs an error and starts on the in-memory store, so the demo still runs.

What the hub stores: devices (pairings survive a restart), viewer links, runs, subtasks, deals, agent steps, and telemetry. Telemetry is written at most once per device every 10 s, and always on an online/offline change. When the hub starts, it marks runs that were still in progress as `failed` with `hub restarted`, and their open subtasks as `cancelled`.

The `config`, `capture`, `ground_truth`, `experiment`, `trial`, `feedback` and `finding` tables are for Research Mode (T7). The hub does not write to them yet.
