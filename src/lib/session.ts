import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { loadEffectivePermissions, can, type EffectivePermissions } from "@/lib/rbac";
import type { Permission } from "@/lib/db/schema";

export async function getSession() {
  return auth();
}

export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user;
}

export async function requireSuperAdmin() {
  const user = await requireUser();
  if (!user.isSuperAdmin) redirect("/forbidden");
  return user;
}

export async function requirePermission(permission: Permission) {
  const user = await requireUser();
  const perms = await loadEffectivePermissions(user.id);
  if (!can(perms, permission)) redirect("/forbidden");
  return { user, perms };
}

export async function getPermissions(): Promise<EffectivePermissions | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return loadEffectivePermissions(session.user.id);
}
