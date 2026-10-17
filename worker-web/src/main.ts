// npm start                 -> headed Chromium on the laptop (judges see the browser)
// npm start -- --cloud      -> headless, for the Vultr "Cloud worker"
// Other flags: --device-file <path>, --headless / --headed, --evidence-images

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { HEARTBEAT_MS, type HubToDevice } from "@co2lab/shared";
import { parseArgs, deviceFilePath, readDeviceFile, log } from "./config.js";
import { TelemetrySampler } from "./telemetry.js";
import { HubClient } from "./hub-client.js";
import { WebTask, VIEWPORT } from "./web-task.js";
import { blankHtml } from "./reader-view.js";

const args = parseArgs();
const cloud = args.has("cloud");
const headless = args.has("headless") || (cloud && !args.has("headed"));
const device = readDeviceFile(deviceFilePath(args.str("device-file")));
const taskOpts = {
  threads: Number(process.env.WORKER_THREADS ?? 5),
  dwellMs: Number(process.env.WORKER_DWELL_MS ?? 3_000),
  evidenceImages: args.has("evidence-images"),
};

log(`Co2lab web worker "${device.name}" (${device.kind}, ${headless ? "headless" : "headed"})`);

const browser: Browser = await chromium.launch({
  headless,
  args: headless ? [] : [`--window-size=${VIEWPORT.width + 20},${VIEWPORT.height + 120}`],
});
const ctx: BrowserContext = await browser.newContext({ viewport: VIEWPORT });
// A page that stays open while idle, so the headed window does not vanish between subtasks.
const idlePage: Page = await ctx.newPage();
await idlePage.setContent(blankHtml(`${device.name} · connecting to ${device.hubUrl}`));

const tasks = new Map<string, WebTask>();
const telemetry = new TelemetrySampler();
await telemetry.start(HEARTBEAT_MS);

const hub = new HubClient({
  hubUrl: device.hubUrl,
  token: device.token,
  telemetry: () => telemetry.current,
  runningSubtaskIds: () => [...tasks.keys()],
  onMessage,
  onFatal: (reason) => {
    log(reason);
    void shutdown(1);
  },
});
hub.connect();

function onMessage(msg: HubToDevice): void {
  switch (msg.type) {
    case "hello.ok":
      void idlePage.setContent(blankHtml(`${msg.name} · connected · waiting for a web subtask`)).catch(() => undefined);
      return;
    case "subtask.assign": {
      if (tasks.has(msg.subtaskId)) return; // duplicate assign after a reconnect
      if (msg.capability !== "web") {
        hub.send({ type: "subtask.failed", subtaskId: msg.subtaskId, reason: `This web worker cannot run ${msg.capability}` });
        return;
      }
      log(`[${msg.subtaskId}] assigned: ${msg.goal}`);
      const task = new WebTask(ctx, msg, (m) => hub.send(m), taskOpts);
      tasks.set(msg.subtaskId, task);
      void task.run().finally(() => tasks.delete(msg.subtaskId));
      return;
    }
    case "subtask.cancel": {
      const task = tasks.get(msg.subtaskId);
      task?.cancel();
      tasks.delete(msg.subtaskId);
      return;
    }
    case "error":
      log(`Hub error ${msg.code}: ${msg.message}`);
      return;
    case "proxy.action":
      return; // Android only
  }
}

let shuttingDown = false;
async function shutdown(code = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log("Shutting down");
  for (const t of tasks.values()) t.cancel();
  hub.close();
  telemetry.stop();
  await browser.close().catch(() => undefined);
  process.exit(code);
}
process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));
browser.on("disconnected", () => {
  if (!shuttingDown) {
    log("Browser closed");
    void shutdown(1);
  }
});
