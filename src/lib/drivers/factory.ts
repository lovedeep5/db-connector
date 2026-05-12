import { db, schema } from "@/lib/db/client";
import { decryptJSON } from "@/lib/crypto";
import { eq } from "drizzle-orm";
import type { ConnectionConfig, DbDriver } from "./types";
import { PostgresDriver } from "./postgres";
import { MySQLDriver } from "./mysql";
import { MongoDriver } from "./mongodb";
import { OracleDriver } from "./oracle";

export function createDriver(cfg: ConnectionConfig): DbDriver {
  switch (cfg.type) {
    case "postgres": return new PostgresDriver(cfg);
    case "mysql": return new MySQLDriver(cfg);
    case "mongodb": return new MongoDriver(cfg);
    case "oracle": return new OracleDriver(cfg);
    case "smtp":
      throw new Error("SMTP connections aren't database drivers — use the Send Email node or @/lib/smtp/transport.");
    case "s3":
      throw new Error("S3 connections aren't database drivers — they're consumed by S3 triggers and storage nodes.");
  }
}

export async function loadConnection(connectionId: string) {
  const [row] = await db
    .select()
    .from(schema.connections)
    .where(eq(schema.connections.id, connectionId));
  if (!row) throw new Error("Connection not found");
  const config = decryptJSON<ConnectionConfig>(row.encryptedConfig);
  return { row, config };
}

/**
 * Per-process, per-connection driver cache. Drivers internally manage pools.
 * Re-uses across requests in dev (Next.js HMR friendly via globalThis).
 */
type Cache = Map<string, DbDriver>;
const g = globalThis as unknown as { __dbDrivers?: Cache };
const cache: Cache = (g.__dbDrivers ??= new Map());

export async function getDriverForConnection(connectionId: string): Promise<DbDriver> {
  const existing = cache.get(connectionId);
  if (existing) return existing;
  const { config } = await loadConnection(connectionId);
  const driver = createDriver(config);
  cache.set(connectionId, driver);
  return driver;
}

export async function disposeDriver(connectionId: string) {
  const d = cache.get(connectionId);
  if (d) {
    await d.close().catch(() => {});
    cache.delete(connectionId);
  }
}
