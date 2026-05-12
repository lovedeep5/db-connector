import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { runQuery } from "@/server/services/db-access";

const Body = z.object({
  connectionId: z.string().min(1),
  statement: z.string().min(1),
  rowLimit: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  try {
    const result = await runQuery(
      { userId: session.user.id },
      parsed.data.connectionId,
      parsed.data.statement,
      { rowLimit: parsed.data.rowLimit, timeoutMs: parsed.data.timeoutMs }
    );
    return NextResponse.json({ data: serializeResult(result) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

function serializeResult(r: {
  rows: Record<string, unknown>[];
  columns: string[];
  rowCount: number;
  durationMs: number;
  affectedRows?: number;
  truncated?: boolean;
}) {
  return {
    ...r,
    rows: r.rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) out[k] = serializeValue(v);
      return out;
    }),
  };
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
