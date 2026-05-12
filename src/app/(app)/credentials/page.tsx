import Link from "next/link";
import { KeyRound, Plus, Lock, Users, Globe, Database, Mail, Cloud } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { db, schema } from "@/lib/db/client";
import { requireUser } from "@/lib/session";
import { loadEffectivePermissions } from "@/lib/rbac";
import { CredentialsFilter } from "./credentials-filter";

const TYPE_LABEL: Record<string, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mongodb: "MongoDB",
  oracle: "Oracle",
  smtp: "SMTP",
  s3: "AWS S3",
};

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  postgres: Database,
  mysql: Database,
  mongodb: Database,
  oracle: Database,
  smtp: Mail,
  s3: Cloud,
};

type Search = { type?: string };

export default async function CredentialsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { type } = await searchParams;
  const user = await requireUser();
  const perms = await loadEffectivePermissions(user.id);
  const all = await db.select().from(schema.connections);
  // Visibility for DB-type creds is enforced via the per-user permission set.
  // Non-DB types (SMTP, S3) follow the same visibility column but aren't in
  // the permissions map, so we fall back to the row's visibility/createdBy.
  const visible = all.filter((c) => {
    if (perms.isSuperAdmin) return true;
    if (c.createdBy === user.id) return true;
    if (c.visibility === "everyone") return true;
    // DB creds: gated by the connections permission map.
    if (["postgres", "mysql", "mongodb", "oracle"].includes(c.type)) {
      return perms.connections.has(c.id);
    }
    return false;
  });

  const filtered = type ? visible.filter((c) => c.type === type) : visible;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <KeyRound className="h-5 w-5" /> Credentials
          </h1>
          <p className="text-sm text-muted-foreground">
            One place for everything you connect to: databases, SMTP servers, AWS S3, and more.
          </p>
        </div>
        <Button asChild>
          <Link href="/credentials/new">
            <Plus className="h-4 w-4" /> New credential
          </Link>
        </Button>
      </div>

      <CredentialsFilter active={type ?? null} />

      {filtered.length === 0 ? (
        <Card className="p-10 text-center">
          <KeyRound className="h-10 w-10 mx-auto text-muted-foreground" />
          <h2 className="mt-3 text-lg font-medium">
            {type ? `No ${TYPE_LABEL[type] ?? type} credentials yet` : "No credentials yet"}
          </h2>
          <p className="text-muted-foreground text-sm">
            Click <strong>New credential</strong> to add one.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => {
            const isMine = c.createdBy === user.id;
            const TypeIcon = TYPE_ICON[c.type] ?? KeyRound;
            return (
              <Card key={c.id} className="p-5 space-y-3 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-medium truncate flex items-center gap-1.5">
                      <TypeIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="truncate">{c.name}</span>
                    </h3>
                    <p className="text-xs text-muted-foreground truncate">
                      {TYPE_LABEL[c.type] ?? c.type}
                    </p>
                  </div>
                  <VisibilityBadge visibility={c.visibility} mine={isMine} />
                </div>
                {c.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">{c.description}</p>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function VisibilityBadge({ visibility, mine }: { visibility: string; mine: boolean }) {
  if (visibility === "private") {
    return (
      <Badge variant="outline" className="text-[10px] gap-1">
        <Lock className="h-2.5 w-2.5" /> {mine ? "Yours" : "Private"}
      </Badge>
    );
  }
  if (visibility === "team") {
    return <Badge variant="secondary" className="text-[10px] gap-1"><Users className="h-2.5 w-2.5" /> Team</Badge>;
  }
  return <Badge variant="default" className="text-[10px] gap-1"><Globe className="h-2.5 w-2.5" /> Everyone</Badge>;
}
