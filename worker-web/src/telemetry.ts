// Real device telemetry from systeminformation. Sampling runs in the background so the
// heartbeat never waits on slow OS queries (on Windows these shell out to PowerShell).

import { execFile } from "node:child_process";
import si from "systeminformation";
import type { Telemetry } from "@co2lab/shared";

const TEMP_EVERY_MS = 10_000;

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
      // Windows: systeminformation's WMI query needs admin; the thermal-zone counters do not.
      if (tempC === null && process.platform === "win32") tempC = await windowsThermalZoneC();
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

/**
 * Windows thermal-zone performance counters (readable without admin), in tenths of a kelvin.
 * Uses the CPU zone when the firmware names one, else the hottest zone; zones at exactly 0 °C are unpopulated.
 */
function windowsThermalZoneC(): Promise<number | null> {
  const ps =
    "Get-CimInstance -Namespace root/cimv2 -ClassName Win32_PerfFormattedData_Counters_ThermalZoneInformation | " +
    "Select-Object Name, HighPrecisionTemperature | ConvertTo-Json -Compress";
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { timeout: 10_000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        const raw = JSON.parse(String(stdout).trim() || "[]");
        const zones = (Array.isArray(raw) ? raw : [raw])
          .map((z: { Name?: string; HighPrecisionTemperature?: number }) => ({
            name: String(z.Name ?? ""),
            c: Number(z.HighPrecisionTemperature) / 10 - 273.15,
          }))
          .filter((z) => Number.isFinite(z.c) && z.c > 1 && z.c < 120);
        if (!zones.length) return resolve(null);
        const cpu = zones.find((z) => /cpu/i.test(z.name));
        resolve(round1(cpu ? cpu.c : Math.max(...zones.map((z) => z.c))));
      } catch {
        resolve(null);
      }
    });
  });
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
