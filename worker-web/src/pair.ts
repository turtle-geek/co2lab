// npm run pair                       -> device-code pairing: approve this computer in the dashboard
// npm run pair -- <6-digit code>     -> legacy pairing with a code from the dashboard
// Flags: --name <name>, --cloud, --hub <url>, --device-file <path>

import { parseArgs, hubUrlFromEnv, deviceFilePath, log } from "./config.js";
import { pairWithCode, pairWithDeviceCode } from "./pairing.js";

const args = parseArgs();
const code = args.positional[0];
if (code !== undefined && !/^\d{6}$/.test(code)) {
  console.error("Usage: npm run pair [-- <6-digit code>] [--name <name>] [--cloud] [--hub <url>]");
  process.exit(2);
}

const cloud = args.has("cloud");
const opts = { hubUrl: hubUrlFromEnv(args.str("hub")), deviceFile: deviceFilePath(args.str("device-file")), cloud, name: args.str("name") };
try {
  await (code ? pairWithCode(code, opts) : pairWithDeviceCode(opts));
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
log(cloud ? "Start with: npm start -- --cloud" : "Start with: npm start");
process.exit(0);
