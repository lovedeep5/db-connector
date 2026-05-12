import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db/client";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const [row] = await db.select().from(schema.flows).where(eq(schema.flows.id, id));
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.userId !== session.user.id && !session.user.isSuperAdmin && row.visibility === "private") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let definition: unknown = null;
  try { definition = JSON.parse(row.definition); } catch { /* ignore */ }
  return NextResponse.json({
    data: {
      id: row.id,
      name: row.name,
      description: row.description,
      definition,
      isActive: row.isActive,
      visibility: row.visibility,
      sharedWithTeamId: row.sharedWithTeamId,
      executionMode: row.executionMode,
      maxConcurrentRuns: row.maxConcurrentRuns,
      defaultNodeTimeoutMs: row.defaultNodeTimeoutMs,
      webhookSecret: row.userId === session.user.id || session.user.isSuperAdmin ? row.webhookSecret : null,
      isMine: row.userId === session.user.id,
    },
  });
}
