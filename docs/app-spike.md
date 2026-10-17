# T8 app spike: Galaxy A54

Goal: before writing the Android agent, prove each app works with it. For each app: package name, the path to the deals screen (visible button texts), whether screenshots work (not black), and whether you are signed in.

Device: Samsung Galaxy A54 5G, Android version: _fill in_, One UI: _fill in_

## Results

| App | Package | Signed in | Screenshot OK | Path to deals (button texts) | Deal list scrolls? | Notes |
|---|---|---|---|---|---|---|
| Tim Hortons | | | | | | |
| McDonald's | | | | | | |
| Popeyes | | | | | | |
| WhatsApp (stretch) | | | | | | |

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

## Decision

Apps that pass all checks are used for the demo. Any that fail are listed here with the reason.
