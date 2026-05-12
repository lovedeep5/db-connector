import { notFound, redirect } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { requireUser } from "@/lib/session";
import { loadEffectivePermissions } from "@/lib/rbac";
import { FlowEditor } from "@/components/flows/flow-editor";
import type { FlowDefinition } from "@/lib/flows/types";

export default async function EditFlowPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const [row] = await db.select().from(schema.flows).where(eq(schema.flows.id, id));
  if (!row) notFound();
  if (row.userId !== user.id && !user.isSuperAdmin) redirect("/forbidden");

  const perms = await loadEffectivePermissions(user.id);
  const allConns = await db
    .select({ id: schema.connections.id, name: schema.connections.name, type: schema.connections.type })
    .from(schema.connections)
    .orderBy(schema.connections.name);
  const connections = perms.isSuperAdmin ? allConns : allConns.filter((c) => perms.connections.has(c.id));

  const myTeamIds = (
    await db.select({ teamId: schema.teamMembers.teamId })
      .from(schema.teamMembers).where(eq(schema.teamMembers.userId, user.id))
  ).map((m) => m.teamId);
  const myTeams = myTeamIds.length
    ? await db.select({ id: schema.teams.id, name: schema.teams.name })
        .from(schema.teams).where(inArray(schema.teams.id, myTeamIds))
    : [];

  const definition = JSON.parse(row.definition) as FlowDefinition;

  return (
    <FlowEditor
      mode="edit"
      flowId={row.id}
      initial={definition}
      meta={{
        id: row.id,
        name: row.name,
        description: row.description ?? "",
        isActive: row.isActive,
        visibility: row.visibility,
        sharedWithTeamId: row.sharedWithTeamId,
        executionMode: row.executionMode,
        maxConcurrentRuns: row.maxConcurrentRuns,
        defaultNodeTimeoutMs: row.defaultNodeTimeoutMs,
        webhookSecret: row.webhookSecret,
      }}
      connections={connections}
      myTeams={myTeams}
    />
  );
}
