import { z } from "zod";
import type { FileOutput, NodeDef } from "../types";
import { isValidEmail, parseRecipients, sendEmail } from "@/lib/email";

/**
 * Body shape — v2:
 *   - `format`: "text" (default) sends as plain text, preserving newlines
 *     exactly as the user typed; "html" sends as HTML.
 *   - `body`: the actual content. Templates resolve in either mode.
 *
 * Legacy compat: older flows had a top-level `html` field instead. The
 * preprocess at the bottom of `Config` lifts `html` into `{ format:"html",
 * body: html }` so saved flows keep working without manual migration.
 */
const ConfigShape = z.object({
  /** Optional SMTP connection id. Omit to fall back to workspace SMTP from Settings → Email. */
  smtpConnectionId: z.string().optional(),
  to: z.string().min(1, "At least one recipient"),
  subject: z.string().min(1, "Subject required"),
  format: z.enum(["text", "html"]).default("text"),
  body: z.string().min(1, "Body required"),
  /** Optional FileOutput from an upstream node, e.g. transform.toFile. */
  attachment: z
    .object({
      filename: z.string(),
      contentType: z.string(),
      size: z.number().optional(),
      contentBase64: z.string(),
    })
    .optional()
    .nullable(),
}).superRefine((v, ctx) => {
  const emails = parseRecipients(v.to);
  if (emails.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "Provide at least one address" });
  for (const e of emails) if (!isValidEmail(e)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: `"${e}" is not a valid email` });
    break;
  }
});

const Config = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;
  // Legacy: { html: "..." } → { format: "html", body: "..." }
  if (typeof obj.body !== "string" && typeof obj.html === "string") {
    return { ...obj, format: obj.format ?? "html", body: obj.html };
  }
  return obj;
}, ConfigShape);

type EmailOutput = { messageId: string; recipients: string[] };

export const sendEmailNode: NodeDef<z.infer<typeof Config>, EmailOutput> = {
  type: "email.send",
  label: "Send Email",
  description: "Send an email via the workspace SMTP. Attachments come from a previous to-file node.",
  category: "io",
  icon: "Mail",
  accent: "emerald",
  schema: Config,
  defaultConfig: () => ({
    to: "",
    subject: "Report from DBConnector",
    format: "text" as const,
    body: "Hi,\n\nSee attached.",
  }),
  takesInput: true,
  async execute(_ctx, cfg) {
    const recipients = parseRecipients(cfg.to);
    const attachments = cfg.attachment
      ? [
          {
            filename: cfg.attachment.filename,
            content: Buffer.from(cfg.attachment.contentBase64, "base64"),
            contentType: cfg.attachment.contentType,
          },
        ]
      : undefined;
    // In plain-text mode we send ONLY `text:` — no html field — so the
    // recipient's client renders it with the newlines and whitespace the
    // user typed. HTML mode passes the body through as-is.
    const isHtml = cfg.format === "html";
    const { messageId } = await sendEmail({
      to: recipients,
      subject: cfg.subject,
      html: isHtml ? cfg.body : undefined,
      text: isHtml ? undefined : cfg.body,
      attachments,
      smtpConnectionId: cfg.smtpConnectionId || undefined,
    });
    return { messageId, recipients };
  },
};

// Silence "unused" warning for the FileOutput re-export consumers might want.
export type _Re = FileOutput;
