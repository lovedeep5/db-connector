import { db, schema } from "@/lib/db/client";
import { and, eq, inArray, or } from "drizzle-orm";
import type { Permission, AccessLevel } from "@/lib/db/schema";

export type EffectivePermissions = {
  isSuperAdmin: boolean;
  /** Global permissions aggregated from every role assignment. */
  global: Set<Permission>;
  /** Per-connection access (read or write) considering team membership + per-conn override. */
  connections: Map<string, AccessLevel>;
};

export async function loadEffectivePermissions(userId: string): Promise<EffectivePermissions> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) {
    return { isSuperAdmin: false, global: new Set(), connections: new Map() };
  }

  // Pull connections this user owns (private) or that are workspace-wide (everyone) —
  // applies to super admins and regular users alike. Super admins also see private
  // connections of others through their isSuperAdmin shortcut below.
  const personalAndShared = await db
    .select({ id: schema.connections.id, visibility: schema.connections.visibility, createdBy: schema.connections.createdBy })
    .from(schema.connections)
    .where(
      or(
        eq(schema.connections.visibility, "everyone"),
        and(eq(schema.connections.visibility, "private"), eq(schema.connections.createdBy, userId))
      )
    );

  if (user.isSuperAdmin) {
    return {
      isSuperAdmin: true,
      global: new Set(schema.PERMISSIONS),
      connections: new Map(),
    };
  }

  // Always grant the foundational permissions to any signed-in user, so they
  // can use their own private connections and run queries against them.
  // Workspace-wide capabilities (manage:*) still require explicit role grants.
  const global = new Set<Permission>([
    "connection:read",
    "connection:write",
    "query:run",
    "data:export",
    "data:edit",
  ]);

  // Layer in any extra permissions granted via team-role memberships.
  const memberships = await db
    .select({ teamId: schema.teamMembers.teamId, roleId: schema.teamMembers.roleId })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.userId, userId));

  const connections = new Map<string, AccessLevel>();
  // Workspace-everyone connections: read access.
  // Private connections owned by this user: write access (they own it).
  for (const c of personalAndShared) {
    if (c.visibility === "private" && c.createdBy === userId) connections.set(c.id, "write");
    else if (c.visibility === "everyone") connections.set(c.id, "read");
  }

  if (memberships.length > 0) {
    const roleIds = [...new Set(memberships.map((m) => m.roleId))];
    const teamIds = [...new Set(memberships.map((m) => m.teamId))];

    const perms = await db
      .select()
      .from(schema.rolePermissions)
      .where(inArray(schema.rolePermissions.roleId, roleIds));
    for (const p of perms) global.add(p.permission as Permission);

    const roleHasWrite = new Map<string, boolean>();
    for (const roleId of roleIds) {
      roleHasWrite.set(
        roleId,
        perms.some((p) => p.roleId === roleId && p.permission === "connection:write")
      );
    }

    const teamConns = await db
      .select()
      .from(schema.teamConnections)
      .where(inArray(schema.teamConnections.teamId, teamIds));

    for (const tc of teamConns) {
      const teamRoles = memberships.filter((m) => m.teamId === tc.teamId);
      let level: AccessLevel = "read";
      for (const m of teamRoles) if (roleHasWrite.get(m.roleId)) level = "write";
      if (tc.accessLevel) level = tc.accessLevel;
      const prior = connections.get(tc.connectionId);
      if (prior === "write") continue;
      connections.set(tc.connectionId, level);
    }
  }

  return { isSuperAdmin: false, global, connections };
}

export function can(perms: EffectivePermissions, permission: Permission): boolean {
  if (perms.isSuperAdmin) return true;
  return perms.global.has(permission);
}

export async function connectionAccess(
  userId: string,
  connectionId: string
): Promise<AccessLevel | null> {
  const perms = await loadEffectivePermissions(userId);
  if (perms.isSuperAdmin) return "write";
  return perms.connections.get(connectionId) ?? null;
}
