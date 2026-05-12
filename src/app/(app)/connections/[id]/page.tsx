import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { requireUser } from "@/lib/session";
import { connectionAccess } from "@/lib/rbac";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConnectionBrowser } from "@/components/connections/connection-browser";

export default async function ConnectionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const [conn] = await db.select().from(schema.connections).where(eq(schema.connections.id, id));
  if (!conn) notFound();
  const access = await connectionAccess(user.id, id);
  if (!access) notFound();

  return (
    <div className="flex flex-col h-full">
      <div className="border-b p-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{conn.name}</h1>
          <p className="text-xs text-muted-foreground">{conn.type}{conn.description ? ` · ${conn.description}` : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={access === "write" ? "default" : "secondary"}>
            {access === "write" ? "Read & Write" : "Read only"}
          </Badge>
          <Button asChild variant="outline" size="sm">
            <Link href={`/query?connection=${conn.id}`}>Open in workbench</Link>
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <ConnectionBrowser connectionId={conn.id} connectionType={conn.type} access={access} />
      </div>
    </div>
  );
}
