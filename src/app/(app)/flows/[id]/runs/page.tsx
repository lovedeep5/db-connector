import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { requireUser } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Pencil } from "lucide-react";
import { FlowRunsView } from "@/components/flows/flow-runs-view";

export default async function FlowRunsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const [row] = await db.select().from(schema.flows).where(eq(schema.flows.id, id));
  if (!row) notFound();

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Button asChild variant="ghost" size="icon"><Link href="/flows"><ArrowLeft className="h-4 w-4" /></Link></Button>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold truncate">{row.name}</h1>
            <p className="text-xs text-muted-foreground truncate">{row.description ?? ""}</p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/flows/${row.id}/edit`}><Pencil className="h-3.5 w-3.5" /> Edit flow</Link>
        </Button>
      </div>
      <FlowRunsView flowId={row.id} />
    </div>
  );
}
