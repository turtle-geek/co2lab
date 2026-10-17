// DEV-ONLY mock hub. Loaded only when `import.meta.env.DEV` and the URL has `?mock=1`
// (see main.tsx), so production builds never include it.
// It emits schema-valid HubToClient messages (checked with zod before sending) so the
// dashboard can be built and verified before the real hub exists. Every frame it draws
// carries a "MOCK" watermark.

import {
  ClientToHub,
  HubToClient,
  type PendingDevice,
  pairingQrPayload,
  type Burn,
  type DeviceState,
  type DeviceView,
  type RankedDeal,
  type RunView,
  type SubtaskView,
} from "@co2lab/shared";
import type { SocketLike } from "../net/connection";
import type { Backend } from "../net/backend";
import { MockPanel } from "./MockPanel";

type Role = "owner" | "viewer";

const LOGIN_KEY = "co2lab.mock.loggedIn";
const PASSPHRASE = "demo";

interface Script {
  label: string;
  steps: string[];
  deals: Omit<RankedDeal, "rank" | "reason" | "deviceId">[];
}

const SCRIPTS: Record<string, Script> = {
  "app:tims": {
    label: "Tim Hortons",
    steps: ["Opening Tim Hortons", "Dismissed popup", "Opened Offers tab", "Screenshot 1 of 2", "Scrolled offers", "Screenshot 2 of 2", "Extracting deals"],
    deals: [
      { source: "tims", title: "$1 any size coffee", priceText: "$1.00", conditions: "Tims Rewards members, before 11 am", expiresText: "Today", url: null, screenshotRef: null, confidence: 0.92 },
      { source: "tims", title: "Free donut with any drink", priceText: "Free", conditions: "Scan at checkout", expiresText: "Oct 20", url: null, screenshotRef: null, confidence: 0.81 },
    ],
  },
  "app:mcdonalds": {
    label: "McDonald's",
    steps: ["Opening McDonald's", "Opened Deals", "Screenshot 1 of 3", "Scrolled deals", "Screenshot 2 of 3", "Screenshot 3 of 3", "Extracting deals"],
    deals: [
      { source: "mcdonalds", title: "Free medium fries with $1 purchase", priceText: "$1 min.", conditions: "Once per day, in app", expiresText: "Oct 19", url: null, screenshotRef: null, confidence: 0.95 },
      { source: "mcdonalds", title: "2 for $6 McChicken + small fries", priceText: "$6.00", conditions: "In app only", expiresText: "Oct 31", url: null, screenshotRef: null, confidence: 0.88 },
    ],
  },
  "app:popeyes": {
    label: "Popeyes",
    steps: ["Opening Popeyes", "Opened Offers", "Screenshot 1 of 2", "Scrolled offers", "Screenshot 2 of 2", "Extracting deals"],
    deals: [
      { source: "popeyes", title: "2 chicken sandwiches for $7", priceText: "$7.00", conditions: "Pickup orders in app", expiresText: "Oct 22", url: null, screenshotRef: null, confidence: 0.9 },
    ],
  },
  web: {
    label: "RedFlagDeals",
    steps: ["Opening forums.redflagdeals.com", "Opened Hot Deals", "Searching 'Scarborough food'", "Loading results", "Reading thread 1 of 4", "Scrolling thread 1", "Reading thread 2 of 4", "Scrolling thread 2", "Reading thread 3 of 4", "Reading thread 4 of 4", "Checking expiry dates", "Extracting deals"],
    deals: [
      { source: "redflagdeals", title: "Pizza Pizza large 1-topping $9.99", priceText: "$9.99", conditions: "Pickup, code 9999", expiresText: null, url: "https://forums.redflagdeals.com/", screenshotRef: null, confidence: 0.74 },
    ],
  },
};

const BRAND: Record<string, string> = {
  "app:tims": "#c8102e",
  "app:mcdonalds": "#da291c",
  "app:popeyes": "#f26722",
  web: "#b5121b",
};

interface SubtaskSim {
  view: SubtaskView;
  stepIndex: number;
  willFailAt: number | null;
}

interface RunSim {
  view: RunView;
  subtasks: SubtaskSim[];
  collected: { deal: Script["deals"][number]; deviceId: string }[];
}

export class MockHub {
  private sockets = new Set<MockSocket>();
  devices = new Map<string, DeviceView>();
  private forced = new Map<string, DeviceState>();
  private runs: RunSim[] = [];
  private approvals: { id: string; message: string; target: string; runId: string | null; createdAt: number }[] = [];
  private seq = 1;
  /** While > now, new sockets fail to connect (simulates hub/network loss). */
  downUntil = 0;
  pairCode: string | null = null;
  /** Computers waiting for approval (device-code pairing). */
  pendingDevices: PendingDevice[] = [];
  listeners = new Set<() => void>();

  constructor() {
    const now = Date.now();
    this.addDevice({ id: "dev-a54", name: "Galaxy A54", kind: "android", capabilities: ["app:tims", "app:mcdonalds", "app:popeyes", "app:whatsapp"], state: "idle", telemetry: { batteryPct: 82, charging: true, tempC: 31, cpuPct: 12 }, lastSeenAt: now, currentTask: null, note: null });
    this.addDevice({ id: "dev-dragonfly", name: "Dragonfly", kind: "laptop", capabilities: ["web"], state: "idle", telemetry: { batteryPct: 67, charging: false, tempC: 35, cpuPct: 18 }, lastSeenAt: now, currentTask: null, note: null });
    this.addDevice({ id: "dev-cloud", name: "Cloud worker", kind: "cloud", capabilities: ["web"], state: "idle", telemetry: { batteryPct: null, charging: null, tempC: null, cpuPct: 4 }, lastSeenAt: now, currentTask: null, note: null });
    setInterval(() => this.heartbeat(), 2000);
    setInterval(() => this.work(), 1000);
  }

  private addDevice(d: DeviceView) {
    this.devices.set(d.id, d);
  }

  private id(prefix: string) {
    return `${prefix}-${(this.seq++).toString().padStart(3, "0")}`;
  }

  notify() {
    for (const l of this.listeners) l();
  }

  // ---------- transport ----------

  connect(sock: MockSocket) {
    this.sockets.add(sock);
  }
  disconnect(sock: MockSocket) {
    this.sockets.delete(sock);
  }

  private sendTo(sock: MockSocket, msg: HubToClient) {
    const checked = HubToClient.safeParse(msg);
    if (!checked.success) {
      console.error("[mock hub] produced an invalid message", msg, checked.error.issues);
      return;
    }
    sock.deliver(JSON.stringify(msg));
  }

  private broadcast(msg: HubToClient) {
    for (const s of this.sockets) if (s.role) this.sendTo(s, msg);
  }

  /** Drop every socket and refuse reconnects for `ms`. */
  dropConnections(ms: number) {
    this.downUntil = Date.now() + ms;
    for (const s of [...this.sockets]) s.serverClose(1006, "mock network loss");
    this.notify();
  }

  handle(sock: MockSocket, raw: string) {
    const parsed = ClientToHub.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      this.sendTo(sock, { type: "error", code: "bad_message", message: parsed.error.message });
      return;
    }
    const msg = parsed.data;
    if (msg.type === "hello") {
      if (msg.role === "device") return sock.serverClose(4001, "devices not mocked");
      if (msg.role === "owner" && sessionStorage.getItem(LOGIN_KEY) !== "1") return sock.serverClose(4001, "login required");
      if (msg.role === "viewer" && (!msg.token || msg.token === "expired")) return sock.serverClose(4001, "link expired");
      sock.role = msg.role;
      this.sendTo(sock, this.snapshot(msg.role));
      if (msg.role === "owner") this.sendTo(sock, this.deviceCodeList());
      return;
    }
    if (sock.role !== "owner") return; // viewers can only say hello
    switch (msg.type) {
      case "run.create":
        return this.createRun(msg.clientRunId, msg.prompt);
      case "pair.start": {
        this.pairCode = String(Math.floor(100000 + Math.random() * 900000));
        this.sendTo(sock, { type: "pair.code", code: this.pairCode, qrPayload: pairingQrPayload(location.origin, this.pairCode), expiresAt: Date.now() + 5 * 60_000 });
        this.notify();
        return;
      }
      case "devicecode.approve": {
        const p = this.pendingDevices.find((x) => x.userCode === msg.userCode);
        if (!p) return this.sendTo(sock, { type: "error", code: "devicecode_not_found", message: "no pending device with that code" });
        this.pendingDevices = this.pendingDevices.filter((x) => x !== p);
        const id = this.id("dev");
        this.addDevice({ id, name: msg.name ?? p.name, kind: p.kind, capabilities: p.capabilities, state: "idle", telemetry: { batteryPct: p.info.hasBattery ? 71 : null, charging: p.info.hasBattery ? true : null, tempC: 40, cpuPct: 9 }, lastSeenAt: Date.now(), currentTask: null, note: null });
        this.pushDevice(id);
        this.broadcastOwners(this.deviceCodeList());
        this.notify();
        return;
      }
      case "devicecode.deny":
        this.pendingDevices = this.pendingDevices.filter((x) => x.userCode !== msg.userCode);
        this.broadcastOwners(this.deviceCodeList());
        this.notify();
        return;
      case "device.revoke":
        return this.revoke(msg.deviceId);
      case "viewer.create": {
        const token = `v-${Math.random().toString(36).slice(2, 12)}`;
        this.sendTo(sock, { type: "viewer.link", url: `${location.origin}/?mock=1&viewer=${token}`, expiresAt: Date.now() + (msg.ttlMinutes ?? 120) * 60_000 });
        return;
      }
      case "share.request": {
        const run = this.runs.find((r) => r.view.id === msg.runId);
        const lines = (run?.view.ranked ?? []).slice(0, 5).map((d) => `${d.rank}. ${d.title}${d.priceText ? ` (${d.priceText})` : ""}`);
        const approval = { id: this.id("appr"), kind: "whatsapp-send" as const, message: `Lunch deals near UTSC today:\n${lines.join("\n")}`, target: msg.target, runId: msg.runId, createdAt: Date.now() };
        this.approvals.push(approval);
        this.broadcast({ type: "approval.request", approval });
        return;
      }
      case "approval.respond": {
        this.approvals = this.approvals.filter((a) => a.id !== msg.approvalId);
        this.broadcast({ type: "approval.resolved", approvalId: msg.approvalId, approved: msg.approve });
        return;
      }
      default:
        return;
    }
  }

  private snapshot(role: Role): HubToClient {
    return {
      type: "state.snapshot",
      role,
      devices: [...this.devices.values()],
      runs: this.runs.map((r) => r.view),
      approvals: this.approvals.map((a) => ({ ...a, kind: "whatsapp-send" as const })),
      experiments: [],
      defaultConfig: { model: "flash", screenshotScale: 0.5, mode: "recipe" },
    };
  }

  // ---------- devices ----------

  private pushDevice(id: string) {
    const d = this.devices.get(id);
    if (d) this.broadcast({ type: "device.update", device: d });
  }

  private patch(id: string, p: Partial<DeviceView>) {
    const d = this.devices.get(id);
    if (!d) return;
    this.devices.set(id, { ...d, ...p });
    this.pushDevice(id);
    this.notify();
  }

  private online(id: string) {
    const d = this.devices.get(id);
    return !!d && d.state !== "offline" && d.state !== "revoked";
  }

  private heartbeat() {
    for (const d of this.devices.values()) {
      if (!this.online(d.id) || !d.telemetry) continue;
      const t = d.telemetry;
      const working = d.state === "working";
      const forced = this.forced.get(d.id);
      const tempBase = forced === "hot" ? 43.5 : working ? 36 : 31;
      this.devices.set(d.id, {
        ...d,
        lastSeenAt: Date.now(),
        telemetry: {
          ...t,
          batteryPct: t.batteryPct === null ? null : forced === "resting" ? 14 : Math.max(5, Math.min(100, t.batteryPct + (t.charging ? 0.2 : -0.1))),
          tempC: t.tempC === null ? null : Math.round((tempBase + Math.random() * 1.5) * 10) / 10,
          cpuPct: Math.round((working ? 55 : 8) + Math.random() * 15),
        },
      });
      this.pushDevice(d.id);
    }
  }

  /** Mood testing from the dev panel. "auto" clears the override. */
  forceState(id: string, state: DeviceState | "auto") {
    const d = this.devices.get(id);
    if (!d) return;
    if (state === "auto") {
      this.forced.delete(id);
      const t = d.telemetry;
      this.patch(id, {
        state: this.busySubtask(id) ? "working" : "idle",
        note: null,
        lastSeenAt: Date.now(),
        telemetry: t && t.batteryPct !== null ? { ...t, batteryPct: Math.max(t.batteryPct, 60), tempC: 31 } : t,
      });
      return;
    }
    this.forced.set(id, state);
    const notes: Partial<Record<DeviceState, string>> = {
      resting: `Battery low, plug in ${d.name}`,
      hot: "Too warm (≥ 42 °C), pausing after this task",
      error: "Popeyes shows a sign-in screen",
    };
    const t = d.telemetry;
    this.patch(id, {
      state,
      note: notes[state] ?? null,
      lastSeenAt: state === "offline" ? Date.now() : d.lastSeenAt,
      telemetry:
        t && state === "resting" ? { ...t, batteryPct: 14, charging: false } : t && state === "hot" ? { ...t, tempC: 43.5 } : t,
    });
    if (state === "offline") this.requeueFrom(id);
  }

  /** The demo moment: laptop lid closes, its web subtask moves to the Cloud worker. */
  toggleLid(id = "dev-dragonfly") {
    if (this.devices.get(id)?.state === "offline") return this.forceState(id, "auto");
    this.forced.set(id, "offline");
    this.patch(id, { state: "offline", currentTask: null, note: null, lastSeenAt: Date.now() - 6000 });
    this.requeueFrom(id);
  }

  private deviceCodeList(): HubToClient {
    return { type: "devicecode.list", hubUrl: location.origin, pending: this.pendingDevices };
  }

  private broadcastOwners(msg: HubToClient) {
    for (const s of this.sockets) if (s.role === "owner") this.sendTo(s, msg);
  }

  /** A computer ran the install one-liner and is waiting for approval. */
  requestJoin() {
    const letters = "BCDFGHJKLMNPQRSTVWXZ";
    const pick = () => Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
    const now = Date.now();
    this.pendingDevices.push({
      userCode: `${pick()}-${pick()}`,
      name: "Old ThinkPad",
      kind: "laptop",
      capabilities: ["web"],
      info: { hostname: "THINKPAD-T480", os: "Microsoft Windows 10 Home 10.0.19045", arch: "x64", model: "Lenovo ThinkPad T480", cpu: "Intel Core i5-8250U (8 threads)", ramGb: 8, hasBattery: true, browser: "Microsoft Edge" },
      ip: "203.0.113.7",
      createdAt: now,
      expiresAt: now + 10 * 60_000,
    });
    this.broadcastOwners(this.deviceCodeList());
    this.notify();
  }

  pairDevice() {
    if (!this.pairCode) return;
    this.pairCode = null;
    const id = this.id("dev");
    this.addDevice({ id, name: "Pixel 4", kind: "android", capabilities: ["app:tims", "app:mcdonalds"], state: "idle", telemetry: { batteryPct: 54, charging: true, tempC: 29, cpuPct: 5 }, lastSeenAt: Date.now(), currentTask: null, note: null });
    this.pushDevice(id);
    this.notify();
  }

  private revoke(id: string) {
    this.forced.set(id, "revoked");
    this.patch(id, { state: "revoked", currentTask: null, note: "Access revoked" });
    this.requeueFrom(id);
    setTimeout(() => {
      this.devices.delete(id);
      this.forced.delete(id);
      this.broadcast({ type: "device.removed", deviceId: id });
      this.notify();
    }, 2500);
  }

  // ---------- runs ----------

  private createRun(clientRunId: string, prompt: string) {
    const existing = this.runs.find((r) => r.view.clientRunId === clientRunId);
    if (existing) return this.broadcast({ type: "run.update", run: existing.view });
    const run: RunSim = {
      view: { id: this.id("run"), clientRunId, prompt, status: "planning", subtasks: [], ranked: null, burn: zeroBurn(), error: null, createdAt: Date.now(), finishedAt: null },
      subtasks: [],
      collected: [],
    };
    this.runs.push(run);
    this.pushRun(run);
    const failPopeyes = /fail/i.test(prompt);
    setTimeout(() => {
      addBurn(run.view.burn, 820, 140);
      run.subtasks = Object.entries(SCRIPTS).map(([cap, s]) => ({
        view: { id: this.id("sub"), capability: cap, goal: `Collect current offers from ${s.label}`, status: "queued", deviceId: null, attempt: 1, error: null, dealCount: 0 },
        stepIndex: 0,
        willFailAt: failPopeyes && cap === "app:popeyes" ? 2 : null,
      }));
      run.view.status = "running";
      this.schedule();
      this.pushRun(run);
    }, 1500);
  }

  private pushRun(run: RunSim) {
    run.view = { ...run.view, subtasks: run.subtasks.map((s) => ({ ...s.view })), burn: { ...run.view.burn } };
    this.broadcast({ type: "run.update", run: run.view });
    this.notify();
  }

  private busySubtask(deviceId: string): SubtaskSim | undefined {
    for (const r of this.runs) for (const s of r.subtasks) if (s.view.status === "running" && s.view.deviceId === deviceId) return s;
    return undefined;
  }

  private canTake(d: DeviceView, cap: string) {
    if (!this.online(d.id)) return false;
    if (d.state === "resting" || d.state === "hot" || d.state === "error") return false;
    if (this.busySubtask(d.id)) return false;
    return d.capabilities.includes(cap);
  }

  private schedule() {
    for (const run of this.runs) {
      if (run.view.status !== "running") continue;
      for (const s of run.subtasks) {
        if (s.view.status !== "queued") continue;
        const order = [...this.devices.values()].sort((a, b) => (a.kind === "cloud" ? 1 : 0) - (b.kind === "cloud" ? 1 : 0));
        const dev = order.find((d) => this.canTake(d, s.view.capability));
        if (!dev) {
          const anyone = [...this.devices.values()].some((d) => d.capabilities.includes(s.view.capability));
          if (!anyone) {
            s.view.status = "failed";
            s.view.error = `no device can run ${s.view.capability}`;
          }
          continue;
        }
        s.view.status = "running";
        s.view.deviceId = dev.id;
        s.stepIndex = 0;
        this.patch(dev.id, { state: "working", currentTask: { subtaskId: s.view.id, capability: s.view.capability, label: SCRIPTS[s.view.capability]!.label, progress: 0 } });
      }
      this.pushRun(run);
    }
  }

  private requeueFrom(deviceId: string) {
    for (const run of this.runs) {
      let changed = false;
      for (const s of run.subtasks) {
        if (s.view.status === "running" && s.view.deviceId === deviceId) {
          s.view.status = "queued";
          s.view.deviceId = null;
          s.view.attempt += 1;
          changed = true;
        }
      }
      if (changed) this.pushRun(run);
    }
    setTimeout(() => this.schedule(), 800);
  }

  private work() {
    for (const run of this.runs) {
      if (run.view.status !== "running") continue;
      let changed = false;
      for (const s of run.subtasks) {
        if (s.view.status !== "running" || !s.view.deviceId) continue;
        const dev = this.devices.get(s.view.deviceId);
        if (!dev || !this.online(dev.id)) continue;
        const script = SCRIPTS[s.view.capability]!;
        const text = script.steps[s.stepIndex] ?? "Finishing";
        const progress = Math.min(1, (s.stepIndex + 1) / script.steps.length);
        const now = Date.now();
        this.broadcast({ type: "step", deviceId: dev.id, subtaskId: s.view.id, kind: text.startsWith("Screenshot") ? "screenshot" : text.startsWith("Extract") ? "extract" : "recipe", text, at: now });
        const frame = drawFrame(dev.kind, s.view.capability, script.label, text, s.stepIndex);
        this.broadcast({ type: "frame", deviceId: dev.id, subtaskId: s.view.id, ...frame, at: now });
        addBurn(run.view.burn, 240 + Math.round(Math.random() * 300), 35);
        changed = true;

        if (s.willFailAt !== null && s.stepIndex >= s.willFailAt) {
          const reason = `${script.label} shows a sign-in screen on ${dev.name}`;
          s.view.status = "failed";
          s.view.error = reason;
          this.patch(dev.id, { state: "error", currentTask: null, note: reason });
          setTimeout(() => {
            if (this.forced.has(dev.id)) return;
            this.patch(dev.id, { state: "idle", note: null });
            this.schedule();
          }, 4000);
          continue;
        }
        s.stepIndex += 1;
        if (s.stepIndex >= script.steps.length) {
          s.view.status = "done";
          s.view.dealCount = script.deals.length;
          for (const deal of script.deals) run.collected.push({ deal, deviceId: dev.id });
          this.patch(dev.id, { state: this.forced.get(dev.id) ?? "idle", currentTask: null });
          this.schedule();
        } else {
          this.patch(dev.id, { currentTask: { subtaskId: s.view.id, capability: s.view.capability, label: script.label, progress } });
        }
      }
      if (changed) this.pushRun(run);
      if (run.subtasks.length && run.subtasks.every((s) => s.view.status === "done" || s.view.status === "failed")) this.merge(run);
    }
  }

  private merge(run: RunSim) {
    if (!run.subtasks.some((s) => s.view.status === "done")) {
      run.view.status = "failed";
      run.view.error = "Every subtask failed";
      run.view.finishedAt = Date.now();
      this.pushRun(run);
      return;
    }
    run.view.status = "merging";
    this.pushRun(run);
    setTimeout(() => {
      addBurn(run.view.burn, 1900, 420);
      const sorted = [...run.collected].sort((a, b) => b.deal.confidence - a.deal.confidence);
      run.view.ranked = sorted.map((c, i) => ({ ...c.deal, rank: i + 1, reason: i === 0 ? "Biggest saving for lunch today" : "Good value near UTSC", deviceId: c.deviceId }));
      run.view.status = "done";
      run.view.finishedAt = Date.now();
      this.pushRun(run);
    }, 1800);
  }
}

function zeroBurn(): Burn {
  return { tokensIn: 0, tokensOut: 0, costUsd: 0, energyWh: 0, gCo2: 0 };
}

function addBurn(b: Burn, tokensIn: number, tokensOut: number) {
  b.tokensIn += tokensIn;
  b.tokensOut += tokensOut;
  b.costUsd = Math.round((b.tokensIn * 0.1e-6 + b.tokensOut * 0.4e-6) * 1e6) / 1e6;
  b.energyWh = Math.round((b.tokensIn + b.tokensOut) * 0.0003 * 1000) / 1000;
  b.gCo2 = Math.round(b.energyWh * 0.13 * 1000) / 1000;
}

function drawFrame(kind: string, cap: string, label: string, text: string, step: number) {
  const phone = kind === "android";
  const w = phone ? 360 : 640;
  const h = phone ? 760 : 400;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fafafa";
  g.fillRect(0, 0, w, h);
  g.fillStyle = BRAND[cap] ?? "#555";
  g.fillRect(0, 0, w, phone ? 110 : 64);
  g.fillStyle = "#fff";
  g.font = `bold ${phone ? 30 : 26}px sans-serif`;
  g.fillText(label, 20, phone ? 70 : 42);
  for (let i = 0; i < 5; i++) {
    const y = (phone ? 140 : 84) + i * (phone ? 120 : 62) - ((step * 30) % 60);
    g.fillStyle = "#e8e2d6";
    g.fillRect(16, y, w - 32, phone ? 100 : 50);
    g.fillStyle = "#333";
    g.font = "18px sans-serif";
    g.fillText(`Offer ${i + 1 + step}`, 32, y + 32);
  }
  g.fillStyle = "rgba(0,0,0,0.65)";
  g.fillRect(0, h - 56, w, 56);
  g.fillStyle = "#fff";
  g.font = "18px sans-serif";
  g.fillText(text, 16, h - 22);
  g.save();
  g.translate(w / 2, h / 2);
  g.rotate(-0.4);
  g.fillStyle = "rgba(200,0,0,0.18)";
  g.font = "bold 72px sans-serif";
  g.textAlign = "center";
  g.fillText("MOCK", 0, 0);
  g.restore();
  const url = c.toDataURL("image/jpeg", 0.6);
  return { jpegBase64: url.slice(url.indexOf(",") + 1), width: w, height: h };
}

class MockSocket implements SocketLike {
  readyState = 0;
  role: Role | null = null;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  constructor(private hub: MockHub) {
    setTimeout(() => {
      if (Date.now() < hub.downUntil) return this.serverClose(1006, "mock hub unreachable");
      this.readyState = 1;
      hub.connect(this);
      this.onopen?.(new Event("open"));
    }, 120);
  }

  send(data: string) {
    if (this.readyState !== 1) return;
    setTimeout(() => this.hub.handle(this, data), 30);
  }

  deliver(data: string) {
    if (this.readyState !== 1) return;
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  close(code = 1000) {
    this.serverClose(code, "client closed");
  }

  serverClose(code: number, reason: string) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.hub.disconnect(this);
    this.onclose?.(new CloseEvent("close", { code, reason }));
  }
}

export const mockHub = new MockHub();

export const mockBackend: Backend = {
  socketFactory: () => new MockSocket(mockHub),
  async login(passphrase) {
    await new Promise((r) => setTimeout(r, 300));
    if (passphrase !== PASSPHRASE) return "wrong";
    sessionStorage.setItem(LOGIN_KEY, "1");
    return "ok";
  },
  async logout() {
    sessionStorage.removeItem(LOGIN_KEY);
  },
  DevPanel: MockPanel,
};
