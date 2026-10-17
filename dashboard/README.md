# Co2lab dashboard (T2)

Vite + React + TypeScript PWA. Types come from `@co2lab/shared`.

## Run

From the repo root:

```bash
npm install
npm run dev -w dashboard
```

- **With the real hub**: start the hub on `http://localhost:8787`, then open http://localhost:5173. Vite proxies `/api` and `/ws` to the hub (override with `HUB_URL=...`).
- **With the mock hub (dev only)**: open http://localhost:5173/?mock=1. Passphrase `demo`. The dark **MOCK HUB** panel (bottom right) forces tree moods, closes/opens the Dragonfly lid, finishes pairing, and drops the connection for 5 s. Put "fail" in a prompt to make Popeyes fail. A viewer link from **Share view** opens a separate mock in viewer mode. `?mock=1&viewer=expired` shows the expired screen.
- **Viewer mode**: any URL with `?viewer=<token>` (or `#viewer=<token>`). Read-only: every control is hidden.

The mock lives in `src/mock/` and loads only when `import.meta.env.DEV` is true and the URL has `?mock`. Production builds do not contain it. It validates every message it sends with the shared zod schemas.

## Build

```bash
npm run build -w dashboard
```

Output goes to `dashboard/dist/` (SPA, `sw.js`, `manifest.webmanifest`). The hub can serve it as static files with an SPA fallback to `index.html`. The service worker never handles `/api/*` or `/ws`.

## Hub contract the dashboard relies on

- `POST /api/login {passphrase}` → 2xx sets the session cookie. 400/401/403 = wrong passphrase.
- `/ws`: `hello {role:"owner"}` (cookie) or `hello {role:"viewer", token}`. A close with code 4001/4003, or an `error` with code `unauthorized|forbidden|expired|revoked|auth` before `state.snapshot`, means "log in" (owner) or "link expired" (viewer).
- `viewer.link.url` should be `<HUB_PUBLIC_URL>/?viewer=<token>`.
- The current run is the run with the newest `createdAt`. If the snapshot after a reconnect does not contain a pending `clientRunId`, the dashboard sends `run.create` again with the same id.

## Lab tab (T7)

`src/lab/` belongs to T7. If `src/lab/LabTab.tsx` exists, its default export is rendered in the Lab tab with `LabProps` from `src/labSlot.tsx` (`experiments`, `defaultConfig`, `devices`, `readOnly`, `connected`, `send`). No other file needs to change.
