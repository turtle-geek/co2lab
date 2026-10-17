# worker-web

The Co2lab web worker (SPEC §10 T4). It reads current food deals from RedFlagDeals with Playwright Chromium. It streams live frames and steps to the hub, and it returns the page text as evidence. The hub turns that evidence into deals with Gemini. The same code runs on the laptop (headed) and on the VPS as the Cloud worker (headless).

## Run

```bash
npx playwright install chromium          # once per machine (on Linux: npx playwright install --with-deps chromium)
npm run pair -- 123456                    # laptop; name defaults to the hostname, --name "Dragonfly" to override
npm run pair -- 123456 --cloud            # VPS; kind=cloud, name "Cloud worker"
npm start                                 # headed browser window
npm start -- --cloud                      # headless
```

The hub URL comes from `WORKER_HUB_URL` in the root `.env` (or `--hub <url>`). Pairing saves `{hubUrl, deviceId, token}` to `worker-web/.device.json` (gitignored). Use `--device-file <path>` to keep more than one identity on the same machine.

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
