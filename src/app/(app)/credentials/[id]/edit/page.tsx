import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { decryptJSON } from "@/lib/crypto";
import { requireUser } from "@/lib/session";
import { ConnectionForm } from "@/components/connections/connection-form";
import type { ConnectionConfig } from "@/lib/drivers/types";

type ParamsP = { params: Promise<{ id: string }> };

export default async function EditCredentialPage({ params }: ParamsP) {
  const { id } = await params;
  const user = await requireUser();
  const [row] = await db.select().from(schema.connections).where(eq(schema.connections.id, id));
  if (!row) notFound();
  // Only the creator (or an admin) can edit.
  if (row.createdBy !== user.id && !user.isSuperAdmin) {
    redirect("/credentials");
  }
  const cfg = decryptJSON<ConnectionConfig>(row.encryptedConfig);
  // Map the decrypted config back into form-shaped initial values. The form
  // stores port as a string and uses separate fields per connection type;
  // we spread the per-type fields then override the common ones.
  const initial: Record<string, unknown> = {
    name: row.name,
    description: row.description ?? "",
    type: row.type,
    visibility: row.visibility,
  };
  switch (cfg.type) {
    case "postgres":
    case "mysql":
      initial.host = cfg.host;
      initial.port = String(cfg.port);
      initial.database = cfg.database;
      initial.user = cfg.user;
      initial.password = cfg.password;
      initial.ssl = !!cfg.ssl;
      break;
    case "mongodb":
      initial.url = cfg.url;
      initial.database = cfg.database;
      break;
    case "oracle":
      initial.connectString = cfg.connectString;
      initial.user = cfg.user;
      initial.password = cfg.password;
      break;
    case "smtp":
      initial.host = cfg.host;
      initial.port = String(cfg.port);
      initial.secure = !!cfg.secure;
      initial.user = cfg.user ?? "";
      initial.password = cfg.password ?? "";
      initial.from = cfg.from;
      break;
    case "s3":
      initial.region = cfg.region;
      initial.accessKeyId = cfg.accessKeyId;
      initial.secretAccessKey = cfg.secretAccessKey;
      initial.endpoint = cfg.endpoint ?? "";
      initial.defaultBucket = cfg.defaultBucket ?? "";
      break;
  }
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Edit credential</h1>
        <p className="text-sm text-muted-foreground">
          Update fields and save. The secret is re-encrypted with AES-256-GCM on save.
        </p>
      </div>
      <ConnectionForm
        canCreateShared={user.isSuperAdmin}
        editId={id}
        initial={initial as never}
      />
    </div>
  );
}
