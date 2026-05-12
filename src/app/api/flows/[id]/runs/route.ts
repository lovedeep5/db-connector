import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db/client";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const runs = await db
    .select()
    .from(schema.flowRuns)
    .where(eq(schema.flowRuns.flowId, id))
    .orderBy(desc(schema.flowRuns.startedAt))
    .limit(50);

  const runIds = runs.map((r) => r.id);
  const nodeRuns = runIds.length
    ? await db
        .select()
        .from(schema.flowNodeRuns)
        .where(eq(schema.flowNodeRuns.flowRunId, runIds[0]))
    : [];
  // For brevity we only hydrate node runs for the latest run; the UI fetches a
  // specific run lazily when the user expands it.

  return NextResponse.json({
    data: runs.map((r) => ({
      id: r.id,
      triggerType: r.triggerType,
      status: r.status,
      durationMs: r.durationMs,
      errorMessage: r.errorMessage,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
    })),
    nodeRunsForLatest: nodeRuns.map((n) => ({
      id: n.id,
      nodeId: n.nodeId,
      nodeType: n.nodeType,
      status: n.status,
      durationMs: n.durationMs,
      errorMessage: n.errorMessage,
      input: n.input,
      output: n.output,
      startedAt: n.startedAt.toISOString(),
    })),
  });
}
