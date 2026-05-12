import { db, schema } from "@/lib/db/client";
import { requireUser } from "@/lib/session";
import { loadEffectivePermissions } from "@/lib/rbac";
import { FlowsList } from "@/components/flows/flows-list";
import { eq, inArray } from "drizzle-orm";

export default async function FlowsPage() {
  const user = await requireUser();
  const perms = await loadEffectivePermissions(user.id);

  const allConns = await db
    .select({ id: schema.connections.id, name: schema.connections.name, type: schema.connections.type })
    .from(schema.connections)
    .orderBy(schema.connections.name);
  const connections = perms.isSuperAdmin
    ? allConns
    : allConns.filter((c) => perms.connections.has(c.id));

  const myTeamIds = (
    await db
      .select({ teamId: schema.teamMembers.teamId })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.userId, user.id))
  ).map((m) => m.teamId);
  const myTeams = myTeamIds.length
    ? await db
        .select({ id: schema.teams.id, name: schema.teams.name })
        .from(schema.teams)
        .where(inArray(schema.teams.id, myTeamIds))
    : [];

  return (
    <FlowsList
      canCreate={connections.length > 0}
      connections={connections}
      myTeams={myTeams}
    />
  );
}
