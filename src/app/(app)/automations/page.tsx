import { db, schema } from "@/lib/db/client";
import { requireUser } from "@/lib/session";
import { loadEffectivePermissions } from "@/lib/rbac";
import { AutomationsPanel } from "@/components/automations/automations-panel";

export default async function AutomationsPage() {
  const user = await requireUser();
  const perms = await loadEffectivePermissions(user.id);
  const all = await db.select().from(schema.connections).orderBy(schema.connections.name);
  const visibleConns = perms.isSuperAdmin
    ? all
    : all.filter((c) => perms.connections.has(c.id));

  return (
    <AutomationsPanel
      connections={visibleConns.map((c) => ({ id: c.id, name: c.name, type: c.type }))}
      canCreate={perms.isSuperAdmin || perms.global.has("query:run")}
    />
  );
}
