// Footprint figures for the Burn meter and the Devices tab. Published constants, not measurements.
//
// Grid: Ontario's electricity was about 53 g CO2e per kWh in 2023 (Ontario energy snapshot,
//   https://www.ontario.ca/page/ontario-energy-snapshot). Devices here are charged in Ontario.
// Device power: typical active draw while a device works a task (estimate): phone ~3 W, laptop ~15 W
//   (U-series CPU running a browser), desktop ~60 W. The cloud worker is not an old device and its
//   power is not known, so it is left out.
// Embodied carbon: what it took to make the device (materials + manufacturing), from the maker:
//   - Samsung Galaxy A54 5G: 45.285 kg CO2e life cycle, 82.3 % before use (78.4 % materials,
//     3.9 % manufacturing) = 37.3 kg. Carbon Trust certified product environmental profile.
//   - HP Elite Dragonfly: 162 kg CO2e manufacturing (HP product carbon data for the Elite Dragonfly G4,
//     as listed with the product specs).
//   Other phones and laptops use these as "similar device" estimates and say so.

import type { DeviceView, RunView } from "@co2lab/shared";

export const GRID_G_PER_KWH = 53;
const ACTIVE_W: Partial<Record<DeviceView["kind"], number>> = { android: 3, laptop: 15, desktop: 60 };

/** Old devices (not the cloud worker) that are still paired. */
export function oldDevices(devices: DeviceView[]): DeviceView[] {
  return devices.filter((d) => d.kind !== "cloud" && d.state !== "revoked");
}

export interface DeviceUse {
  devices: number;
  ms: number;
  wh: number;
  g: number;
}

/** Work time and estimated electricity of the old devices on this request. */
export function deviceUse(run: RunView | null, devices: DeviceView[]): DeviceUse {
  const kind = new Map(devices.map((d) => [d.id, d.kind]));
  const per = new Map<string, number>();
  for (const st of run?.subtasks ?? []) {
    if (!st.deviceId || !st.startedAt) continue;
    const k = kind.get(st.deviceId);
    if (!k || k === "cloud") continue;
    const end = st.finishedAt ?? Date.now();
    per.set(st.deviceId, (per.get(st.deviceId) ?? 0) + Math.max(0, end - st.startedAt));
  }
  let ms = 0;
  let wh = 0;
  for (const [id, t] of per) {
    ms += t;
    wh += ((ACTIVE_W[kind.get(id)!] ?? 0) * t) / 3_600_000;
  }
  return { devices: per.size, ms, wh, g: (wh / 1000) * GRID_G_PER_KWH };
}

export interface Embodied {
  kg: number;
  source: string;
}

/** Carbon it took to make this device, if we have a figure for it or a similar one. */
export function embodied(d: DeviceView): Embodied | null {
  if (d.kind === "android")
    return /a54/i.test(d.name)
      ? { kg: 37.3, source: "Samsung Galaxy A54 profile (Carbon Trust)" }
      : { kg: 37.3, source: "estimate: similar to a Galaxy A54" };
  if (d.kind === "laptop")
    return /dragonfly/i.test(d.name)
      ? { kg: 162, source: "HP Elite Dragonfly carbon data" }
      : { kg: 162, source: "estimate: similar to an HP Elite Dragonfly" };
  return null;
}

/** Grams with sensible precision: 0.04 g, 1.3 g, 27 g, 1.2 kg. */
export function fmtGrams(g: number): string {
  if (g >= 1000) return `${(g / 1000).toFixed(1)} kg`;
  if (g >= 10) return `${Math.round(g)} g`;
  if (g >= 1) return `${g.toFixed(1)} g`;
  if (g > 0) return `${g < 0.01 ? "<0.01" : g.toFixed(2)} g`;
  return "0 g";
}
