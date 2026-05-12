import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db/client";
import { loadEffectivePermissions } from "@/lib/rbac";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const { id } = await params;

  const [sched] = await db.select().from(schema.schedules).where(eq(schema.schedules.id, id));
  if (!sched) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Re-use the same visibility rules as the list endpoint.
  const perms = await loadEffectivePermissions(userId);
  let visible = perms.isSuperAdmin || sched.userId === userId || sched.visibility === "connection";
  if (!visible && sched.visibility === "team" && sched.sharedWithTeamId) {
    const [member] = await db
      .select()
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.userId, userId),
          eq(schema.teamMembers.teamId, sched.sharedWithTeamId)
        )
      );
    visible = !!member;
  }
  if (!visible) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const runs = await db
    .select()
    .from(schema.scheduleRuns)
    .where(eq(schema.scheduleRuns.scheduleId, id))
    .orderBy(desc(schema.scheduleRuns.ranAt))
    .limit(50);

  return NextResponse.json({
    data: runs.map((r) => ({
      id: r.id,
      ranAt: r.ranAt.toISOString(),
      status: r.status,
      durationMs: r.durationMs,
      rowCount: r.rowCount,
      recipients: r.recipients,
      errorMessage: r.errorMessage,
    })),
  });
}
