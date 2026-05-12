"use server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { requireSuperAdmin } from "@/lib/session";

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  isSuperAdmin: z.boolean().optional().default(false),
});
export type CreateUserInput = z.infer<typeof CreateUserSchema>;

export async function createUser(input: CreateUserInput) {
  await requireSuperAdmin();
  const data = CreateUserSchema.parse(input);
  const [existing] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, data.email.toLowerCase()));
  if (existing) throw new Error("A user with this email already exists.");
  const passwordHash = await bcrypt.hash(data.password, 12);
  await db.insert(schema.users).values({
    email: data.email.toLowerCase(),
    name: data.name,
    passwordHash,
    isSuperAdmin: data.isSuperAdmin,
    isActive: true,
  });
  revalidatePath("/users");
}

export async function setUserActive(userId: string, active: boolean) {
  await requireSuperAdmin();
  await db.update(schema.users).set({ isActive: active }).where(eq(schema.users.id, userId));
  revalidatePath("/users");
}

export async function setUserSuperAdmin(userId: string, value: boolean) {
  await requireSuperAdmin();
  await db.update(schema.users).set({ isSuperAdmin: value }).where(eq(schema.users.id, userId));
  revalidatePath("/users");
}

export async function resetPassword(userId: string, newPassword: string) {
  await requireSuperAdmin();
  if (newPassword.length < 8) throw new Error("Password must be at least 8 characters.");
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, userId));
  revalidatePath("/users");
}

export async function deleteUser(userId: string) {
  await requireSuperAdmin();
  await db.delete(schema.users).where(eq(schema.users.id, userId));
  revalidatePath("/users");
}
