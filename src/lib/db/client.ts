import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import * as schema from "./schema";
import { bootstrap } from "./bootstrap";

const url = process.env.METADATA_DATABASE_URL;
if (!url) {
  throw new Error(
    "METADATA_DATABASE_URL is not set. Point it at your Postgres instance " +
      "(e.g. postgresql://user:pass@host:5432/dbconnector?sslmode=require)."
  );
}

const g = globalThis as unknown as {
  __dbcPool?: Pool;
  __dbcDrizzle?: NodePgDatabase<typeof schema>;
  __dbcBootstrapped?: boolean;
  __dbcSchedulerKickedOff?: boolean;
};

/**
 * Parse the URL into Pool config fields manually instead of passing
 * `connectionString`. This lets us *override* the SSL behaviour that pg
 * would otherwise derive from `sslmode=` in the URL. AWS RDS uses an
 * Amazon-Trust-Services CA chain that isn't in Node's default trust
 * store, so strict verification fails; we connect over TLS but skip
 * chain verification. (To pin the RDS CA properly, ship the
 * `rds-combined-ca-bundle.pem` and set `ca:` here.)
 */
function buildPoolConfig(connectionUrl: string): PoolConfig {
  const u = new URL(connectionUrl);
  const sslmode = (u.searchParams.get("sslmode") ?? "").toLowerCase();
  const isRemote = u.hostname !== "localhost" && u.hostname !== "127.0.0.1";
  const wantSsl = sslmode ? sslmode !== "disable" : isRemote;

  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    database: decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres",
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    ssl: wantSsl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  };
}

const pool = (g.__dbcPool ??= new Pool(buildPoolConfig(url)));

export const db: NodePgDatabase<typeof schema> = (g.__dbcDrizzle ??= drizzle(pool, { schema }));
export { schema };

// First-time-only bootstrap of the schema. SQL is `IF NOT EXISTS` everywhere
// so re-runs are no-ops.
if (!g.__dbcBootstrapped) {
  g.__dbcBootstrapped = true;
  bootstrap(pool).catch((e) => {
    // eslint-disable-next-line no-console
    console.error("[db] bootstrap failed:", e);
  });
}

// Boot the in-process scheduler once per Node server process.
if (!g.__dbcSchedulerKickedOff) {
  g.__dbcSchedulerKickedOff = true;
  setImmediate(async () => {
    try {
      const { ensureSchedulerStarted } = await import("@/lib/scheduler");
      await ensureSchedulerStarted();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[scheduler] failed to start:", e);
    }
  });
}
