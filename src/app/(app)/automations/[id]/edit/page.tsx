import { notFound, redirect } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { requireUser } from "@/lib/session";
import { loadEffectivePermissions } from "@/lib/rbac";
import { ScheduleForm } from "@/components/automations/schedule-form";
import type { Schedule } from "@/components/automations/automations-panel";

export default async function EditAutomationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const [row] = await db.select().from(schema.schedules).where(eq(schema.schedules.id, id));
  if (!row) notFound();
  if (row.userId !== user.id && !user.isSuperAdmin) redirect("/forbidden");

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

  // Resolve the related connection / owner for the form's defaults.
  const conn = allConns.find((c) => c.id === row.connectionId);
  const schedule: Schedule = {
    id: row.id,
    name: row.name,
    description: row.description,
    cronExpression: row.cronExpression,
    emailTo: row.emailTo,
    emailSubject: row.emailSubject,
    statement: row.statement,
    visibility: row.visibility,
    sharedWithTeamId: row.sharedWithTeamId,
    isActive: row.isActive,
    isMine: row.userId === user.id,
    owner: null,
    team: null,
    connection: conn ?? null,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastRunStatus: row.lastRunStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };

  return (
    <ScheduleForm mode="edit" connections={connections} myTeams={myTeams} schedule={schedule} />
  );
}
