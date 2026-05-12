import Link from "next/link";
import { Database, Plus, Terminal, Lock, Users, Globe, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { db, schema } from "@/lib/db/client";
import { requireUser } from "@/lib/session";
import { loadEffectivePermissions } from "@/lib/rbac";

const TYPE_LABEL: Record<string, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mongodb: "MongoDB",
  oracle: "Oracle",
  smtp: "SMTP",
};

export default async function ConnectionsPage() {
  const user = await requireUser();
  const perms = await loadEffectivePermissions(user.id);
  const all = await db.select().from(schema.connections);
  const visible = perms.isSuperAdmin ? all : all.filter((c) => perms.connections.has(c.id));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Connections</h1>
          <p className="text-sm text-muted-foreground">
            Databases & SMTP servers — your own and ones shared with you.
          </p>
        </div>
        <Button asChild>
          <Link href="/connections/new">
            <Plus className="h-4 w-4" /> New connection
          </Link>
        </Button>
      </div>

      {visible.length === 0 ? (
        <Card className="p-10 text-center">
          <Database className="h-10 w-10 mx-auto text-muted-foreground" />
          <h2 className="mt-3 text-lg font-medium">No connections yet</h2>
          <p className="text-muted-foreground text-sm">
            Click <strong>New connection</strong> to add your own private one.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visible.map((c) => {
            const access = perms.isSuperAdmin ? "write" : perms.connections.get(c.id);
            const isMine = c.createdBy === user.id;
            const TypeIcon = c.type === "smtp" ? Mail : Database;
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
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={access === "write" ? "default" : "secondary"} className="text-[10px]">
                    {access === "write" ? "Read & Write" : "Read only"}
                  </Badge>
                </div>
                {c.type !== "smtp" && (
                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/connections/${c.id}`}>
                        <Database className="h-4 w-4" /> Browse
                      </Link>
                    </Button>
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/query?connection=${c.id}`}>
                        <Terminal className="h-4 w-4" /> Query
                      </Link>
                    </Button>
                  </div>
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
