import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { requireSuperAdmin } from "@/lib/session";
import { TeamDetail } from "@/components/admin/team-detail";

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  const [team] = await db.select().from(schema.teams).where(eq(schema.teams.id, id));
  if (!team) notFound();

  const [members, allUsers, allRoles, teamConns, allConnections] = await Promise.all([
    db.select().from(schema.teamMembers).where(eq(schema.teamMembers.teamId, id)),
    db.select().from(schema.users).orderBy(schema.users.email),
    db.select().from(schema.roles).orderBy(schema.roles.name),
    db.select().from(schema.teamConnections).where(eq(schema.teamConnections.teamId, id)),
    db.select().from(schema.connections).orderBy(schema.connections.name),
  ]);

  return (
    <TeamDetail
      team={{ id: team.id, name: team.name, description: team.description }}
      members={members.map((m) => ({ teamId: m.teamId, userId: m.userId, roleId: m.roleId }))}
      teamConnections={teamConns.map((tc) => ({
        teamId: tc.teamId,
        connectionId: tc.connectionId,
        accessLevel: tc.accessLevel,
      }))}
      allUsers={allUsers.map((u) => ({ id: u.id, name: u.name, email: u.email }))}
      allRoles={allRoles.map((r) => ({ id: r.id, name: r.name }))}
      allConnections={allConnections.map((c) => ({ id: c.id, name: c.name, type: c.type }))}
    />
  );
}
