import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, or, sql, desc } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db/client";

export const runtime = "nodejs";

export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const isSuperAdmin = session.user.isSuperAdmin;

  const myTeamIds = (
    await db
      .select({ teamId: schema.teamMembers.teamId })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.userId, userId))
  ).map((m) => m.teamId);

  const where = isSuperAdmin
    ? sql`1=1`
    : or(
        eq(schema.flows.userId, userId),
        eq(schema.flows.visibility, "everyone"),
        and(
          eq(schema.flows.visibility, "team"),
          myTeamIds.length > 0 ? inArray(schema.flows.sharedWithTeamId, myTeamIds) : sql`1=0`
        )
      );

  const rows = await db
    .select()
    .from(schema.flows)
    .where(where)
    .orderBy(desc(schema.flows.updatedAt));

  // Hydrate owner names + team names so the UI can render in one round-trip.
  const ownerIds = [...new Set(rows.map((r) => r.userId))];
  const teamIds = [...new Set(rows.map((r) => r.sharedWithTeamId).filter(Boolean) as string[])];
  const [owners, teamRows] = await Promise.all([
    ownerIds.length
      ? db
          .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
          .from(schema.users)
          .where(inArray(schema.users.id, ownerIds))
      : Promise.resolve([]),
    teamIds.length
      ? db
          .select({ id: schema.teams.id, name: schema.teams.name })
          .from(schema.teams)
          .where(inArray(schema.teams.id, teamIds))
      : Promise.resolve([]),
  ]);
  const ownerMap = new Map(owners.map((o) => [o.id, o]));
  const teamMap = new Map(teamRows.map((t) => [t.id, t]));

  return NextResponse.json({
    data: rows.map((r) => {
      let triggerType = "manual";
      try { triggerType = JSON.parse(r.definition).trigger?.type ?? "manual"; } catch { /* ignore */ }
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        isActive: r.isActive,
        triggerType,
        visibility: r.visibility,
        sharedWithTeamId: r.sharedWithTeamId,
        executionMode: r.executionMode,
        maxConcurrentRuns: r.maxConcurrentRuns,
        isMine: r.userId === userId,
        owner: ownerMap.get(r.userId) ?? null,
        team: r.sharedWithTeamId ? teamMap.get(r.sharedWithTeamId) ?? null : null,
        lastRunAt: r.lastRunAt?.toISOString() ?? null,
        lastRunStatus: r.lastRunStatus,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    }),
  });
}
