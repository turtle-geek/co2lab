// Spike: how fast does this machine embed review sentences, and how hot does it get?
//   npx tsx scripts/spike-embed-bench.ts <reviews.json> [seconds-per-mode=60]
// Runs "fast" (all cores, batch 64) then "eco" (2 threads, batch 16) on the same sentences,
// sampling temperature/CPU/battery with the worker's own TelemetrySampler.
import { readFileSync } from "node:fs";
import { cpus } from "node:os";
import { pipeline } from "@huggingface/transformers";
import { TelemetrySampler } from "../src/telemetry.js";

const file = process.argv[2];
const secs = Number(process.argv[3] ?? 60);
const data = JSON.parse(readFileSync(file, "utf8")) as { reviews: { text: string }[] };
const sentences = data.reviews
  .flatMap((r) => r.text.split(/(?<=[.!?])\s+|\n+/))
  .map((s) => s.trim())
  .filter((s) => s.length >= 12 && s.length <= 400);
console.log(`${data.reviews.length} reviews -> ${sentences.length} sentences; ${cpus().length} logical cores`);

const tel = new TelemetrySampler();
await tel.start(2_000);

async function mode(name: string, threads: number, batch: number) {
  const embed = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
    dtype: "q8",
    session_options: { intraOpNumThreads: threads, interOpNumThreads: 1 },
  });
  const startTel = { ...tel.current };
  let done = 0;
  let i = 0;
  let peakTemp = startTel.tempC ?? -1;
  let cpuSum = 0;
  let cpuN = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < secs * 1000) {
    const chunk = sentences.slice(i, i + batch);
    if (chunk.length < batch) i = 0;
    else i += batch;
    await embed(chunk.length ? chunk : sentences.slice(0, batch), { pooling: "mean", normalize: true });
    done += batch;
    const t = tel.current;
    if (t.tempC !== null) peakTemp = Math.max(peakTemp, t.tempC);
    if (t.cpuPct !== null) {
      cpuSum += t.cpuPct;
      cpuN++;
    }
  }
  const s = (Date.now() - t0) / 1000;
  const end = tel.current;
  console.log(
    `${name.padEnd(4)} threads=${threads} batch=${batch}: ${Math.round(done / s)} sentences/s | ` +
      `temp ${startTel.tempC ?? "?"} -> ${end.tempC ?? "?"} °C (peak ${peakTemp < 0 ? "?" : peakTemp}) | ` +
      `avg CPU ${cpuN ? Math.round(cpuSum / cpuN) : "?"} % | battery ${startTel.batteryPct ?? "-"} -> ${end.batteryPct ?? "-"} % ` +
      `(${end.charging ? "plugged in" : "on battery"})`,
  );
  await embed.dispose();
}

await mode("fast", cpus().length, 64);
console.log("cooling down 20 s…");
await new Promise((r) => setTimeout(r, 20_000));
await mode("eco", 2, 16);
tel.stop();
process.exit(0);
