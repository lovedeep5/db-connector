import { z } from "zod";
import type { FileOutput, NodeDef } from "../types";
import { isValidEmail, parseRecipients, sendEmail } from "@/lib/email";

const Config = z.object({
  /** Optional SMTP connection id. Omit to fall back to workspace SMTP from Settings → Email. */
  smtpConnectionId: z.string().optional(),
  to: z.string().min(1, "At least one recipient"),
  subject: z.string().min(1, "Subject required"),
  /** HTML body. Templates are resolved before this node runs. */
  html: z.string().min(1),
  /** Plain-text fallback. Optional. */
  text: z.string().optional(),
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
    html: "<p>Hi,</p><p>See attached.</p>",
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
    const { messageId } = await sendEmail({
      to: recipients,
      subject: cfg.subject,
      html: cfg.html,
      text: cfg.text,
      attachments,
      smtpConnectionId: cfg.smtpConnectionId || undefined,
    });
    return { messageId, recipients };
  },
};

// Silence "unused" warning for the FileOutput re-export consumers might want.
export type _Re = FileOutput;
