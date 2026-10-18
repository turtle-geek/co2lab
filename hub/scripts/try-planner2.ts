// Dev check: the planner with a phone that has the Steam app installed.
import { planRequest, type CatalogDevice } from "../src/agent/agent.js";
const devices: CatalogDevice[] = [
  { id: "a54", name: "Galaxy A54", kind: "android", state: "idle", capabilities: ["app:tims", "app:mcdonalds", "app:popeyes"], context: [
    { kind: "installed_app", id: "com.valvesoftware.android.steam.community", label: "Steam" },
    { kind: "installed_app", id: "com.whatsapp", label: "WhatsApp" },
    { kind: "installed_app", id: "com.timhortons.digital", label: "Tim Hortons" } ] },
  { id: "df", name: "HP Elite Dragonfly G2", kind: "laptop", state: "idle", capabilities: ["web"], context: [{ kind: "browser", id: "browser", label: "Microsoft Edge" }] },
  { id: "cw", name: "Cloud worker", kind: "cloud", state: "idle", capabilities: ["web"], context: [] },
];
const plan = await planRequest({ prompt: process.argv[2] ?? "", devices, onUsage: () => {} });
console.log(JSON.stringify(plan, null, 2));
