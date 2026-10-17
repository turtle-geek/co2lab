// Spike: quick grid of dtype x threads x batch, 15 s each, sentences sorted by length (less padding).
import { readFileSync } from "node:fs";
import { pipeline } from "@huggingface/transformers";
const data = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as { reviews: { text: string }[] };
const sentences = data.reviews.flatMap((r) => r.text.split(/(?<=[.!?])\s+|\n+/)).map((s) => s.trim())
  .filter((s) => s.length >= 12 && s.length <= 400).sort((a, b) => a.length - b.length);
for (const [dtype, threads, batch] of [["fp32", 4, 32], ["fp32", 8, 32], ["q8", 4, 32], ["fp32", 4, 8]] as const) {
  const embed = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype, session_options: { intraOpNumThreads: threads, interOpNumThreads: 1 } });
  let done = 0, i = 0; const t0 = Date.now();
  while (Date.now() - t0 < 15_000) { const c = sentences.slice(i, i + batch); i = (i + batch) % (sentences.length - batch); await embed(c, { pooling: "mean", normalize: true }); done += c.length; }
  console.log(`${dtype} threads=${threads} batch=${batch}: ${Math.round(done / ((Date.now() - t0) / 1000))} sentences/s`);
  await embed.dispose();
}
process.exit(0);
