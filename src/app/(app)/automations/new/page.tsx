import { redirect } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { requireUser } from "@/lib/session";
import { loadEffectivePermissions } from "@/lib/rbac";
import { ScheduleForm } from "@/components/automations/schedule-form";

export default async function NewAutomationPage() {
  const user = await requireUser();
  const perms = await loadEffectivePermissions(user.id);
  if (!perms.isSuperAdmin && !perms.global.has("query:run")) {
    redirect("/forbidden");
  }

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
    <ScheduleForm mode="create" connections={connections} myTeams={myTeams} />
  );
}
