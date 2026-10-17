// Opens a pg Pool to Tiger Data. DATABASE_URL has no password; DATABASE_PASSWORD is merged in here.
// TLS: Tiger signs its certs with its own CA (db/timescale-ca.pem). The leaf names an internal proxy
// host, so hostname checks are replaced by a check that the verified chain belongs to Timescale Inc.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PeerCertificate } from "node:tls";
import pg from "pg";
import { ROOT_DIR } from "../config.js";

export const CA_PATH = resolve(ROOT_DIR, "db", "timescale-ca.pem");

function checkServerIdentity(_host: string, cert: PeerCertificate): Error | undefined {
  // Called only after the chain verified against CA_PATH.
  const org = cert.subject?.O;
  const ok = Array.isArray(org) ? org.includes("Timescale Inc") : org === "Timescale Inc";
  return ok ? undefined : new Error(`database certificate subject O=${String(org)}, expected Timescale Inc`);
}

export function createPool(): pg.Pool {
  const url = new URL(process.env.DATABASE_URL!.trim());
  const password = process.env.DATABASE_PASSWORD?.trim() || decodeURIComponent(url.password);
  // Built from parts (not connectionString): pg lets ?sslmode= in the URL override the ssl object.
  return new pg.Pool({
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password,
    database: decodeURIComponent(url.pathname.replace(/^\//, "")) || "tsdb",
    ssl: { ca: readFileSync(CA_PATH, "utf8"), rejectUnauthorized: true, servername: url.hostname, checkServerIdentity },
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
    application_name: "co2lab-hub",
  });
}
