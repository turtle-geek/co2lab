# T8 app spike: Galaxy A54

Goal: before writing the Android agent, prove each app works with it. For each app: package name, the path to the deals screen (visible button texts), whether screenshots work (not black), and whether you are signed in.

Device: Samsung Galaxy A54 5G, Android version: _fill in_, One UI: _fill in_

## Results

| App | Package | Signed in | Screenshot OK | Path to deals (button texts) | Deal list scrolls? | Notes |
|---|---|---|---|---|---|---|
| Tim Hortons | `digital.rbi.timhortons` | Yes | Yes | `Offers` | Yes (2 screens, 5 offers) | Recipe verified 2026-10-17 |
| McDonald's | `com.mcdonalds.superapp` | Yes | Yes | `Rewards&Offers` → `Offers` | Yes (2 screens, 4 offers) | Needs location permission, else "Turn on location services to see available offers". UI tree hidden unless the service sets `isAccessibilityTool` (see below) |
| Popeyes | `com.emn8.mobilem8.nativeapp.plkca` | Yes | Yes | `Offers` (bottom tab) | Yes (2 screens, 8 offers with prices) | Recipe verified 2026-10-17 |
| WhatsApp (stretch) | `com.whatsapp` | — | — | — | — | Installed; no recipe yet |

## How each column is checked

- **Package**: `adb shell pm list packages | findstr -i "tim mcdonald popeyes whatsapp"`
- **Screenshot OK**: on the deals screen, `adb exec-out screencap -p > docs/spike/<app>.png`. A black or blank image means the app blocks screenshots (secure flag), and the agent's screenshots would be black too.
- **Path to deals**: on each screen on the way to deals, `adb shell uiautomator dump /sdcard/ui.xml` then `adb pull /sdcard/ui.xml docs/spike/<app>-<step>.xml`. Record the `text` / `content-desc` of the button tapped. These become the recipe.
- **Signed in**: deals visible without a login prompt.

## Probe results (2026-10-16, no adb)

The probe app (`android/`, version `0.1-probe`) was installed by download through a temporary cloudflared tunnel to `tools/probe/server.mjs`. The phone was on UofT Wi-Fi, which blocks device-to-device traffic (adb wireless pairing failed), but the outgoing WebSocket to the tunnel worked.

| Check | Result |
|---|---|
| Install by APK download + enable accessibility | OK (restricted-setting prompt did not appear) |
| Outgoing WSS from campus Wi-Fi, `hello` + `hello.ok` | OK |
| Heartbeat telemetry (battery %, charging, temp) | OK: 90 %, not charging, 26.6 °C |
| List installed packages | OK. `com.whatsapp` present. **Tim Hortons, McDonald's, Popeyes not installed yet** |
| Launch another app from the background | OK (`com.android.settings`) |
| Accessibility screenshot (not blank) | OK, 540×1170 JPEG |
| Read UI tree (text, desc, clickable, bounds) | OK, 41 nodes on App info, 17 labels on Settings home |
| Tap by text (`clickText "Battery"`) | OK, opened Battery page |
| Scroll, back, home | OK |
| Live frame stream | OK, frame age ~240 ms |

Notes for T3:

- `launch` resumes the app's last screen. Recipes must start from a known screen: launch with `FLAG_ACTIVITY_CLEAR_TASK`, or press back until the app's home is detected.
- **Power saving is ON** on the A54. Turn it off (or confirm Co2lab is exempt) so the agent is not throttled while at home.
- One UI has **Battery protection** (charge limit): turn it on for the always-plugged-in story.

## T3 agent results (2026-10-17, build 0.6, no adb)

Tested against the fake hub in `tools/probe/server.mjs` through a cloudflared quick tunnel. Everything below happened on the real A54.

| Check | Result |
|---|---|
| Pair by typed hub URL + 6-digit code (`POST /api/pair`) | OK. Capabilities reported: `app:tims, app:mcdonalds, app:popeyes, app:whatsapp` (packages found on the phone by app name) |
| Pair by QR (in-app scanner, Google code scanner) | OK. The Samsung Camera does **not** open `co2lab://` links, so the app has its own "Scan pairing QR" button |
| Expired code / wrong path | Clear error shown ("This code has expired…"); a hub address with a path (`/pair`, `/apk`) is cut back to scheme + host |
| Token storage | AES-GCM with an Android Keystore key |
| Reconnect after app update and after tunnel loss | OK (1 → 10 s backoff; restarts after `MY_PACKAGE_REPLACED`) |
| Swipe Co2lab away from Recents | Foreground service and notification stay |
| Screen off for 200 s | 101 heartbeats, max gap 2.05 s (partial wake lock + Wi-Fi lock) |
| `subtask.assign` → recipe → `subtask.result` | OK for Tim Hortons, McDonald's, Popeyes (screenshots at `screenshotScale` 0.5 = 540×1170, plus accessibility text) |
| End of list detection | OK (stops when the screen text stops changing) |
| Recipe stuck → `proxy.request` / `proxy.action` | OK: tapXY, back, wait, fail, tapNode, scroll, done all executed |
| `mode: vision` | OK on Settings (scripted hub actions, then capture) |
| `subtask.cancel` mid-run | OK: nothing more sent, heartbeat `runningSubtaskIds` empties |
| Failure reasons | "Starbucks is not installed on Galaxy A54", "Galaxy A54 cannot run web", "McDonald's needs location to show offers…" |
| Sign-in screen detection | Not exercised (all apps signed in); texts are in `apps.json` |
| Black (secure) screenshot detection | Not exercised (no app blocks screenshots) |

Notes:

- **McDonald's hides its UI from accessibility services.** Without `android:isAccessibilityTool="true"` the agent saw only the root node and its taps were ignored (Android 14 `accessibilityDataSensitive`). With the flag the recipe works. Fine for a sideloaded app on the owner's phone; it would need review for Play Store distribution.
- McDonald's once showed a blank white screen after being launched by the agent; opening it once by hand fixed it. If it recurs, the recipe step times out and the hub proxy can send `wait`.
- Recipes live in `android/app/src/main/assets/apps.json`. While tuning, `tools/probe` can push an override without reinstalling: `POST /cmd {"cmd":"recipes","args":{"apps":{...}}}` (needs "Allow probe commands" on the phone).
- Demo setup: allow McDonald's location; turn Power saving off; turn on "Stay awake while charging" in Developer options so apps render with the screen on.

## Decision

Apps that pass all checks are used for the demo. Any that fail are listed here with the reason.
