// Node 20.6+ ships an env-file loader; ignore if unavailable.
try { (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.(".env"); } catch { /* ok */ }

import bcrypt from "bcryptjs";
import { db } from "./client";
import { users, roles, rolePermissions, PERMISSIONS } from "./schema";
import { eq } from "drizzle-orm";

async function ensureSystemRoles() {
  const systemRoles = [
    {
      name: "Admin",
      description: "Full administrative access to all features.",
      permissions: PERMISSIONS as readonly string[],
    },
    {
      name: "Editor",
      description: "Can run queries and edit data on assigned connections.",
      permissions: ["connection:read", "connection:write", "query:run", "data:export", "data:edit"],
    },
    {
      name: "Viewer",
      description: "Read-only access: can run SELECT queries and export results.",
      permissions: ["connection:read", "query:run", "data:export"],
    },
  ];

  for (const role of systemRoles) {
    const [existing] = await db.select().from(roles).where(eq(roles.name, role.name));
    let roleId = existing?.id;
    if (!existing) {
      const [inserted] = await db
        .insert(roles)
        .values({ name: role.name, description: role.description, isSystem: true })
        .returning();
      roleId = inserted.id;
    }
    if (!roleId) continue;
    // Reset perms (idempotent)
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    for (const p of role.permissions) {
      await db.insert(rolePermissions).values({ roleId, permission: p });
    }
  }
}

async function ensureAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe!123";
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) {
    console.log(`Admin user already exists: ${email}`);
    return;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await db.insert(users).values({
    email,
    name: "Administrator",
    passwordHash,
    isSuperAdmin: true,
    isActive: true,
  });
  console.log(`Created admin: ${email} / ${password}`);
}

async function main() {
  await ensureSystemRoles();
  await ensureAdmin();
  console.log("Seed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
