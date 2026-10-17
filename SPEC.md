# Co2lab — SPEC

> Source of truth. Read before building. Update it when a decision changes.
> Last updated: 2026-10-16 (after `/interview`).

## 1. One-line pitch

**The best food deals live inside apps, where no website, API, or cloud agent can reach them. Co2lab turns your old Android phone and laptop into an always-on, private agent team that opens your apps, collects your deals, and tells you where to eat — and it researches how to do that with the least compute.**

Why multiple devices (the answer to "why not one cloud agent"):

1. **App-only access.** Tim Hortons, McDonald's, and Popeyes deals exist only in their mobile apps. Android is the only phone OS that lets an agent drive other apps (Accessibility Service). iOS blocks it.
2. **They are you.** Your devices are already signed in to your accounts. Credentials never leave hardware you own.
3. **Always on, from anywhere.** A VPS is always on but has no sessions or apps. A laptop has sessions but sleeps. An old phone on a charger at home has both. The cloud hub keeps the job alive when any device sleeps.
4. **Free compute from e-waste.** Devices people already own, out of the drawer.

## 2. Demo script (about 90 seconds)

Setup before judges arrive: A54 on charger, all 3 apps signed in, location set near UTSC, onboarding popups dismissed. Dragonfly running the web worker. Dashboard open on the Dragonfly. Viewer link ready to share.

| # | Action | What judges see | Must work |
|---|---|---|---|
| 1 | Show the dashboard | Tree cards: **Galaxy A54** (idle, happy), **Dragonfly** (idle), **Cloud worker** (idle). Battery and temperature on each. | Live telemetry |
| 2 | Share the viewer link (QR or URL) | Judges open the dashboard read-only on their own phones | Viewer link |
| 3 | Type **"Best lunch deals near UTSC today"** in the ask bar | Planner splits it into subtasks: `app:tims`, `app:mcdonalds`, `app:popeyes`, `web:redflagdeals` | Planner |
| 4 | Watch | A54 tree starts sweating; its live screen flips through Tim Hortons → McDonald's → Popeyes. Dragonfly's live screen browses RedFlagDeals. At the same time. | Live screens, parallel run |
| 5 | **Close the Dragonfly lid** | Dragonfly tree falls asleep within ~6 s. Health engine moves its unfinished web subtask to the Cloud worker. Cloud worker's tree wakes and its screen continues. Judges keep watching on their own phones. | Heartbeat timeout, reassignment |
| 6 | Wait | Merged, ranked deal list appears: "1. McD's free medium fries with $1 purchase · 2. Popeyes 2-for-$7 · 3. Tim's $1 coffee" with source, device, and expiry. Burn-o-meter shows tokens, cost, and energy for the run. | Merge, burn-o-meter |
| 7 (stretch) | Tap **Send to lunch group** → approve | A54 posts the list in a WhatsApp group; a phone in front of judges buzzes | WhatsApp recipe |
| 8 (Papiers) | Open **Lab** tab | Experiment: "Can Flash-Lite + low-res screenshots read deals as accurately as Flash at full res?" Trial results, research agent's analysis, the human flag that changed the next experiment, the finding saved to Papiers | Research loop |

Fallback rule: if an app fails live, its subtask shows "failed: <reason>" on the tree card and the merge runs with the rest. Never hide a failure, never show fake data.

## 3. Features

### Must-have (the demo path)

- **M1 Device pairing**: QR + 6-digit one-time code → per-device token.
- **M2 Device telemetry**: battery %, charging, temperature, online state, current task. Tree mood reflects it.
- **M3 Ask bar + planner**: free-text request → subtasks bound to capabilities (`app:<id>`, `web`).
- **M4 Scheduler + health engine**: assigns subtasks by capability and health; detects offline devices by heartbeat; reassigns unfinished work.
- **M5 Android app agent**: Kotlin app, Accessibility Service, runs recipes for Tim Hortons, McDonald's, Popeyes; Gemini vision fallback; streams screen frames.
- **M6 Web worker**: Node + Playwright; browses RedFlagDeals for food deals near Scarborough/UTSC; streams frames. Same code runs on the Dragonfly and as the Cloud worker on Vultr.
- **M7 Merge**: Gemini ranks and de-duplicates deals into a structured result.
- **M8 Dashboard**: tree cards, ask bar, live screens, results, burn-o-meter.
- **M9 Hosting**: hub on Vultr behind Caddy HTTPS + WSS.
- **M10 Access control**: owner passphrase, device tokens, read-only viewer link.

### Prize-track features (do after the demo path works)

- **P1 Research Mode (Papiers Autoresearch Challenge)**: see section 4.5.
- **P2 Tiger Data**: telemetry, agent steps, runs, experiments, trials stored in Tiger Data (time-series Postgres). Until P2 lands, the hub keeps state in memory behind the same repository interface.

### Nice-to-have

- **N1 WhatsApp share**: send the merged list to a chosen group, owner approval required.
- **N2 Remote redeem**: tap Redeem on the dashboard → A54 opens the offer → screenshots the fresh QR/code → shows it to you. Only for apps that allow screenshots; code stays with the owner.
- **N3 Web push** to the owner's phone when a run finishes.
- **N4 Scheduled daily run** (e.g., 10:30 every morning).
- **N5 More apps** (A&W, Starbucks, PC Optimum).

### Cut

- SMS (old phones have no SIM), alarms, text-to-speech, camera, iPad/iOS workers, Pokémon-style multi-accounting.

## 4. User flows

### 4.1 Pair a device

1. Owner opens dashboard → **Add device**. Hub creates a pairing code: 6 digits, single use, expires in 5 min. Dashboard shows the code and a QR of `co2lab://pair?hub=<url>&code=<code>`.
2. Android: open Co2lab app → **Scan QR** (or type hub URL + code). Laptop: `npm run pair -- <code>` in `worker-web/` (hub URL from `.env`).
3. Device calls `POST /api/pair {code, name, kind, capabilities}`. Hub validates, creates `Device`, returns `{deviceId, token}`. Hub stores only `sha256(token)`. The device then opens `/ws` with `hello {role: device, token}`.
4. Device saves token (Android: EncryptedSharedPreferences; laptop: `worker-web/.device.json`, gitignored).
5. New tree card appears. Android app then walks the user through enabling the Accessibility Service and a battery-optimization exemption.

Failure: wrong or expired code → `pair.error` with reason, the device shows it, the code is not consumed on failure (max 5 attempts per code).

### 4.2 Run a deal hunt

1. Owner types a request. Dashboard sends `run.create {prompt, clientRunId}`. `clientRunId` makes the request idempotent (a reconnect never starts a second run).
2. Planner (Gemini, structured output) returns subtasks from the allowed list: `app:tims`, `app:mcdonalds`, `app:popeyes`, `web:redflagdeals`.
3. Scheduler assigns each subtask to an online, healthy device with the capability. Home devices are preferred; the Cloud worker only gets `web` work when no home device can take it.
4. Device runs it, streaming `frame` (JPEG, ~1 fps, ≤720 px wide) and `step` events; ends with `subtask.result {deals[]}` or `subtask.failed {reason}`.
5. When all subtasks are done or failed, hub runs Merge and broadcasts `run.done {ranked[], burn}`.

### 4.3 Android app agent loop (per app subtask)

1. Launch the app by package name. Wait for the window.
2. Run the app's **recipe**: a list of steps that find nodes by visible text or content description (`"Deals"`, `"Offers"`, `"Rewards"`) and click them via the accessibility tree. Each step has a timeout.
3. On the deals screen: take a screenshot (`AccessibilityService.takeScreenshot`, API 30+), scroll, repeat up to N screens.
4. Send screenshots to hub → hub calls Gemini to extract `Deal[]` (structured output).
5. **Fallback**: if a recipe step fails (popup, layout change), send the screenshot + accessibility node summary to hub's agent proxy → Gemini returns one action (`tap node`, `tap x,y`, `back`, `scroll`, `done`) → app performs it. Max 8 fallback actions, then fail with reason.
6. Return to home screen. Report result.

### 4.4 Device goes offline mid-run (lid close)

1. Devices send `heartbeat` every 2 s. Hub marks a device offline after 6 s without one.
2. Its running subtasks go back to `queued` with `attempt+1`; scheduler reassigns. Partial steps are kept.
3. Tree card shows sleeping state with "last seen Xs ago".
4. If the device reconnects with a subtask it no longer owns, hub sends `subtask.cancel`; the device drops it.

### 4.5 Research Mode (Papiers Autoresearch Challenge)

Research question: **What is the cheapest agent configuration that still reads in-app deals correctly?** It feeds the burn-o-meter: the winning config becomes the default for daily runs.

Loop:

1. **Hypothesis** (research agent, Gemini Pro-class model): e.g., "Flash-Lite with 50 % screenshots matches Flash at full resolution on deal extraction at ≤ 1/4 the tokens." It may pull prior context and earlier findings from Papiers via its CLI.
2. **Trials**: configurations × apps. Variables: model (`lite` / `flash` / `pro`), screenshot scale (25/50/100 %), mode (recipe vs. vision-only). To keep trials cheap and repeatable, each trial replays the **same captured screenshot set** from one live phone capture per app (live capture is recorded as part of the experiment).
3. **Ground truth from the human**: the owner reviews the extracted deals for one capture per app in the Lab tab and marks each correct / wrong / missing (this is the expertise only a human has — they can see the real app).
4. **Evaluation**: accuracy vs. ground truth (precision/recall on deals, exact price match), tokens, latency, estimated cost.
5. **Analysis + next step** (research agent): explains results with a table and the specific misreads, and proposes the next experiment.
6. **Human review**: owner can **flag** a result ("it read $1 as $7 — that's a failure, not a pass"), **approve** the proposal, or **redirect** ("test 75 % scale instead"). The agent's next hypothesis must cite the feedback.
7. **Finding** saved to Papiers via CLI and shown in the Lab notebook.

Done for the demo when: at least one full cycle has run, a human flag or redirect visibly changed the next experiment, and a finding is saved to Papiers.

### 4.6 WhatsApp share (N1)

Owner taps **Send to group** → picks a group name saved in settings → dashboard shows the exact message → owner taps **Approve** → hub sends `subtask` `app:whatsapp-send` to A54 → app opens WhatsApp via share intent, selects the group by name, taps send, screenshots confirmation. Deal list only, never redeem codes.

## 5. Tech stack and why

| Part | Choice | Why |
|---|---|---|
| Hub | Node 24 + TypeScript, Fastify (HTTP) + `ws` (WebSocket) | One language with the dashboard and web worker; simple, well-known |
| Shared types | `shared/protocol.ts` (zod schemas) | One message contract for every part; zod validates at the hub |
| Dashboard | Vite + React + TypeScript, `vite-plugin-pwa`, plain CSS modules | Fast to build, installable on a phone |
| Web worker | Node + Playwright (Chromium) | Reliable browser control; same package runs on laptop and Vultr |
| Android agent | Kotlin, minSdk 30 (Android 11), Accessibility Service, foreground service, OkHttp WebSocket | Only way to drive other apps; API 30 gives `takeScreenshot` |
| AI | Gemini API, called **only from the hub** | Key stays on the hub; devices are thin |
| Database | Tiger Data (managed Postgres + TimescaleDB), `pg` client | Time-series telemetry; sponsor track |
| Research notes | Papiers CLI | Sponsor track; stores findings |
| Hosting | Vultr VPS (Ubuntu, ≥ 2 GB RAM) + Caddy (auto HTTPS) + systemd | Sponsor track; always-on; Caddy gives TLS with no config |
| Domain | GoDaddy domain → Vultr IP; fallback `<ip>.sslip.io` | Valid TLS cert either way |

Model IDs are not hard-coded: `GEMINI_MODEL_LITE`, `GEMINI_MODEL_FLASH`, `GEMINI_MODEL_PRO` in `.env`. Pick current IDs at build time.

Device support: any Android 11+ phone installs the same APK; any Windows/macOS/Linux laptop runs `worker-web`. The hub assigns work by capability, not by device model.

## 6. Data model

All IDs are ULIDs. Tables marked (ts) are Timescale hypertables.

- **Device**: `id, name, kind (android|laptop|cloud), capabilities text[] (e.g. app:tims, app:mcdonalds, app:popeyes, app:whatsapp, web), token_hash, created_at, revoked_at`
- **PairingCode**: `code, expires_at, attempts, used_at` (in memory only)
- **Telemetry (ts)**: `time, device_id, battery_pct, charging bool, temp_c, online bool, cpu_pct`
- **Run**: `id, client_run_id unique, prompt, status (planning|running|merging|done|failed), created_at, finished_at, config_id, ranked jsonb, burn jsonb`
- **Subtask**: `id, run_id, capability, status (queued|running|done|failed|cancelled), device_id, attempt, error, started_at, finished_at`
- **AgentStep (ts)**: `time, subtask_id, device_id, kind (recipe|fallback|extract|screenshot), detail jsonb, tokens_in, tokens_out, model`
- **Deal**: `id, run_id, subtask_id, source (tims|mcdonalds|popeyes|redflagdeals), title, price_text, conditions, expires_text, url, screenshot_ref, confidence`
- **Config**: `id, model, screenshot_scale, mode (recipe|vision)`
- **Capture**: `id, app, created_at, frames (screenshot refs)` — one live capture reused across trials
- **GroundTruth**: `capture_id, deals jsonb, labeled_by, labeled_at`
- **Experiment**: `id, hypothesis, status (proposed|approved|running|analyzed), parent_id, cites_feedback_ids`
- **Trial (ts)**: `time, experiment_id, config_id, capture_id, precision, recall, price_exact_pct, tokens, latency_ms, cost_usd`
- **Feedback**: `id, experiment_id, kind (flag|approve|redirect), text, created_at`
- **Finding**: `id, experiment_id, summary, papiers_ref`
- **ViewerLink**: `token_hash, expires_at, revoked_at`

Screenshots are stored on the hub disk (`hub/data/frames/`) and referenced by path; only the latest frame per device is kept for live view, plus frames attached to captures and deals.

## 7. API / service list

| Service | Used for | Key / account | Status |
|---|---|---|---|
| Gemini API | Planner, extraction, agent proxy fallback, merge, research agent | `GEMINI_API_KEY` | **Unconfirmed — owner to confirm** |
| Vultr | Hub + Cloud worker VPS | account | **To create** |
| Tiger Data | Postgres/Timescale | `DATABASE_URL` | **To create** |
| Papiers | Read context, save findings (CLI) | Papiers account + CLI auth | **To create; read https://papiers.ai/docs** |
| GoDaddy | Domain for the hub | DNS A record | Optional (fallback sslip.io) |
| Tim Hortons, McDonald's, Popeyes apps | Deal sources | Owner's own accounts, signed in on A54 | Owner |
| RedFlagDeals | Web deal source (read-only, low rate) | none | — |
| WhatsApp | N1 share | Owner's account on A54 | Stretch |

`.env.example` lists: `GEMINI_API_KEY, GEMINI_MODEL_LITE, GEMINI_MODEL_FLASH, GEMINI_MODEL_PRO, DATABASE_URL, OWNER_PASSPHRASE, SESSION_SECRET, HUB_PUBLIC_URL, PAPIERS_*` (exact Papiers vars after reading docs).

### WebSocket protocol (summary; full zod schemas in `shared/protocol.ts`)

Endpoint `wss://<hub>/ws`. First message authenticates: `hello {role: device|owner|viewer, token}`.

HTTP: `POST /api/login`, `POST /api/logout`, `POST /api/pair`, `GET /api/health`. See `shared/PROTOCOL.md`.

- Device → hub: `heartbeat {telemetry}`, `frame {subtaskId?, jpegBase64}`, `step`, `subtask.result {evidence: images/text}` (hub extracts deals with Gemini), `subtask.failed`, `proxy.request {subtaskId, screenshot, nodes}`
- Hub → device: `hello.ok`, `subtask.assign {subtaskId, capability, goal, config}`, `subtask.cancel`, `proxy.action`, `error`
- Owner → hub: `run.create`, `pair.start`, `device.revoke`, `viewer.create`, `research.*`, `approval.respond`
- Hub → owner/viewer: `state.snapshot`, `device.update`, `frame`, `run.update`, `run.done`, `research.update`

Viewers receive only hub → client events and cannot send commands.

## 8. Edge cases and how each is handled

| Case | Handling |
|---|---|
| Device offline mid-subtask | 6 s heartbeat timeout → reassign; card shows sleeping + last seen |
| No device has the capability | Subtask fails at once with "no device can run app:tims"; merge runs with the rest |
| All subtasks fail | Run ends `failed` with each reason listed; no merged list |
| App popup / layout change | Recipe step times out → Gemini fallback (max 8 actions) → fail with reason |
| App not signed in / shows login screen | Recipe detects login screen text → fail "sign in to Tim Hortons on Galaxy A54"; never types credentials |
| Screenshot blocked (secure screen, black image) | Detect all-black frame → fail "app blocks screenshots" |
| Gemini error / rate limit (429) | Retry with backoff 1 s, 2 s, 4 s; then fail subtask with reason; burn-o-meter counts only real usage |
| Gemini returns invalid JSON | Structured output + zod validation; one retry, then fail |
| Duplicate run from reconnect | `clientRunId` unique → returns the existing run |
| Device reconnects holding stale subtask | Hub sends `subtask.cancel` |
| Battery < 20 % and not charging | Health engine stops assigning to it, card shows "resting", dashboard warns "plug in Galaxy A54" |
| Temperature ≥ 42 °C | Pause the device after the current subtask; resume under 38 °C |
| Laptop battery | Same thresholds via `systeminformation`; Windows charge limit set in OEM tool (not by us) |
| Pairing code wrong/expired | `pair.error` with reason; max 5 attempts per code |
| Revoked device connects | Hub rejects `hello`, closes socket |
| Viewer link expired | Dashboard shows "This link has expired" |
| Hub restarts | Devices reconnect with backoff (1→10 s); runs in progress marked failed "hub restarted" (Tiger Data keeps history) |
| Network loss on dashboard | Banner "Reconnecting…", auto-reconnect, `state.snapshot` on reconnect |
| Empty deal list from an app | Valid result: "no deals found" shown, not an error |
| RedFlagDeals page blocks or times out | Fail subtask with reason; never retry more than twice |
| Research trial on a capture with no ground truth | Lab tab asks the owner to label it first; trials wait |

## 9. UI direction

Reference: `Mock UI/Tree UI.jpg`.

- Soft, friendly, calm. Pale blue-gray page, cream rounded cards, muted greens, soft shadows. Rounded sans-serif.
- **Tree cards** (one per device): tree illustration whose mood shows state:
  - idle → smiling, blush
  - working → squinting, sweat drop, gentle sway
  - offline/asleep → desaturated, eyes closed, "zzz"
  - resting (low battery) → drooping leaves
  - hot → red cheeks, heat shimmer
  - error → dizzy eyes, for the duration of the failure message
  - revoked → withered, then removed
  - Card text: name, state pill (Idle / Working / Offline / Resting), `battery % · temp`, current task with a progress bar (e.g., "Tim Hortons ▮▮▮▯▯").
- **Add device** card: dashed outline, "+", "Pair an old device".
- **Ask bar** at top with the burn-o-meter beside it (tokens, est. cost, est. Wh for the current run).
- **Live screens**: one panel per working device, phone frame for Android, browser frame for web, current step caption below.
- **Results**: ranked deal cards with source logo text, price, conditions, expiry, which device found it.
- **Lab** tab: experiment timeline (hypothesis → trials table → analysis → feedback → next), labeling UI for ground truth, flag/approve/redirect buttons, findings list.
- Works at phone width (judges view on phones). Viewer mode hides all controls.
- Polish near the end with `/better-ui`, `/animate`.

## 10. Work breakdown

Order of attack: **T0 → (T1, T2, T3, T4, T8 in parallel) → T5 → T6 → T7 → stretch.** Build the Android agent early; it is the riskiest piece.

Each task owns its folder. Nobody edits another task's folder; contract changes go through `shared/` and this spec.

| ID | Task | Owns | Done when | Est. |
|---|---|---|---|---|
| **T0** | Protocol + repo scaffold | `shared/`, root `package.json` (npm workspaces), `.env.example`, `.gitignore` | zod schemas for every message in §7 compile; Kotlin mirror documented in `shared/PROTOCOL.md` | 0.5 h |
| **T8** | App spike (manual, on A54) | `docs/app-spike.md` | For Tim's, McD's, Popeyes: package name, path to deals screen (node texts), screenshot works (not black), login state OK | 0.5 h |
| **T1** | Hub core | `hub/` | Auth (owner/device/viewer), pairing, heartbeat/offline detection, scheduler, health engine, planner, Gemini extraction + agent proxy + merge, frame relay; in-memory repo; a fake device script passes a full run | 3 h |
| **T2** | Dashboard | `dashboard/` (except `src/lab/`) | Owner login, tree cards with all moods, add-device flow with QR + code, ask bar, live screens, results, burn-o-meter, viewer mode, phone width; verified in browser against T1 | 3 h |
| **T3** | Android agent | `android/` | Pairs by QR/code, foreground service keeps WS alive, telemetry, accessibility recipes for 3 apps, screenshots → hub, fallback actions, frames streamed; one real run on A54 returns deals from all 3 apps | 4 h |
| **T4** | Web worker | `worker-web/` | Pairs with code, telemetry via `systeminformation`, Playwright reads RedFlagDeals food deals, streams frames; `--cloud` flag runs headless as the Cloud worker | 1.5 h |
| **T5** | Deploy | `deploy/` | Vultr VPS with Caddy + systemd for hub and Cloud worker; dashboard served by hub; HTTPS/WSS work from the A54 on another network | 1 h |
| **T6** | Tiger Data | `hub/src/db/` (only this subfolder), `db/schema.sql` | Schema applied; repo interface swapped from memory to Postgres; telemetry and steps visible in Tiger console | 1 h |
| **T7** | Research Mode | `hub/src/research/`, `dashboard/src/lab/` | Full loop from §4.5 with one completed cycle, human feedback changes next experiment, finding saved via Papiers CLI | 3.5 h |
| N1 | WhatsApp share | `android/.../recipes/WhatsApp*.kt`, hub approval endpoint | Approved message posts to group | 1 h |
| N2 | Remote redeem | `android/.../recipes/Redeem*.kt`, dashboard redeem view | Fresh code shown on owner's phone within 15 s | 1.5 h |
| — | Polish, demo rehearsal, Devpost, video | — | Demo script runs 3 times in a row | 2–3 h |

Total: core ≈ 13.5 h, with prize tracks ≈ 18 h, everything ≈ 21 h. The deadline is 24 h from 2026-10-16 start.

Cut order if late: N2 → N1 → T6 (stay in memory, mention Tiger as planned) → reduce T7 to one cycle with fewer configs. Never cut: T1–T5.

Parallel sessions: T1, T2, T3, T4 can run at the same time after T0 because they meet only at `shared/protocol.ts`. T8 runs by hand on the phone while T0 is built.

## 11. Open questions

1. **Gemini API key** — does the owner already have one with enough quota?
2. **Accounts** — Vultr, Tiger Data, Papiers to be created (owner, now).
3. **Domain** — use the GoDaddy domain from the diagram, or sslip.io?
4. **Papiers CLI** — exact install/auth/commands; read https://papiers.ai/docs during T7.
5. **App package names and deal-screen paths** — answered by T8.
