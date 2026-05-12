import { requireUser } from "@/lib/session";
import { ConnectionForm } from "@/components/connections/connection-form";

export default async function NewCredentialPage() {
  const user = await requireUser();
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New credential</h1>
        <p className="text-sm text-muted-foreground">
          Connect a database, SMTP server or S3 bucket. Secrets are encrypted at rest with AES-256-GCM.
        </p>
      </div>
      <ConnectionForm canCreateShared={user.isSuperAdmin} />
    </div>
  );
}
