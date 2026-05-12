import { db, schema } from "@/lib/db/client";
import { requireSuperAdmin } from "@/lib/session";
import { PERMISSIONS } from "@/lib/db/schema";
import { RolesPanel } from "@/components/admin/roles-panel";

export default async function RolesPage() {
  await requireSuperAdmin();
  const roles = await db.select().from(schema.roles).orderBy(schema.roles.name);
  const perms = await db.select().from(schema.rolePermissions);

  const rolesWithPerms = roles.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    permissions: perms.filter((p) => p.roleId === r.id).map((p) => p.permission),
  }));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Roles</h1>
        <p className="text-sm text-muted-foreground">
          Define what teams can do across connections.
        </p>
      </div>
      <RolesPanel roles={rolesWithPerms} allPermissions={[...PERMISSIONS]} />
    </div>
  );
}
