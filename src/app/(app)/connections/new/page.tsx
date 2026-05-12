import { requireUser } from "@/lib/session";
import { ConnectionForm } from "@/components/connections/connection-form";

export default async function NewConnectionPage() {
  const user = await requireUser();
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New connection</h1>
        <p className="text-sm text-muted-foreground">
          Configure a database or SMTP server. Credentials are encrypted at rest.
        </p>
      </div>
      <ConnectionForm canCreateShared={user.isSuperAdmin} />
    </div>
  );
}
