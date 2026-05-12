import { db, schema } from "@/lib/db/client";
import { requireSuperAdmin } from "@/lib/session";
import { UsersPanel } from "@/components/admin/users-panel";

export default async function UsersPage() {
  await requireSuperAdmin();
  const users = await db.select().from(schema.users).orderBy(schema.users.email);
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="text-sm text-muted-foreground">
          Manage the people who can access this workspace.
        </p>
      </div>
      <UsersPanel
        users={users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          isActive: u.isActive,
          isSuperAdmin: u.isSuperAdmin,
          createdAt: u.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
