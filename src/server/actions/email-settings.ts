"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/session";
import {
  getEmailConfig,
  setEmailConfig,
  type EmailConfig,
} from "@/lib/settings";
import {
  invalidateMailerCache,
  isValidEmail,
  sendEmail,
  verifyEmailConnection,
} from "@/lib/email";

const Schema = z
  .object({
    host: z.string().min(1, "Required"),
    port: z.coerce.number().int().min(1).max(65535),
    secure: z.boolean().optional().default(false),
    user: z.string().optional(),
    password: z.string().optional(),
    /** When true and password is empty, keep the previously-stored password. */
    keepExistingPassword: z.boolean().optional().default(false),
    from: z.string().min(1, "Required (e.g. \"DBConnector <noreply@your.co>\")"),
  })
  .superRefine((v, ctx) => {
    if (v.user && !v.keepExistingPassword && !v.password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["password"],
        message: "Password is required when a username is set",
      });
    }
  });

export type EmailSettingsInput = z.infer<typeof Schema>;

export async function saveEmailSettings(input: EmailSettingsInput): Promise<{ ok: true }> {
  const user = await requireSuperAdmin();
  const data = Schema.parse(input);

  // If "keep existing password" is on AND a password isn't provided, pull
  // the previous password forward so the form doesn't require re-entering it.
  let password = data.password ?? "";
  if (data.keepExistingPassword && !data.password) {
    const prev = await getEmailConfig();
    password = prev?.password ?? "";
  }

  const cfg: EmailConfig = {
    host: data.host.trim(),
    port: data.port,
    secure: !!data.secure,
    user: data.user?.trim() || undefined,
    password: password || undefined,
    from: data.from.trim(),
  };

  await setEmailConfig(cfg, user.id);
  invalidateMailerCache();
  revalidatePath("/settings");
  return { ok: true };
}

export async function verifyEmailSettings(): Promise<{ ok: boolean; message?: string }> {
  await requireSuperAdmin();
  return verifyEmailConnection();
}

export async function sendTestEmail(toAddress: string): Promise<{ ok: true; messageId: string }> {
  await requireSuperAdmin();
  const addr = toAddress.trim();
  if (!isValidEmail(addr)) throw new Error("Enter a valid recipient email.");
  const r = await sendEmail({
    to: [addr],
    subject: "DBConnector · Email is working",
    html: `<div style="font-family:system-ui,sans-serif;">
      <p>This is a test message from DBConnector. If you see this, SMTP is correctly configured.</p>
      <p style="color:#666;font-size:12px;">Sent at ${new Date().toISOString()}</p>
    </div>`,
    text: `DBConnector · email is working. Sent at ${new Date().toISOString()}`,
  });
  return { ok: true, messageId: r.messageId };
}
