import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { streamQuery } from "@/server/services/db-access";
import { getDriverForConnection } from "@/lib/drivers/factory";
import { qualified } from "@/lib/drivers/sql-utils";
import type { QueryRow } from "@/lib/drivers/types";

const Body = z.object({
  connectionId: z.string().min(1),
  format: z.enum(["csv", "json", "ndjson"]).default("csv"),
  // Either an ad-hoc statement…
  statement: z.string().min(1).optional(),
  // …or a table reference for "Export entire table" actions.
  schema: z.string().min(1).optional(),
  table: z.string().min(1).optional(),
  /** Optional safety net on really huge exports. 0/undefined = unlimited. */
  maxRows: z.number().int().nonnegative().optional(),
});

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const { connectionId, format, statement, schema, table, maxRows } = parsed.data;

  let effectiveStatement = statement;
  if (!effectiveStatement) {
    if (!schema || !table) {
      return NextResponse.json({ error: "Provide either `statement` or `schema`+`table`." }, { status: 400 });
    }
    const driver = await getDriverForConnection(connectionId);
    if (driver.type === "mongodb") {
      effectiveStatement = JSON.stringify({ collection: table, operation: "find", filter: {} });
    } else {
      const quote = driver.type === "mysql" ? "`" : '"';
      effectiveStatement = `select * from ${qualified(schema, table, quote)}`;
    }
  }

  let iter: AsyncIterable<QueryRow>;
  try {
    iter = await streamQuery({ userId: session.user.id }, connectionId, effectiveStatement);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = (table ?? "results").replace(/[^a-z0-9_\-]+/gi, "_");
  const filename = `${baseName}-${ts}.${format === "ndjson" ? "ndjson" : format}`;
  const contentType =
    format === "csv"
      ? "text/csv; charset=utf-8"
      : format === "ndjson"
      ? "application/x-ndjson; charset=utf-8"
      : "application/json; charset=utf-8";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        if (format === "csv") {
          await writeCsv(iter, controller, encoder, maxRows);
        } else if (format === "ndjson") {
          await writeNdjson(iter, controller, encoder, maxRows);
        } else {
          await writeJsonArray(iter, controller, encoder, maxRows);
        }
      } catch (err) {
        controller.enqueue(encoder.encode(`\n[ERROR] ${(err as Error).message}\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function serializeValue(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return v.toString();
  if (Buffer.isBuffer(v)) return `<binary ${v.length} bytes>`;
  if (typeof v === "object") {
    try { return JSON.parse(JSON.stringify(v)); } catch { return String(v); }
  }
  return v;
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function writeCsv(
  iter: AsyncIterable<QueryRow>,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  maxRows?: number
) {
  let columns: string[] | null = null;
  let count = 0;
  for await (const row of iter) {
    if (!columns) {
      columns = Object.keys(row);
      controller.enqueue(encoder.encode(columns.map(csvEscape).join(",") + "\n"));
    }
    controller.enqueue(
      encoder.encode(columns.map((c) => csvEscape(serializeValue(row[c]))).join(",") + "\n")
    );
    count++;
    if (maxRows && count >= maxRows) break;
  }
}

async function writeNdjson(
  iter: AsyncIterable<QueryRow>,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  maxRows?: number
) {
  let count = 0;
  for await (const row of iter) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) out[k] = serializeValue(v);
    controller.enqueue(encoder.encode(JSON.stringify(out) + "\n"));
    count++;
    if (maxRows && count >= maxRows) break;
  }
}

async function writeJsonArray(
  iter: AsyncIterable<QueryRow>,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  maxRows?: number
) {
  controller.enqueue(encoder.encode("["));
  let first = true;
  let count = 0;
  for await (const row of iter) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) out[k] = serializeValue(v);
    controller.enqueue(encoder.encode((first ? "" : ",") + JSON.stringify(out)));
    first = false;
    count++;
    if (maxRows && count >= maxRows) break;
  }
  controller.enqueue(encoder.encode("]"));
}
