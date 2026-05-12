import nodemailer, { type Transporter } from "nodemailer";
import { getEmailConfig, type EmailConfig } from "@/lib/settings";
import { getMailerFor } from "@/lib/smtp/transport";

type CachedTransport = {
  transport: Transporter;
  signature: string;
  from: string;
};

const g = globalThis as unknown as { __dbcMailerCache?: CachedTransport | null };

function signatureFor(cfg: EmailConfig): string {
  return [cfg.host, cfg.port, cfg.secure, cfg.user ?? "", cfg.from].join("|") + ":" + (cfg.password ?? "").length;
}

function buildTransport(cfg: EmailConfig): Transporter {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.password ?? "" } : undefined,
    pool: true,
    maxConnections: 3,
  });
}

/**
 * Build (or reuse) a transport from the current admin-configured settings.
 * Throws a clear error if SMTP has not been configured yet.
 */
async function getMailer(): Promise<{ transport: Transporter; from: string }> {
  const cfg = await getEmailConfig();
  if (!cfg || !cfg.host) {
    throw new Error("Email is not configured. An admin must set SMTP details in Settings → Email.");
  }
  const signature = signatureFor(cfg);
  const cached = g.__dbcMailerCache;
  if (cached && cached.signature === signature) {
    return { transport: cached.transport, from: cached.from };
  }
  if (cached) cached.transport.close();
  const transport = buildTransport(cfg);
  g.__dbcMailerCache = { transport, signature, from: cfg.from };
  return { transport, from: cfg.from };
}

/**
 * Force the next sendEmail() to rebuild the transport from DB. Called by
 * the settings save action so an updated host/password takes effect for
 * the long-lived pool too.
 */
export function invalidateMailerCache(): void {
  const cached = g.__dbcMailerCache;
  if (cached) {
    cached.transport.close();
    g.__dbcMailerCache = null;
  }
}

export type EmailAttachment = {
  filename: string;
  content: Buffer | string;
  contentType?: string;
};

export async function sendEmail(args: {
  to: string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
  /** Optional connection id — use a specific SMTP connection instead of the workspace default. */
  smtpConnectionId?: string;
}): Promise<{ messageId: string }> {
  const { transport, from } = args.smtpConnectionId
    ? await getMailerFor(args.smtpConnectionId)
    : await getMailer();
  const info = await transport.sendMail({
    from,
    to: args.to.join(", "),
    subject: args.subject,
    html: args.html,
    text: args.text,
    attachments: args.attachments,
  });
  return { messageId: info.messageId };
}

/**
 * Open a connection to the SMTP server and run the verify handshake without
 * actually sending mail. Returns ok/false + the error message if any.
 */
export async function verifyEmailConnection(): Promise<{ ok: boolean; message?: string }> {
  try {
    const { transport } = await getMailer();
    await transport.verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export function parseRecipients(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
