import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, schema as ms } from "@/lib/db/client";
import { requireUser } from "@/lib/session";
import { connectionAccess } from "@/lib/rbac";
import { describeObject } from "@/server/services/db-access";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Terminal } from "lucide-react";
import { DataBrowser } from "@/components/data/data-browser";

export default async function ObjectPage({
  params,
}: {
  params: Promise<{ id: string; schema: string; name: string }>;
}) {
  const user = await requireUser();
  const { id, schema: schemaName, name } = await params;
  const [conn] = await db.select().from(ms.connections).where(eq(ms.connections.id, id));
  if (!conn) notFound();
  const access = await connectionAccess(user.id, id);
  if (!access) notFound();

  const columns = await describeObject({ userId: user.id }, id, decodeURIComponent(schemaName), decodeURIComponent(name));

  return (
    <div className="flex flex-col h-full">
      <div className="border-b p-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Button asChild variant="ghost" size="icon">
            <Link href={`/connections/${id}`}><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="min-w-0">
            <h1 className="font-semibold truncate">
              {decodeURIComponent(schemaName)}.{decodeURIComponent(name)}
            </h1>
            <p className="text-xs text-muted-foreground truncate">{conn.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={access === "write" ? "default" : "secondary"}>
            {access === "write" ? "Read & Write" : "Read only"}
          </Badge>
          <Button asChild variant="outline" size="sm">
            <Link href={`/query?connection=${id}`}>
              <Terminal className="h-4 w-4" /> Query
            </Link>
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <DataBrowser
          connectionId={id}
          connectionType={conn.type}
          schema={decodeURIComponent(schemaName)}
          name={decodeURIComponent(name)}
          access={access}
          columns={columns.map((c) => ({
            name: c.name,
            dataType: c.dataType,
            nullable: c.nullable,
            isPrimaryKey: !!c.isPrimaryKey,
          }))}
        />
      </div>
    </div>
  );
}
