import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, or, sql, desc } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db/client";
import { loadEffectivePermissions } from "@/lib/rbac";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const perms = await loadEffectivePermissions(userId);

  // Visible connection ids
  const visibleConnIds = perms.isSuperAdmin
    ? (await db.select({ id: schema.connections.id }).from(schema.connections)).map((c) => c.id)
    : [...perms.connections.keys()];
  if (visibleConnIds.length === 0) {
    return NextResponse.json({ data: [], myTeams: [] });
  }

  const myTeamIds = (
    await db
      .select({ teamId: schema.teamMembers.teamId })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.userId, userId))
  ).map((m) => m.teamId);

  const visibilityFilter = perms.isSuperAdmin
    ? sql`1=1`
    : or(
        eq(schema.schedules.userId, userId),
        eq(schema.schedules.visibility, "connection"),
        and(
          eq(schema.schedules.visibility, "team"),
          myTeamIds.length > 0 ? inArray(schema.schedules.sharedWithTeamId, myTeamIds) : sql`1=0`
        )
      );

  const rows = await db
    .select()
    .from(schema.schedules)
    .where(and(inArray(schema.schedules.connectionId, visibleConnIds), visibilityFilter))
    .orderBy(desc(schema.schedules.updatedAt));

  const ownerIds = [...new Set(rows.map((r) => r.userId))];
  const connIds = [...new Set(rows.map((r) => r.connectionId))];
  const teamIds = [...new Set(rows.map((r) => r.sharedWithTeamId).filter(Boolean) as string[])];

  const [owners, conns, teams, myTeams] = await Promise.all([
    ownerIds.length
      ? db
          .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
          .from(schema.users)
          .where(inArray(schema.users.id, ownerIds))
      : Promise.resolve([] as { id: string; name: string; email: string }[]),
    connIds.length
      ? db
          .select({ id: schema.connections.id, name: schema.connections.name, type: schema.connections.type })
          .from(schema.connections)
          .where(inArray(schema.connections.id, connIds))
      : Promise.resolve([] as { id: string; name: string; type: string }[]),
    teamIds.length
      ? db
          .select({ id: schema.teams.id, name: schema.teams.name })
          .from(schema.teams)
          .where(inArray(schema.teams.id, teamIds))
      : Promise.resolve([] as { id: string; name: string }[]),
    myTeamIds.length
      ? db
          .select({ id: schema.teams.id, name: schema.teams.name })
          .from(schema.teams)
          .where(inArray(schema.teams.id, myTeamIds))
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  const ownerMap = new Map(owners.map((o) => [o.id, o]));
  const connMap = new Map(conns.map((c) => [c.id, c]));
  const teamMap = new Map(teams.map((t) => [t.id, t]));

  return NextResponse.json({
    data: rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      cronExpression: r.cronExpression,
      emailTo: r.emailTo,
      emailSubject: r.emailSubject,
      statement: r.statement,
      visibility: r.visibility,
      sharedWithTeamId: r.sharedWithTeamId,
      isActive: r.isActive,
      isMine: r.userId === userId,
      owner: ownerMap.get(r.userId) ?? null,
      team: r.sharedWithTeamId ? teamMap.get(r.sharedWithTeamId) ?? null : null,
      connection: connMap.get(r.connectionId) ?? null,
      lastRunAt: r.lastRunAt?.toISOString() ?? null,
      lastRunStatus: r.lastRunStatus,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    myTeams,
  });
}
