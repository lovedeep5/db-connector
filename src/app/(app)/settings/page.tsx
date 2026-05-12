import { requireSuperAdmin } from "@/lib/session";
import { getEmailConfigPublic } from "@/lib/settings";
import { EmailSettingsCard } from "@/components/settings/email-settings-card";

export default async function SettingsPage() {
  await requireSuperAdmin();
  const email = await getEmailConfigPublic();

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Workspace-wide configuration. Admin only.</p>
      </div>
      <EmailSettingsCard
        initial={email ?? {
          host: "",
          port: 587,
          secure: false,
          user: "",
          hasPassword: false,
          from: "",
        }}
      />
    </div>
  );
}
