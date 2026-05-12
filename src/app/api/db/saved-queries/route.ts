import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db/client";
import { loadEffectivePermissions } from "@/lib/rbac";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const connectionId = req.nextUrl.searchParams.get("connectionId");
  if (!connectionId) return NextResponse.json({ error: "connectionId required" }, { status: 400 });

  const perms = await loadEffectivePermissions(userId);
  if (!perms.isSuperAdmin && !perms.connections.has(connectionId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Teams the current user belongs to (for visibility = 'team' filter).
  const memberships = await db
    .select({ teamId: schema.teamMembers.teamId })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.userId, userId));
  const myTeamIds = memberships.map((m) => m.teamId);

  // Build visibility predicate:
  //   own queries OR connection-wide OR team-shared with a team I'm in
  //   (super admins see everything).
  const baseConnFilter = eq(schema.savedQueries.connectionId, connectionId);

  const visibilityFilter = perms.isSuperAdmin
    ? sql`1=1`
    : or(
        eq(schema.savedQueries.userId, userId),
        eq(schema.savedQueries.visibility, "connection"),
        and(
          eq(schema.savedQueries.visibility, "team"),
          myTeamIds.length > 0
            ? inArray(schema.savedQueries.sharedWithTeamId, myTeamIds)
            : sql`1=0`
        )
      );

  const rows = await db
    .select({
      id: schema.savedQueries.id,
      name: schema.savedQueries.name,
      description: schema.savedQueries.description,
      statement: schema.savedQueries.statement,
      visibility: schema.savedQueries.visibility,
      sharedWithTeamId: schema.savedQueries.sharedWithTeamId,
      userId: schema.savedQueries.userId,
      createdAt: schema.savedQueries.createdAt,
      updatedAt: schema.savedQueries.updatedAt,
    })
    .from(schema.savedQueries)
    .where(and(baseConnFilter, visibilityFilter));

  // Hydrate owner names + team names so the UI doesn't need extra round-trips.
  const ownerIds = [...new Set(rows.map((r) => r.userId))];
  const teamIds = [...new Set(rows.map((r) => r.sharedWithTeamId).filter(Boolean) as string[])];
  const owners = ownerIds.length
    ? await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
        .from(schema.users).where(inArray(schema.users.id, ownerIds))
    : [];
  const teams = teamIds.length
    ? await db.select({ id: schema.teams.id, name: schema.teams.name })
        .from(schema.teams).where(inArray(schema.teams.id, teamIds))
    : [];
  const ownerMap = new Map(owners.map((o) => [o.id, o]));
  const teamMap = new Map(teams.map((t) => [t.id, t]));

  // Also return the user's own teams so the UI can populate the share-with picker.
  const myTeams = myTeamIds.length
    ? await db.select({ id: schema.teams.id, name: schema.teams.name })
        .from(schema.teams).where(inArray(schema.teams.id, myTeamIds))
    : [];

  return NextResponse.json({
    data: rows.map((r) => ({
      ...r,
      isMine: r.userId === userId,
      owner: ownerMap.get(r.userId) ?? null,
      team: r.sharedWithTeamId ? teamMap.get(r.sharedWithTeamId) ?? null : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    myTeams,
  });
}
