/**
 * Imports DB connections from environment variables.
 *
 *   DB_CONNECTION=postgresql://user:pass@host:5432/db
 *   DB_CONNECTION_ANALYTICS=mysql://user:pass@host:3306/db
 *   DB_CONNECTION_USERS=mongodb+srv://user:pass@cluster/db
 *
 * Naming: DB_CONNECTION ⇒ "Default", DB_CONNECTION_X ⇒ "X".
 * Re-running updates the stored config for the same name; never deletes.
 */

try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.(".env");
} catch { /* ok */ }

import { eq } from "drizzle-orm";
import { db, schema } from "./client";
import { encryptJSON } from "@/lib/crypto";
import type { ConnectionConfig } from "@/lib/drivers/types";
import { createDriver } from "@/lib/drivers/factory";

type Parsed = { type: ConnectionConfig["type"]; config: ConnectionConfig };

function parseUrl(raw: string): Parsed {
  const trimmed = raw.trim();
  if (trimmed.startsWith("postgresql://") || trimmed.startsWith("postgres://")) {
    return parsePostgres(trimmed);
  }
  if (trimmed.startsWith("mysql://") || trimmed.startsWith("mariadb://")) {
    return parseMysql(trimmed);
  }
  if (trimmed.startsWith("mongodb://") || trimmed.startsWith("mongodb+srv://")) {
    return parseMongo(trimmed);
  }
  throw new Error(`Unsupported URL scheme: ${trimmed.slice(0, 16)}…`);
}

function safeUrl(raw: string): URL {
  try {
    return new URL(raw);
  } catch {
    // Many real-world creds have unescaped '@' in the password. Patch them.
    // Split on the LAST '@' (host boundary) and percent-encode any inner @s.
    const schemeIdx = raw.indexOf("://");
    if (schemeIdx === -1) throw new Error("Invalid URL");
    const head = raw.slice(0, schemeIdx + 3);
    const rest = raw.slice(schemeIdx + 3);
    const lastAt = rest.lastIndexOf("@");
    if (lastAt === -1) throw new Error("Invalid URL");
    const userinfo = rest.slice(0, lastAt).replace(/@/g, "%40");
    const hostpath = rest.slice(lastAt);
    return new URL(head + userinfo + hostpath);
  }
}

function parsePostgres(raw: string): Parsed {
  const u = safeUrl(raw);
  const sslParam = u.searchParams.get("sslmode") ?? u.searchParams.get("ssl");
  const config = {
    type: "postgres" as const,
    host: u.hostname,
    port: Number(u.port || 5432),
    database: decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres",
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    ssl: sslParam ? !/^(disable|false|0)$/i.test(sslParam) : false,
  };
  return { type: "postgres", config };
}

function parseMysql(raw: string): Parsed {
  const u = safeUrl(raw);
  const sslParam = u.searchParams.get("ssl");
  const config = {
    type: "mysql" as const,
    host: u.hostname,
    port: Number(u.port || 3306),
    database: decodeURIComponent(u.pathname.replace(/^\//, "")),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    ssl: sslParam ? !/^(disable|false|0)$/i.test(sslParam) : false,
  };
  return { type: "mysql", config };
}

function parseMongo(raw: string): Parsed {
  const u = safeUrl(raw);
  const database = u.pathname.replace(/^\//, "") || "test";
  return {
    type: "mongodb",
    config: { type: "mongodb", url: raw, database },
  };
}

async function upsert(name: string, parsed: Parsed) {
  const [existing] = await db
    .select()
    .from(schema.connections)
    .where(eq(schema.connections.name, name));
  const payload = {
    type: parsed.type,
    encryptedConfig: encryptJSON(parsed.config),
    description: "Imported from environment",
  } as const;
  if (existing) {
    await db.update(schema.connections).set(payload).where(eq(schema.connections.id, existing.id));
    return "updated" as const;
  }
  await db.insert(schema.connections).values({ name, ...payload });
  return "created" as const;
}

async function maybeTest(parsed: Parsed): Promise<string> {
  const driver = createDriver(parsed.config);
  try {
    const r = await driver.test();
    return r.ok ? `connected (${r.serverVersion?.split("\n")[0] ?? "ok"})` : `failed: ${r.message}`;
  } finally {
    await driver.close().catch(() => {});
  }
}

async function main() {
  const entries: Array<{ name: string; value: string }> = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue;
    if (key === "DB_CONNECTION") entries.push({ name: "Default", value });
    else if (key.startsWith("DB_CONNECTION_")) {
      entries.push({ name: key.slice("DB_CONNECTION_".length).replace(/_/g, " "), value });
    }
  }
  if (entries.length === 0) {
    console.log("No DB_CONNECTION env vars found. Set DB_CONNECTION=postgres://... in .env.");
    return;
  }
  for (const { name, value } of entries) {
    try {
      const parsed = parseUrl(value);
      const result = await upsert(name, parsed);
      console.log(`${result.padEnd(8)} "${name}" (${parsed.type})`);
      const status = await maybeTest(parsed);
      console.log(`         test: ${status}`);
    } catch (e) {
      console.error(`failed   "${name}": ${(e as Error).message}`);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
