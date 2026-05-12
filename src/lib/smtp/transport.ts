import nodemailer, { type Transporter } from "nodemailer";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { decryptJSON } from "@/lib/crypto";
import type { SmtpConfig } from "@/lib/drivers/types";

/**
 * Build (or reuse) a nodemailer transport for a given SMTP connection. The
 * cache is keyed by connection id so multiple SMTP connections coexist —
 * each has its own pooled transport.
 */
type Cached = { transport: Transporter; signature: string; from: string };
const g = globalThis as unknown as { __dbcSmtpCache?: Map<string, Cached> };
const cache: Map<string, Cached> = (g.__dbcSmtpCache ??= new Map());

function buildSignature(cfg: SmtpConfig): string {
  return [cfg.host, cfg.port, cfg.secure, cfg.user ?? "", cfg.from].join("|") + ":" + (cfg.password ?? "").length;
}

function buildTransport(cfg: SmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.password ?? "" } : undefined,
    pool: true,
    maxConnections: 3,
  });
}

export async function loadSmtpConfig(connectionId: string): Promise<SmtpConfig> {
  const [row] = await db.select().from(schema.connections).where(eq(schema.connections.id, connectionId));
  if (!row) throw new Error("SMTP connection not found");
  if (row.type !== "smtp") throw new Error(`Connection "${row.name}" is not an SMTP connection (type=${row.type}).`);
  const cfg = decryptJSON<SmtpConfig>(row.encryptedConfig);
  return cfg;
}

export async function getMailerFor(connectionId: string): Promise<{ transport: Transporter; from: string }> {
  const cfg = await loadSmtpConfig(connectionId);
  const signature = buildSignature(cfg);
  const cached = cache.get(connectionId);
  if (cached && cached.signature === signature) {
    return { transport: cached.transport, from: cached.from };
  }
  if (cached) cached.transport.close();
  const transport = buildTransport(cfg);
  cache.set(connectionId, { transport, signature, from: cfg.from });
  return { transport, from: cfg.from };
}

export async function testSmtpConfig(cfg: SmtpConfig): Promise<{ ok: boolean; message?: string }> {
  const t = buildTransport(cfg);
  try {
    await t.verify();
    return { ok: true, message: "Connected to SMTP server" };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  } finally {
    t.close();
  }
}

/** Forget a cached connection's transport — call from connection update/delete actions. */
export function invalidateMailerCache(connectionId?: string): void {
  if (connectionId) {
    const c = cache.get(connectionId);
    if (c) { c.transport.close(); cache.delete(connectionId); }
    return;
  }
  for (const [id, c] of cache.entries()) c.transport.close();
  cache.clear();
}
