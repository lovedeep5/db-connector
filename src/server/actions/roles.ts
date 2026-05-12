"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { PERMISSIONS, type Permission } from "@/lib/db/schema";
import { requireSuperAdmin } from "@/lib/session";

const RoleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  permissions: z.array(z.enum(PERMISSIONS)),
});

export type RoleInput = z.infer<typeof RoleSchema>;

export async function createRole(input: RoleInput) {
  await requireSuperAdmin();
  const data = RoleSchema.parse(input);
  const [existing] = await db.select().from(schema.roles).where(eq(schema.roles.name, data.name));
  if (existing) throw new Error("A role with this name already exists.");
  const [created] = await db
    .insert(schema.roles)
    .values({ name: data.name, description: data.description ?? null, isSystem: false })
    .returning();
  for (const p of data.permissions) {
    await db.insert(schema.rolePermissions).values({ roleId: created.id, permission: p });
  }
  revalidatePath("/roles");
}

export async function updateRolePermissions(roleId: string, permissions: Permission[]) {
  await requireSuperAdmin();
  await db.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId));
  for (const p of permissions) {
    await db.insert(schema.rolePermissions).values({ roleId, permission: p });
  }
  revalidatePath("/roles");
}

export async function updateRole(roleId: string, input: Partial<Pick<RoleInput, "name" | "description">>) {
  await requireSuperAdmin();
  await db
    .update(schema.roles)
    .set({
      ...(input.name && { name: input.name }),
      ...(input.description !== undefined && { description: input.description ?? null }),
    })
    .where(eq(schema.roles.id, roleId));
  revalidatePath("/roles");
}

export async function deleteRole(roleId: string) {
  await requireSuperAdmin();
  const [role] = await db.select().from(schema.roles).where(eq(schema.roles.id, roleId));
  if (!role) throw new Error("Role not found");
  if (role.isSystem) throw new Error("System roles cannot be deleted.");
  await db.delete(schema.roles).where(eq(schema.roles.id, roleId));
  revalidatePath("/roles");
}
