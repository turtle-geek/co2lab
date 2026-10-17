// Real device telemetry from systeminformation. Sampling runs in the background so the
// heartbeat never waits on slow OS queries (on Windows these shell out to PowerShell).

import si from "systeminformation";
import type { Telemetry } from "@co2lab/shared";

const TEMP_EVERY_MS = 30_000;

export class TelemetrySampler {
  private latest: Telemetry = { batteryPct: null, charging: null, tempC: null, cpuPct: null };
  private stopped = false;
  private lastTempAt = 0;

  get current(): Telemetry {
    return this.latest;
  }

  /** Starts sampling; resolves after the first sample (or after 5 s, whichever is first). */
  start(intervalMs: number): Promise<void> {
    const first = this.sample().catch(() => undefined);
    void first.then(() => this.loop(intervalMs));
    return Promise.race([first, new Promise<void>((r) => setTimeout(r, 5_000))]);
  }

  stop(): void {
    this.stopped = true;
  }

  private async loop(intervalMs: number): Promise<void> {
    while (!this.stopped) {
      const started = Date.now();
      await this.sample().catch(() => undefined);
      await new Promise((r) => setTimeout(r, Math.max(250, intervalMs - (Date.now() - started))));
    }
  }

  private async sample(): Promise<void> {
    const [battery, load] = await Promise.all([si.battery().catch(() => null), si.currentLoad().catch(() => null)]);
    let tempC = this.latest.tempC;
    if (Date.now() - this.lastTempAt >= TEMP_EVERY_MS) {
      this.lastTempAt = Date.now();
      const t = await si.cpuTemperature().catch(() => null);
      tempC = t && typeof t.main === "number" && t.main > 0 ? round1(t.main) : null;
    }
    const hasBattery = !!battery?.hasBattery;
    this.latest = {
      batteryPct: hasBattery && typeof battery!.percent === "number" ? clamp(battery!.percent, 0, 100) : null,
      charging: hasBattery ? !!battery!.isCharging || !!battery!.acConnected : null,
      tempC,
      cpuPct: load && Number.isFinite(load.currentLoad) ? clamp(round1(load.currentLoad), 0, 100) : null,
    };
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
