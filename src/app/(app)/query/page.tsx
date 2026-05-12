import { db, schema } from "@/lib/db/client";
import { requireUser, requirePermission } from "@/lib/session";
import { loadEffectivePermissions } from "@/lib/rbac";
import { QueryWorkbench } from "@/components/query/query-workbench";

export default async function QueryPage({
  searchParams,
}: {
  searchParams: Promise<{ connection?: string }>;
}) {
  await requirePermission("query:run");
  const user = await requireUser();
  const perms = await loadEffectivePermissions(user.id);
  const all = await db.select().from(schema.connections).orderBy(schema.connections.name);
  const visible = perms.isSuperAdmin ? all : all.filter((c) => perms.connections.has(c.id));
  const initial = (await searchParams).connection ?? visible[0]?.id;

  return (
    <QueryWorkbench
      connections={visible.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        access: perms.isSuperAdmin ? "write" : (perms.connections.get(c.id) ?? "read"),
      }))}
      initialConnectionId={initial}
      canManageConnections={perms.isSuperAdmin || perms.global.has("manage:connections")}
    />
  );
}
