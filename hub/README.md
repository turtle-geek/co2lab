# Co2lab hub (T1)

Node 24 + TypeScript, Fastify (HTTP) + `ws` (WebSocket at `/ws`), run with `tsx`. Gemini is called only from here.
Protocol: `shared/src/protocol.ts` and `shared/PROTOCOL.md`.

## Run

```bash
npm install            # at the repo root (npm workspaces)
npm run dev -w hub     # tsx watch, port HUB_PORT (default 8787)
npm run start -w hub   # no watch
npm run typecheck -w hub
```

Settings come from the root `.env` (see `.env.example`). Real environment variables win over `.env`.
Hub-only extras: `HUB_HOST` (default `0.0.0.0`), `GEMINI_PRICE_LITE|FLASH|PRO=in,out` (USD per 1M tokens).

## Test without real devices

```bash
# a simulated device: pair with a code from the dashboard (Add device), or reconnect with a token
npm run fake-device -w hub -- --code 123456 --name "Fake laptop" --kind laptop --caps web
npm run fake-device -w hub -- --token <token>

# full run against a running hub: 2 fake devices, kill one mid-subtask, check reassignment + result
npm run e2e -w hub
npm run e2e -w hub -- --scenario sleep   # pause instead of kill; checks subtask.cancel on wake-up
```

The fake device sends real text evidence for `web` (the live RedFlagDeals Hot Deals feed). For `app:*` it sends a
labelled test fixture, because only a real phone can open the apps. Its frames reuse `Mock UI/Tree UI.jpg`.

## How it behaves

- **Auth**: `POST /api/login` sets an httpOnly `co2lab_session` cookie (HMAC with `SESSION_SECRET`, 7 days).
  Login is off until `OWNER_PASSPHRASE` and a 32+ char `SESSION_SECRET` are set. `GET /api/session` → `{owner}`.
  Device tokens and viewer tokens are stored only as SHA-256. Bad or missing `hello` → `error` then close 4001.
- **Pairing**: `pair.start` → 6-digit code, 5 min, single use. A wrong code counts against every live code; 5 strikes burns it.
- **Viewer links**: `viewer.create` → `${HUB_PUBLIC_URL}/?viewer=<token>`. Viewers get the same events and can send nothing.
- **Device state** (`src/devices.ts`): revoked > offline (no heartbeat for 6 s) > error (10 s after a failure) >
  hot (≥ 42 °C until < 38 °C) > resting (< 20 % and not charging) > working > idle.
- **Scheduler** (`src/runs.ts`): one subtask per device at a time; home devices first; `kind=cloud` only gets work
  when no healthy home device has the capability. Offline device → its subtasks go back to the queue with
  `attempt+1` (max 3). A device that reconnects still holding a subtask it no longer owns gets `subtask.cancel`.
  No paired device with the capability → the subtask fails at once. Queued > 90 s or running > 5 min → fails.
- **Planner**: Gemini (lite model) picks from `app:tims`, `app:mcdonalds`, `app:popeyes`, `web:redflagdeals`.
  If Gemini is not available the run checks all four sources and says so in the hub log; extraction then fails
  with the real reason (for example "GEMINI_API_KEY is not set on the hub"). Nothing is ever made up.
- **Evidence → deals**: on `subtask.result` the hub saves screenshots to `hub/data/frames/` and asks Gemini (model
  from the run config) for `Deal[]`. `screenshotRef` is `frames/<file>.jpg`, served at
  `GET /api/evidence/<file>.jpg` (owner cookie, or `?viewer=<token>`).
- **Agent proxy**: `proxy.request` → one `ProxyAction` from Gemini; on any error the device gets `fail` with the reason.
- **Merge**: when every subtask is done/failed, Gemini (flash) de-dupes and ranks. All failed → run `failed` with each reason.
- **Gemini calls** (`src/gemini.ts`): structured JSON output validated by zod, retry 1/2/4 s on 429/5xx/network,
  one retry on invalid JSON.
- **Burn** (`src/burn.ts`): real token counts from Gemini; cost and energy are estimates from documented constants.
- **Storage**: `src/repo/types.ts` is the interface, `src/repo/memory.ts` the in-memory store. T6 adds Postgres under
  `src/db/` and returns it from `createRepository()` in `src/repo/index.ts`.
- **Dashboard**: served from `dashboard/dist` (SPA fallback) if it was built before the hub started.
