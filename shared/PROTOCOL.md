# Co2lab protocol

The source of truth is [`src/protocol.ts`](src/protocol.ts) (zod). This file explains it for the Kotlin app and for humans. When one changes, change both, and update `SPEC.md` §7 if the change is visible.

## Transport

- HTTP and WebSocket on the same origin: `HUB_PUBLIC_URL` (e.g. `https://co2lab.example.com`).
- WebSocket path: `/ws`. Every message is one JSON object with a `type` field.
- The first message on every socket is `hello`. The hub closes the socket (code 4001) if it is missing or invalid.
- Timing (see [`src/constants.ts`](src/constants.ts)): heartbeat every 2 s, offline after 6 s of silence, reconnect backoff 1 s → 10 s.
- Nullable fields are always present and set to `null` (do not omit them). Kotlin: use `kotlinx.serialization` with `explicitNulls = true`, `ignoreUnknownKeys = true`.

## HTTP endpoints

| Method + path | Auth | Body | Response |
|---|---|---|---|
| `POST /api/login` | none | `{ "passphrase": "..." }` | `204`, sets httpOnly `co2lab_session` cookie |
| `POST /api/logout` | owner | — | `204` |
| `POST /api/pair` | the one-time code | `PairRequest` | `200 PairResponse` or `400 {error}` |
| `POST /api/device-code` | none (owner approves later) | `DeviceCodeStartRequest` | `200 DeviceCodeStartResponse` or `429 {error:"rate_limited"\|"too_many_pending"}` |
| `POST /api/device-code/poll` | the device code | `{ "deviceCode": "..." }` | `200 DeviceCodePollResponse` or `404 {error:"unknown_code"}` |
| `GET /api/health` | none | — | `200 {ok:true}` |
| `GET /install.ps1`, `GET /install.sh` | none | — | Worker installer with the hub URL filled in |
| `GET /install/worker.tgz` | none | — | Prebuilt worker bundle (`npm run bundle -w worker-web`) |

## Pairing

1. Owner sends `{ "type": "pair.start" }`. Hub replies:
   ```json
   { "type": "pair.code", "code": "482913", "qrPayload": "co2lab://pair?hub=https%3A%2F%2Fco2lab.example.com&code=482913", "expiresAt": 1760640000000 }
   ```
2. Device calls `POST /api/pair`:
   ```json
   { "code": "482913", "name": "Galaxy A54", "kind": "android", "capabilities": ["app:tims", "app:mcdonalds", "app:popeyes", "app:whatsapp"] }
   ```
   Response: `{ "deviceId": "01J...", "token": "<long random secret>" }`. Store the token securely. The hub stores only its SHA-256.
3. Device opens `/ws` and sends `{ "type": "hello", "role": "device", "token": "<token>" }`. Hub replies `{ "type": "hello.ok", "deviceId": "01J...", "name": "Galaxy A54" }`.

Errors: `400 {"error":"code_expired"|"code_invalid"|"too_many_attempts"}`. A failed attempt does not consume the code; 5 failures do.

## Device-code pairing (laptops and desktops)

Computers join without a code from the dashboard, like `gh auth login`. The Android app keeps the 6-digit flow above.

1. The worker detects the computer and calls `POST /api/device-code`:
   ```json
   { "name": "EZ-Laptop", "kind": "laptop", "capabilities": ["web"],
     "info": { "hostname": "EZ-Laptop", "os": "Microsoft Windows 11 Pro 10.0.26200", "arch": "x64",
               "model": "HP ZBook Power 16 inch G11", "cpu": "Intel Core Ultra 7 155H (22 threads)",
               "ramGb": 31, "hasBattery": true, "browser": "Microsoft Edge" } }
   ```
   `kind` is `laptop | desktop | cloud`. Response:
   ```json
   { "deviceCode": "<secret>", "userCode": "FLSX-TPJL", "verificationUrl": "https://<hub>/approve",
     "verificationUrlComplete": "https://<hub>/approve?code=FLSX-TPJL", "expiresAt": 1760640600000, "intervalS": 3 }
   ```
   The worker prints the user code, the URL and a QR of the URL.
2. Owners get `{ "type": "devicecode.list", "hubUrl": "...", "pending": [PendingDevice] }` after the snapshot and on every change (viewers never do). `PendingDevice` has the `userCode`, name, kind, capabilities, `info`, the client `ip`, `createdAt` and `expiresAt`.
3. The owner sends `{ "type": "devicecode.approve", "userCode": "FLSX-TPJL", "name": "ZBook" }` (`name` optional, renames the device) or `{ "type": "devicecode.deny", "userCode": "FLSX-TPJL" }`. An unknown or expired code gives `error` `devicecode_not_found` / `devicecode_expired`.
4. The worker polls `POST /api/device-code/poll {deviceCode}` every `intervalS`. Responses: `{"status":"pending"}`, `{"status":"slow_down"}` (poll less often), `{"status":"approved","deviceId","token","name"}` (returned once), `{"status":"denied"}`, `{"status":"expired"}`. Then it opens `/ws` with the token as in step 3 above.

Limits: codes live 10 min; 5 starts per client IP per 10 min and 20 pending in total (`429`). The user code uses 20 consonants (8 letters, about 2.6 × 10¹⁰ codes) and is only usable by a logged-in owner; the device code is a 32-byte secret.

## Device ↔ hub messages

### Device → hub

```json
{ "type": "heartbeat", "telemetry": { "batteryPct": 82, "charging": true, "tempC": 31.5, "cpuPct": null }, "runningSubtaskIds": [] }
```
```json
{ "type": "frame", "subtaskId": "01J...", "jpegBase64": "/9j/4AAQ...", "width": 720, "height": 1600 }
```
Send frames only while working, about 1 per second, max width 720 px, JPEG quality ~60.
```json
{ "type": "step", "subtaskId": "01J...", "kind": "recipe", "text": "Opened Offers tab", "progress": 0.4 }
```
`kind`: `recipe | fallback | extract | screenshot | info`. `progress` is optional, 0–1.
```json
{ "type": "subtask.result", "subtaskId": "01J...", "evidence": { "images": ["/9j/..."], "text": "accessibility text dump or page text, or null" } }
```
The hub extracts deals from the evidence with Gemini. Scale screenshots by `config.screenshotScale` before sending.
```json
{ "type": "subtask.failed", "subtaskId": "01J...", "reason": "Tim Hortons shows a sign-in screen" }
```
```json
{ "type": "proxy.request", "requestId": "r-17", "subtaskId": "01J...", "goal": "Open the Offers tab", "screenshot": "/9j/...", "nodes": [ { "id": "0.3.1", "text": "Offers", "desc": null, "viewId": "com.example:id/tab_offers", "clickable": true, "bounds": [0, 2200, 360, 2340] } ], "history": ["tapNode 0.2", "back"] }
```

### Hub → device

```json
{ "type": "subtask.assign", "subtaskId": "01J...", "runId": "01J...", "capability": "app:tims", "goal": "Collect all current offers in the Tim Hortons app", "config": { "model": "flash", "screenshotScale": 0.5, "mode": "recipe" } }
```
`mode: "vision"` means skip the recipe and use only `proxy.request` steps (Research Mode trials).
```json
{ "type": "subtask.cancel", "subtaskId": "01J..." }
```
Stop the subtask right away and send nothing more for it.
```json
{ "type": "proxy.action", "requestId": "r-17", "action": { "kind": "tapNode", "nodeId": "0.3.1" } }
```
Action kinds: `tapNode {nodeId}`, `tapXY {x,y}`, `back`, `scroll {direction: up|down}`, `wait {ms}`, `done`, `fail {reason}`. Max 8 per subtask.
```json
{ "type": "error", "code": "bad_message", "message": "..." }
```

## Dashboard ↔ hub messages

Owners authenticate with the session cookie: `{ "type": "hello", "role": "owner" }`. Viewers send `{ "type": "hello", "role": "viewer", "token": "<viewer token from link>" }` and can send nothing else.

On `hello` the hub replies with `state.snapshot`, then streams `device.update`, `device.removed`, `frame`, `step`, `run.update`, `approval.request`, `approval.resolved`, `research.update`.

Owner commands: `run.create {clientRunId, prompt}` (idempotent by `clientRunId`), `pair.start`, `devicecode.approve {userCode, name?}`, `devicecode.deny {userCode}`, `device.revoke {deviceId}`, `viewer.create {ttlMinutes?}` → `viewer.link`, `share.request {runId, target}` → `approval.request`, `approval.respond {approvalId, approve}`, and Research Mode: `research.capture {app}`, `research.label {captureId, deals}`, `research.propose`, `research.feedback {experimentId, kind, text}`.

## Capabilities

`web` or `app:<id>` where id is one of `tims`, `mcdonalds`, `popeyes`, `whatsapp`. The Android app reports only apps that are installed on the phone.

## Kotlin mirror (for `android/`)

Mirror only what the Android app sends or receives: `Hello`, `Telemetry`, `AgentConfig`, `UiNode`, `ProxyAction` (sealed class with `@JsonClassDiscriminator("kind")`), `Evidence`, the `DeviceToHub` messages (sealed class with `@JsonClassDiscriminator("type")`), the `HubToDevice` messages, `PairRequest`, `PairResponse`. Put them in `android/app/src/main/java/.../protocol/Protocol.kt`.
