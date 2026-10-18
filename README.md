# CO₂LAB

Run your personal AI agents on the old devices in your drawer instead of new hardware that adds to CO₂ emissions.

A solo project built at Hack the Valley 2026. [Live site](https://co2lab.work)

## Overview

An always-on agent needs a machine that stays on. Buying one costs money and adds manufacturing emissions. Running it on your daily phone wears out its battery.

CO₂LAB uses the devices you already retired instead: any Android 11+ phone and any Windows, macOS or Linux computer. A hub plans each request with Gemini and sends the work to whichever old device can do it, with a cloud worker as backup. The dashboard shows each request's CO₂e, and the Lab tests cheaper ways to run the agents.

## How a request runs

1. Each device connects to the hub and reports its skills (apps, browser, Steam games), battery and temperature.
2. Gemini reads those reports and splits the request into tasks.
3. The scheduler gives each task to a device that can do it. Hot or offline devices are skipped.
4. The phone works inside apps through the Accessibility Service. The laptop and cloud worker drive a browser with Playwright.
5. When a step needs judgement, the device sends its screen to the hub and Gemini picks the next action.
6. Gemini combines what the devices found into one answer. Every call is logged in Tiger Data.

## Models

- **Flash** plans requests and writes answers. If it is out of quota, the hub tries the older Flash models in `GEMINI_MODEL_FLASH_BACKUPS`, then Flash-Lite.
- **Flash-Lite** steers the devices and reads screens. The Lab found it as accurate as Flash on the deal screens at a quarter of the cost.
- All calls use one API key and go through the hub. Devices never hold a key.

## Features

- **App agent on Android:** opens Tim Hortons, McDonald's and Popeyes through the Accessibility Service and screenshots their offers.
- **Web agent:** Playwright browses sites such as RedFlagDeals on a laptop or the cloud worker.
- **General requests:** the planner reads what each device has (installed apps, Steam games, browser) and picks tasks to match.
- **Health-aware scheduling:** work moves off a device that goes offline. Devices pause at 90 °C (laptop CPU) or 42 °C (phone battery).
- **Burn meter:** each request shows its CO₂e, the old devices that worked on it, and the AI cost.
- **Lab, Impact:** every Gemini call from Tiger Data, broken down by step and device. Click a request to see only its calls.
- **Lab, Research:** cites papers from Papiers, runs trials on labelled screenshots and saves findings. You can type your own idea to test.
- **Compute jobs:** Steam review analysis split into batches across devices.

## Architecture

```
 Android phone (Kotlin)        Laptop / cloud worker (Node + Playwright)
 Accessibility Service          browser agent, review batches
          \                         /
           \   WebSocket (zod)     /
            v                     v
        Hub (Node, Fastify, ws) on Vultr behind Caddy
        planner, scheduler, health engine, research loop
          |              |                 |
     Gemini API     Tiger Data         Papiers CLI
                (Postgres + Timescale)  (read-only)
          |
          v
 Dashboard (React PWA): devices, agent runs, live screens, Lab
```

- **Frontend:** React 19, Vite, vite-plugin-pwa
- **Backend:** Node 24, TypeScript, Fastify, ws, zod, `@google/genai`, pg
- **Devices:** Kotlin Android app (OkHttp), Node worker with Playwright and Transformers.js
- **Services:** Gemini API, Tiger Data, Papiers, Vultr with Caddy and systemd

## Getting started

### Prerequisites

- Node.js 22 or newer
- A Gemini API key from Google AI Studio
- Optional: a Tiger Data (Postgres) database. Without `DATABASE_URL` the hub keeps state in memory.
- Optional: a Papiers token for the research loop
- Optional: Android Studio to build the phone app

### Setup

```bash
git clone https://github.com/turtle-geek/co2lab.git
cd co2lab
cp .env.example .env   # then fill in your keys
npm install
npm run dev -w hub
npm run dev -w dashboard
```

Open http://localhost:5173 and log in with your `OWNER_PASSPHRASE`. To try the dashboard without devices, open http://localhost:5173/?mock=1 (passphrase `demo`).

Add a laptop from the dashboard with **Add device**, or from the repo:

```bash
npm run pair -w worker-web
npm run start -w worker-web
```

Build the Android app with Android Studio, or from `android/` with `./gradlew assembleDebug`. Pair it with the QR code from **Add device**.

### Environment variables

| Variable | What it is for |
| --- | --- |
| `GEMINI_API_KEY` | The one Gemini key the hub uses |
| `GEMINI_MODEL_LITE`, `GEMINI_MODEL_FLASH`, `GEMINI_MODEL_PRO` | Model IDs for each tier |
| `GEMINI_MODEL_FLASH_BACKUPS` | Older Flash models to try, in order, when Flash is out of quota |
| `OWNER_PASSPHRASE` | Dashboard login |
| `SESSION_SECRET` | Signs the login cookie (32+ characters) |
| `DATABASE_URL`, `DATABASE_PASSWORD` | Tiger Data connection. Leave empty to run in memory |
| `PAPIERS_TOKEN` | Read access to your Papiers library for Lab research |
| `HUB_PUBLIC_URL`, `HUB_PORT` | Public address and port of the hub |
| `WORKER_HUB_URL` | Hub address for a worker run from the repo |
| `VULTR_SERVER_IP`, `HUB_DOMAIN` | Used by `deploy/` scripts. `HUB_DOMAIN` is the public name, for example `co2lab.work` |

### Deploy

```bash
bash setup-server.sh <hub-domain>   # once, as root on a fresh Ubuntu 24.04 server
bash deploy/deploy.sh         # ships pushed code; add --env to upload .env
```

## API

| Method | Endpoint | What it does |
| --- | --- | --- |
| `POST` | `/api/login` | Owner login, sets the session cookie |
| `POST` | `/api/device-code` | A computer asks to join |
| `GET` | `/api/impact` | Gemini usage by step, device and request |
| `GET` | `/api/research` | Lab captures and findings |
| `GET` | `/api/devices/:id/telemetry` | A device's battery and temperature history |
| `GET` | `/api/health` | Hub status |
| `WS` | `/ws` | Devices and dashboards. Messages are defined in `shared/src/protocol.ts` |

## Project structure

```
hub/         Node hub: planner, scheduler, Gemini, research loop, API
dashboard/   React PWA
worker-web/  Laptop and cloud worker (Playwright, review batches)
android/     Kotlin phone agent
shared/      zod message contract used by every part
db/          Tiger Data schema
deploy/      Vultr setup, Caddy and systemd files
```
