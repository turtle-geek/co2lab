# worker-web

The Co2lab web worker (SPEC §10 T4). It reads current food deals from RedFlagDeals with Playwright Chromium. It streams live frames and steps to the hub, and it returns the page text as evidence. The hub turns that evidence into deals with Gemini. The same code runs on the laptop (headed) and on the VPS as the Cloud worker (headless).

## Add a computer (no repo needed)

Dashboard → **Add device** → **Laptop or desktop** shows the one-liner with the hub URL filled in:

```powershell
irm https://<hub>/install.ps1 | iex          # Windows PowerShell
```
```bash
curl -fsSL https://<hub>/install.sh | sh     # macOS / Linux
```

It installs Node 24 if needed (portable, in `%LOCALAPPDATA%\co2lab\node` or `~/.co2lab/node`), downloads the prebuilt worker from the hub, offers to start it at login, then runs it. The worker detects the computer, prints a code, an approve link and a QR, and waits until you click **Approve** in the dashboard. Run the line again to update the worker; the saved token is kept. Set `CO2LAB_AUTOSTART=1` or `0` to skip the question.

The installer scripts are in [`install/`](install/). The hub serves them with its URL filled in, plus `dist/co2lab-worker.tgz` from `npm run bundle` (esbuild bundle of `src/main.ts` plus `playwright-core`). Deploy runs the bundle step.

Deploying this to the Vultr hub:

1. Merge the branch into `main` and push.
2. `bash deploy/deploy.sh` (pulls, `npm ci`, builds the dashboard, runs `npm run bundle -w worker-web`, restarts the hub). `npm ci` must install dev dependencies (esbuild); do not set `NODE_ENV=production` for it.
3. Check: `curl -sI https://<hub>/install/worker.tgz` is `200 application/gzip`, and `curl -s https://<hub>/install.ps1 | findstr Hub` shows the public URL.
4. On a laptop: `irm https://<hub>/install.ps1 | iex`, approve in the dashboard.

## Run from the repo

```bash
npm run pair                              # device-code pairing: approve this computer in the dashboard
npm run pair -- 123456                    # legacy: 6-digit code from the dashboard's Android tab
npm run pair -- --cloud                   # VPS; kind=cloud, name "Cloud worker"
npm start                                 # headed browser window (pairs first if there is no .device.json)
npm start -- --cloud                      # headless
```

The hub URL comes from `--hub <url>` or `WORKER_HUB_URL` in the root `.env`. Pairing saves `{hubUrl, deviceId, token, name, kind}` to `worker-web/.device.json` (gitignored). Use `--device-file <path>` to keep more than one identity on the same machine.

Auto-detection ([`src/detect.ts`](src/detect.ts)): `laptop` if systeminformation finds a battery or a portable chassis, else `desktop`. The default name is the hostname, or the model when the hostname is a Windows placeholder like `DESKTOP-AB12CDE`.

Browser ([`src/browser.ts`](src/browser.ts)): the system Edge, then Chrome, then Playwright Chromium (downloaded once if missing). `WORKER_BROWSER=msedge|chrome|chromium` forces one. On Linux servers install Chromium with `npx playwright install --with-deps chromium`.

If the hub rejects the token (device revoked), the worker renames `.device.json` to `.device.json.rejected` and exits with code 3; the next start asks for approval again.

Optional settings:

| Setting | Default | Meaning |
|---|---|---|
| `WORKER_THREADS` | 5 | Threads to open per subtask |
| `WORKER_DWELL_MS` | 3000 | Time each page stays on screen; this also keeps the request rate low |
| `--evidence-images` | off | Also attach screenshots, scaled by `config.screenshotScale` |
| `WORKER_RFD_BASE` | `https://forums.redflagdeals.com` | Testing only (for example, point it at a dead port to test failures) |

## How it reads RedFlagDeals

The forum HTML pages are behind a proof-of-work bot check. That check rejects automated browsers (`navigator.webdriver`), and Playwright loops on the challenge. We do not try to get around it. The forum also serves the public JSON API that its own site uses (`/api/topics`, `/api/topics/<id>/posts`) without that check. The worker reads that API from the Playwright browser context, then shows each listing and thread in the browser window as a reader view. The window and the dashboard live frame show the real data that is read.

Per subtask: 3 category listings (Hot Deals categories 5150, 5149, 5151) plus 5 threads. That is 8 requests in about 30 to 45 s. Threads that are valid only in other provinces, or that are expired or stale (no reply in 45 days), are skipped. Scarborough, Toronto, Ontario, and national chains rank higher.

Failures: each request has a 15 s timeout and up to 2 retries. If the first listing cannot be read, the subtask fails at once with the specific reason (for example `Could not reach forums.redflagdeals.com (ENOTFOUND) (gave up after 3 attempts)` or `RedFlagDeals returned a bot check instead of deal data (HTTP 202)`). If a single thread fails, the worker skips it and continues.

## Test without the hub

```bash
npm run fake-hub                                   # terminal 1; port 8799, code 123456
npm run pair -- 123456 --hub http://localhost:8799 # terminal 2
npm start
npm run fake-hub -- --any-token --cancel-after 15000   # cancel test (accepts the saved token)
```

The fake hub validates every message with the shared zod schemas. It saves the last frame and the evidence to `worker-web/out/` and prints a summary.
