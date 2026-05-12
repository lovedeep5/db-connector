import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { runQuery } from "@/server/services/db-access";
import { parseRecipients, sendEmail } from "@/lib/email";
import type { QueryResult } from "@/lib/drivers/types";

const MAX_INLINE_ROWS = 200;
const MAX_ATTACHMENT_ROWS = 50_000;

/**
 * Run a schedule exactly once: execute its query as the owning user, send
 * the formatted result to the recipients, and record a row in
 * `schedule_runs`. Idempotent for the caller; safe to invoke from cron or
 * the "Run now" button.
 */
export async function runSchedule(scheduleId: string, opts?: { trigger?: "cron" | "manual" }): Promise<void> {
  const [schedule] = await db.select().from(schema.schedules).where(eq(schema.schedules.id, scheduleId));
  if (!schedule) return;
  if (!schedule.isActive && opts?.trigger === "cron") return;

  const started = Date.now();
  const recipients = parseRecipients(schedule.emailTo);

  let result: QueryResult | null = null;
  let status: "success" | "error" = "success";
  let error: string | null = null;
  let messageId: string | null = null;

  try {
    result = await runQuery(
      { userId: schedule.userId },
      schedule.connectionId,
      schedule.statement,
      { rowLimit: MAX_ATTACHMENT_ROWS, timeoutMs: 10 * 60 * 1000 }
    );
  } catch (e) {
    status = "error";
    error = (e as Error).message;
  }

  try {
    if (status === "success" && result) {
      const subject = formatSubject(schedule.emailSubject, schedule.name, result, false);
      const { html, text } = renderSuccessBody({
        scheduleName: schedule.name,
        description: schedule.description,
        result,
        durationMs: Date.now() - started,
      });
      const attachments = result.rows.length > 0 ? [csvAttachment(schedule.name, result)] : undefined;
      const sent = await sendEmail({ to: recipients, subject, html, text, attachments });
      messageId = sent.messageId;
    } else {
      const subject = `[Failed] ${schedule.emailSubject ?? schedule.name}`;
      const { html, text } = renderErrorBody({
        scheduleName: schedule.name,
        error: error ?? "Unknown error",
      });
      const sent = await sendEmail({ to: recipients, subject, html, text });
      messageId = sent.messageId;
    }
  } catch (e) {
    // Email failed too. We still record the query outcome; expose the email
    // error as the run error so the user sees something actionable.
    if (status === "success") {
      status = "error";
      error = `Query ran but email failed: ${(e as Error).message}`;
    } else {
      error = `${error} (and email also failed: ${(e as Error).message})`;
    }
  }

  const ranAt = new Date();
  await db.insert(schema.scheduleRuns).values({
    scheduleId,
    ranAt,
    status,
    durationMs: Date.now() - started,
    rowCount: result?.rowCount ?? null,
    recipients: recipients.join(", "),
    errorMessage: error,
    emailMessageId: messageId,
  });
  await db
    .update(schema.schedules)
    .set({ lastRunAt: ranAt, lastRunStatus: status })
    .where(eq(schema.schedules.id, scheduleId));
}

function formatSubject(
  override: string | null,
  name: string,
  result: QueryResult,
  failed: boolean
): string {
  if (failed) return `[Failed] ${override ?? name}`;
  const base = override ?? name;
  return `${base} · ${result.rowCount} row${result.rowCount === 1 ? "" : "s"}`;
}

function renderSuccessBody(args: {
  scheduleName: string;
  description: string | null;
  result: QueryResult;
  durationMs: number;
}): { html: string; text: string } {
  const { scheduleName, description, result, durationMs } = args;
  const rowsForInline = result.rows.slice(0, MAX_INLINE_ROWS);
  const truncatedInline = result.rowCount > rowsForInline.length;
  const truncatedSource = !!result.truncated;
  const appUrl = process.env.APP_BASE_URL ?? "";

  const tableHtml = rowsForInline.length
    ? `
      <table style="border-collapse:collapse;font-family:ui-monospace,Menlo,monospace;font-size:12px;width:100%;">
        <thead>
          <tr>
            ${result.columns
              .map(
                (c) =>
                  `<th style="text-align:left;padding:6px 8px;border-bottom:1px solid #ddd;background:#fafafa;">${escapeHtml(c)}</th>`
              )
              .join("")}
          </tr>
        </thead>
        <tbody>
          ${rowsForInline
            .map(
              (row, i) => `<tr style="background:${i % 2 ? "#fff" : "#fafbfc"};">
              ${result.columns
                .map(
                  (c) =>
                    `<td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;">${escapeHtml(stringify(row[c]))}</td>`
                )
                .join("")}
            </tr>`
            )
            .join("")}
        </tbody>
      </table>`
    : `<p style="font-style:italic;color:#666;">No rows returned.</p>`;

  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#111;max-width:760px;">
    <h2 style="margin:0 0 4px;">${escapeHtml(scheduleName)}</h2>
    ${description ? `<p style="color:#555;margin:0 0 12px;">${escapeHtml(description)}</p>` : ""}
    <p style="color:#666;font-size:12px;margin:0 0 16px;">
      ${result.rowCount.toLocaleString()} row${result.rowCount === 1 ? "" : "s"} ·
      ${result.durationMs}ms query · sent ${durationMs}ms
      ${truncatedSource ? " · <strong style=\"color:#b45309;\">result was capped server-side</strong>" : ""}
    </p>
    ${tableHtml}
    ${truncatedInline ? `<p style="font-size:12px;color:#666;margin-top:8px;">Showing first ${MAX_INLINE_ROWS} rows in this email. The full result is attached as CSV.</p>` : ""}
    ${appUrl ? `<p style="font-size:12px;margin-top:16px;"><a href="${appUrl}/automations" style="color:#2563eb;">View in DBConnector</a></p>` : ""}
  </div>`;

  const text = [
    scheduleName,
    description ?? "",
    `${result.rowCount} rows · ${result.durationMs}ms`,
    "",
    result.columns.join("\t"),
    ...rowsForInline.map((r) => result.columns.map((c) => stringify(r[c])).join("\t")),
    truncatedInline ? `(${result.rowCount - rowsForInline.length} more rows in attached CSV)` : "",
  ].join("\n");

  return { html, text };
}

function renderErrorBody(args: { scheduleName: string; error: string }): { html: string; text: string } {
  return {
    html: `<div style="font-family:system-ui,sans-serif;color:#111;max-width:680px;">
      <h2 style="color:#b91c1c;margin:0 0 8px;">Scheduled report failed</h2>
      <p style="margin:0 0 12px;">${escapeHtml(args.scheduleName)}</p>
      <pre style="background:#fef2f2;color:#7f1d1d;padding:10px;border-radius:6px;white-space:pre-wrap;font-size:12px;">${escapeHtml(args.error)}</pre>
    </div>`,
    text: `Scheduled report failed: ${args.scheduleName}\n\n${args.error}`,
  };
}

function csvAttachment(name: string, result: QueryResult) {
  const filename = `${name.replace(/[^a-z0-9_\-]+/gi, "_")}.csv`;
  const rows = [result.columns.map(csvEscape).join(",")];
  for (const r of result.rows) {
    rows.push(result.columns.map((c) => csvEscape(stringify(r[c]))).join(","));
  }
  return { filename, content: rows.join("\n") + "\n", contentType: "text/csv; charset=utf-8" };
}

function csvEscape(v: string): string {
  if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"
  );
}

