"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { encryptJSON } from "@/lib/crypto";
import { requireSuperAdmin, requireUser } from "@/lib/session";
import { createDriver, disposeDriver } from "@/lib/drivers/factory";
import { testSmtpConfig, invalidateMailerCache } from "@/lib/smtp/transport";
import type { ConnectionConfig } from "@/lib/drivers/types";

const PostgresSchema = z.object({
  type: z.literal("postgres"),
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  database: z.string().min(1),
  user: z.string().min(1),
  password: z.string().min(0),
  ssl: z.coerce.boolean().optional(),
});

const MySQLSchema = z.object({
  type: z.literal("mysql"),
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  database: z.string().min(1),
  user: z.string().min(1),
  password: z.string().min(0),
  ssl: z.coerce.boolean().optional(),
});

const MongoSchema = z.object({
  type: z.literal("mongodb"),
  url: z.string().min(1),
  database: z.string().min(1),
});

const OracleSchema = z.object({
  type: z.literal("oracle"),
  connectString: z.string().min(1),
  user: z.string().min(1),
  password: z.string().min(0),
});

const SmtpSchema = z.object({
  type: z.literal("smtp"),
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.coerce.boolean().default(false),
  user: z.string().optional(),
  password: z.string().optional(),
  from: z.string().min(1, "From address required"),
});

const S3Schema = z.object({
  type: z.literal("s3"),
  region: z.string().min(1, "AWS region required (e.g. us-east-1)"),
  accessKeyId: z.string().min(1, "Access key required"),
  secretAccessKey: z.string().min(1, "Secret key required"),
  /**
   * Optional custom endpoint for S3-compatible storage (MinIO, R2,
   * Cloudflare R2, DigitalOcean Spaces, etc.). Leave blank for real AWS.
   */
  endpoint: z.string().optional(),
  /** Optional default bucket — triggers/nodes can override per-use. */
  defaultBucket: z.string().optional(),
});

const ConfigSchema = z.discriminatedUnion("type", [
  PostgresSchema,
  MySQLSchema,
  MongoSchema,
  OracleSchema,
  SmtpSchema,
  S3Schema,
]);

const NewConnectionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  config: ConfigSchema,
  visibility: z.enum(["private", "team", "everyone"]).default("private"),
});

export type NewConnectionInput = z.infer<typeof NewConnectionSchema>;

/** Test a configuration without saving. Any signed-in user may test — they're typing the creds. */
export async function testConfig(config: ConnectionConfig) {
  await requireUser();
  const cfg = ConfigSchema.parse(config);
  if (cfg.type === "smtp") return testSmtpConfig(cfg);
  if (cfg.type === "s3") {
    // Real `s3:HeadBucket` test lands with the S3 trigger work; for now just
    // confirm the inputs parsed and let the user save. The trigger's first
    // poll will surface any creds problem with a clear error.
    return { ok: true, message: "Saved — auth will be verified by the S3 trigger on first poll." };
  }
  const driver = createDriver(cfg);
  try {
    return await driver.test();
  } finally {
    await driver.close().catch(() => {});
  }
}

/**
 * Any signed-in user may create a *private* connection. Workspace-wide
 * (`team` / `everyone`) connections still require the manage:connections
 * permission, which only admins hold.
 */
export async function createConnection(input: NewConnectionInput) {
  const user = await requireUser();
  const data = NewConnectionSchema.parse(input);
  if (data.visibility !== "private" && !user.isSuperAdmin) {
    throw new Error("Only admins can create team or workspace-wide connections.");
  }
  // App-level name uniqueness: within the user's own visible set.
  const [existing] = await db
    .select()
    .from(schema.connections)
    .where(
      and(
        eq(schema.connections.name, data.name),
        eq(schema.connections.createdBy, user.id)
      )
    );
  if (existing) throw new Error("You already have a connection with this name.");
  await db.insert(schema.connections).values({
    name: data.name,
    description: data.description ?? null,
    type: data.config.type,
    encryptedConfig: encryptJSON(data.config),
    visibility: data.visibility,
    createdBy: user.id,
  });
  if (data.config.type === "smtp") invalidateMailerCache();
  revalidatePath("/connections");
  revalidatePath("/credentials");
}

export async function updateConnection(id: string, input: NewConnectionInput) {
  const user = await requireUser();
  const [existing] = await db.select().from(schema.connections).where(eq(schema.connections.id, id));
  if (!existing) throw new Error("Connection not found");
  if (existing.createdBy !== user.id && !user.isSuperAdmin) {
    throw new Error("Only the creator (or an admin) can edit this connection.");
  }
  const data = NewConnectionSchema.parse(input);
  if (data.visibility !== "private" && !user.isSuperAdmin) {
    throw new Error("Only admins can promote a connection to team or everyone.");
  }
  await db
    .update(schema.connections)
    .set({
      name: data.name,
      description: data.description ?? null,
      type: data.config.type,
      encryptedConfig: encryptJSON(data.config),
      visibility: data.visibility,
    })
    .where(eq(schema.connections.id, id));
  if (existing.type === "smtp" || data.config.type === "smtp") invalidateMailerCache();
  revalidatePath("/connections");
  revalidatePath("/credentials");
}

export async function deleteConnection(id: string) {
  const user = await requireUser();
  const [existing] = await db.select().from(schema.connections).where(eq(schema.connections.id, id));
  if (!existing) return;
  if (existing.createdBy !== user.id && !user.isSuperAdmin) {
    throw new Error("Only the creator (or an admin) can delete this connection.");
  }
  await db.delete(schema.connections).where(eq(schema.connections.id, id));
  await disposeDriver(id).catch(() => {});
  if (existing.type === "smtp") invalidateMailerCache();
  revalidatePath("/connections");
  revalidatePath("/credentials");
}

// Note: don't re-export ConfigSchema here. Files with "use server" can only
// export async functions — Next refuses to load the module otherwise. If a
// client-side reuser ever needs the schema, factor it into a plain module
// (e.g. src/lib/connections/schema.ts) and import it from both sides.
