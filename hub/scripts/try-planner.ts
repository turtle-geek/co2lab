// Dev check: what does the general planner do with a request and a device catalog (no devices needed)?
//   npx tsx scripts/try-planner.ts "<request>"
import { planRequest, type CatalogDevice } from "../src/agent/agent.js";

const devices: CatalogDevice[] = [
  { id: "a54", name: "Galaxy A54", kind: "android", state: "idle", capabilities: ["app:tims", "app:mcdonalds", "app:popeyes"], context: [] },
  { id: "df", name: "HP Elite Dragonfly G2", kind: "laptop", state: "idle", capabilities: ["web"], context: [{ kind: "browser", id: "browser", label: "Microsoft Edge" }] },
  { id: "cw", name: "Cloud worker", kind: "cloud", state: "idle", capabilities: ["web"], context: [{ kind: "browser", id: "browser", label: "Chromium" }] },
];
let tokens = 0;
const plan = await planRequest({ prompt: process.argv[2] ?? "", devices, onUsage: (u) => (tokens += u.tokensIn + u.tokensOut) });
console.log(JSON.stringify(plan, null, 2), `\n(${tokens} tokens)`);
