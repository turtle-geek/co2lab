import type { DeviceView } from "@co2lab/shared";
import { embodied, oldDevices } from "../footprint";

/**
 * The carbon it already took to make the paired old devices, now put to work instead of buying new
 * hardware. Wording is "put to work", not "saved": it is only avoided if it replaces a new purchase.
 */
export function ReuseLine({ devices }: { devices: DeviceView[] }) {
  const items = oldDevices(devices)
    .map((d) => ({ d, e: embodied(d) }))
    .filter((x): x is { d: DeviceView; e: NonNullable<ReturnType<typeof embodied>> } => !!x.e);
  if (!items.length) return null;
  const kg = items.reduce((n, x) => n + x.e.kg, 0);
  const detail = items.map((x) => `${x.d.name}: ${x.e.kg} kg (${x.e.source})`).join("\n");
  return (
    <p className="reuse" title={`Carbon it took to make each device:\n${detail}`}>
      <b>{Math.round(kg)} kg CO₂e</b> of manufacturing put to work: {items.length} old device{items.length === 1 ? "" : "s"} doing the job a new machine would
    </p>
  );
}
