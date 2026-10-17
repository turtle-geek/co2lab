// A general `web` subtask (SPEC §4.8): the browser agent loop. Each step the worker shows the hub
// a screenshot, the page text and the numbered clickable elements; the hub's Gemini proxy picks one
// action; the worker does it. When Gemini says "done", the pages' text and the last screenshots go
// back as evidence and the hub extracts the findings for the goal.

import type { BrowserContext, Page } from "playwright";
import { FRAME_INTERVAL_MS, type DeviceToHub, type HubToDevice, type ProxyAction, type StepKind, type UiNode } from "@co2lab/shared";
import { log } from "./config.js";
import { VIEWPORT, type Assign } from "./web-task.js";

const ACTION_TIMEOUT_MS = 60_000;
const MAX_ELEMENTS = 80;
const MAX_EVIDENCE_TEXT = 28_000;

class Cancelled extends Error {}

type Pending = { resolve: (a: ProxyAction) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

export class WebAgentTask {
  private cancelled = false;
  private page: Page | null = null;
  private pending = new Map<string, Pending>();
  private framing = false;

  constructor(
    private readonly ctx: BrowserContext,
    private readonly assign: Assign,
    private readonly send: (msg: DeviceToHub) => void,
  ) {}

  get id(): string {
    return this.assign.subtaskId;
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    for (const p of this.pending.values()) p.reject(new Cancelled());
    void this.page?.close().catch(() => undefined);
  }

  /** The hub's answer to one of our proxy.request messages. */
  onProxyAction(msg: Extract<HubToDevice, { type: "proxy.action" }>): boolean {
    const p = this.pending.get(msg.requestId);
    if (!p) return false;
    clearTimeout(p.timer);
    this.pending.delete(msg.requestId);
    p.resolve(msg.action);
    return true;
  }

  async run(): Promise<void> {
    const { subtaskId, goal } = this.assign;
    const spec = this.assign.agent!;
    const history: string[] = [];
    const visited = new Map<string, string>(); // url -> text seen there
    const shots: string[] = [];
    try {
      this.page = await this.ctx.newPage();
      await this.page.setViewportSize(VIEWPORT);
      void this.frameLoop();
      const start = spec.startUrl ?? `https://duckduckgo.com/html/?q=${encodeURIComponent(goal)}`;
      this.step("info", `Opening ${hostOf(start)}`, 0.03);
      await this.goto(start);

      for (let i = 0; i < spec.maxSteps; i++) {
        this.check();
        const page = this.page;
        const { nodes, text } = await this.observe();
        const shot = (await page.screenshot({ type: "jpeg", quality: 60, timeout: 5_000 })).toString("base64");
        shots.push(shot);
        if (shots.length > 3) shots.shift();
        visited.set(page.url(), text);

        const action = await this.ask({ goal, shot, nodes, history, url: page.url(), title: await page.title().catch(() => ""), text });
        this.check();
        if (action.kind === "done") {
          this.step("extract", "Found what the goal asked for", 0.95);
          break;
        }
        if (action.kind === "fail") throw new Error(action.reason);
        const label = describe(action, nodes);
        history.push(label);
        this.step("fallback", label, 0.1 + (0.8 * (i + 1)) / spec.maxSteps);
        await this.act(action);
        if (i === spec.maxSteps - 1) this.step("info", `Step limit (${spec.maxSteps}) reached; sending what was read`, 0.95);
      }

      const { text } = await this.observe().catch(() => ({ text: "" }));
      visited.set(this.page.url(), text);
      const evidenceText = [...visited.entries()]
        .map(([url, t]) => `## ${url}\n${t}`)
        .join("\n\n")
        .slice(0, MAX_EVIDENCE_TEXT);
      this.check();
      this.send({ type: "subtask.result", subtaskId, evidence: { images: shots, text: evidenceText } });
      log(`[${subtaskId}] agent result sent (${visited.size} page(s), ${evidenceText.length} chars)`);
    } catch (err) {
      if (this.cancelled || err instanceof Cancelled) return;
      const reason = (err as Error).message.split("\n")[0]!.slice(0, 300);
      log(`[${subtaskId}] agent failed: ${reason}`);
      this.send({ type: "subtask.failed", subtaskId, reason });
    } finally {
      this.cancelled = true;
      await this.page?.close().catch(() => undefined);
    }
  }

  // ---------- Observe / ask / act ----------

  /** Numbers the visible interactive elements (data-co2lab-id) and reads the visible text. */
  private async observe(): Promise<{ nodes: UiNode[]; text: string }> {
    const page = this.page!;
    const r = await page.evaluate((max) => {
      const vis = (el: Element) => {
        const b = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return b.width > 2 && b.height > 2 && b.bottom > 0 && b.top < innerHeight && s.visibility !== "hidden" && s.display !== "none";
      };
      document.querySelectorAll("[data-co2lab-id]").forEach((e) => e.removeAttribute("data-co2lab-id"));
      const els = [...document.querySelectorAll("a[href], button, input, textarea, select, [role=button], [role=link], [role=tab], [onclick]")]
        .filter(vis)
        .slice(0, max);
      const nodes = els.map((el, i) => {
        el.setAttribute("data-co2lab-id", String(i + 1));
        const b = el.getBoundingClientRect();
        const h = el as HTMLElement & { placeholder?: string; value?: string; href?: string };
        const text = (h.innerText || h.value || h.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 80);
        const desc = [h.placeholder ? `placeholder: ${h.placeholder}` : "", h.href ? `href: ${h.href.slice(0, 120)}` : ""].filter(Boolean).join(" ");
        return {
          id: String(i + 1),
          text: text || null,
          desc: desc || null,
          viewId: el.tagName.toLowerCase() + (el.getAttribute("type") ? `[${el.getAttribute("type")}]` : ""),
          clickable: true,
          bounds: [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)] as [number, number, number, number],
        };
      });
      return { nodes, text: (document.body?.innerText ?? "").replace(/\n{3,}/g, "\n\n").slice(0, 11_000) };
    }, MAX_ELEMENTS);
    return r;
  }

  private ask(o: { goal: string; shot: string; nodes: UiNode[]; history: string[]; url: string; title: string; text: string }): Promise<ProxyAction> {
    const requestId = `${this.id}-${o.history.length}-${Date.now()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("the hub did not choose an action within 60 s"));
      }, ACTION_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, reject, timer });
      this.send({
        type: "proxy.request",
        requestId,
        subtaskId: this.id,
        goal: o.goal,
        screenshot: o.shot,
        nodes: o.nodes,
        history: o.history,
        page: { url: o.url, title: o.title.slice(0, 200), text: o.text },
      });
    });
  }

  private async act(a: ProxyAction): Promise<void> {
    const page = this.page!;
    const el = (id: string) => page.locator(`[data-co2lab-id="${id}"]`).first();
    switch (a.kind) {
      case "tapNode":
        await el(a.nodeId).click({ timeout: 8_000 }).catch(async () => {
          // Links that open a new tab: follow them here instead.
          const href = await el(a.nodeId).getAttribute("href").catch(() => null);
          if (href) await this.goto(new URL(href, page.url()).href);
          else throw new Error(`could not click element ${a.nodeId}`);
        });
        break;
      case "tapXY":
        await page.mouse.click(a.x, a.y);
        break;
      case "type":
        await el(a.nodeId).fill(a.text, { timeout: 8_000 });
        if (a.submit) await el(a.nodeId).press("Enter");
        break;
      case "open":
        await this.goto(a.url);
        break;
      case "scroll":
        await page.mouse.wheel(0, a.direction === "down" ? 700 : -700);
        break;
      case "back":
        await page.goBack({ timeout: 15_000 }).catch(() => undefined);
        break;
      case "wait":
        await sleep(Math.min(a.ms, 5_000));
        break;
    }
    await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
    await sleep(900);
  }

  private async goto(url: string): Promise<void> {
    if (!/^https?:\/\//i.test(url)) throw new Error(`refusing to open ${url.slice(0, 60)}`);
    await this.page!.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await sleep(800);
  }

  // ---------- Helpers ----------

  private step(kind: StepKind, text: string, progress?: number): void {
    if (this.cancelled) return;
    log(`[${this.id}] ${text}`);
    this.send({ type: "step", subtaskId: this.id, kind, text, ...(progress !== undefined ? { progress: Math.min(1, progress) } : {}) });
  }

  private check(): void {
    if (this.cancelled) throw new Cancelled();
  }

  private async frameLoop(): Promise<void> {
    while (!this.cancelled) {
      const started = Date.now();
      if (!this.framing && this.page && !this.page.isClosed()) {
        this.framing = true;
        try {
          const jpeg = await this.page.screenshot({ type: "jpeg", quality: 60, timeout: 3_000 });
          if (!this.cancelled)
            this.send({ type: "frame", subtaskId: this.id, jpegBase64: jpeg.toString("base64"), width: VIEWPORT.width, height: VIEWPORT.height });
        } catch {
          /* navigating */
        } finally {
          this.framing = false;
        }
      }
      await sleep(Math.max(100, FRAME_INTERVAL_MS - (Date.now() - started)));
    }
  }
}

function describe(a: ProxyAction, nodes: UiNode[]): string {
  const name = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    return n ? `"${(n.text ?? n.desc ?? n.viewId ?? id).slice(0, 50)}"` : `#${id}`;
  };
  switch (a.kind) {
    case "tapNode":
      return `Click ${name(a.nodeId)}`;
    case "type":
      return `Type "${a.text.slice(0, 40)}" into ${name(a.nodeId)}${a.submit ? " and search" : ""}`;
    case "open":
      return `Open ${hostOf(a.url)}`;
    case "scroll":
      return `Scroll ${a.direction}`;
    case "tapXY":
      return `Click at ${Math.round(a.x)},${Math.round(a.y)}`;
    default:
      return a.kind === "back" ? "Go back" : a.kind === "wait" ? "Wait" : a.kind;
  }
}

const hostOf = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u.slice(0, 40);
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
