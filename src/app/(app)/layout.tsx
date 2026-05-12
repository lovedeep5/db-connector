import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/session";
import { loadEffectivePermissions } from "@/lib/rbac";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const perms = await loadEffectivePermissions(user.id);
  return (
    <AppShell
      user={{ id: user.id, name: user.name ?? "", email: user.email ?? "", isSuperAdmin: user.isSuperAdmin }}
      perms={{
        isSuperAdmin: perms.isSuperAdmin,
        global: [...perms.global],
      }}
    >
      {children}
    </AppShell>
  );
}
