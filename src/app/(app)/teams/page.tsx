import Link from "next/link";
import { db, schema } from "@/lib/db/client";
import { requireSuperAdmin } from "@/lib/session";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Users } from "lucide-react";
import { CreateTeamDialog } from "@/components/admin/create-team-dialog";

export default async function TeamsPage() {
  await requireSuperAdmin();
  const teams = await db.select().from(schema.teams).orderBy(schema.teams.name);
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-semibold">Teams</h1>
          <p className="text-sm text-muted-foreground">
            Group users and grant them access to specific connections.
          </p>
        </div>
        <CreateTeamDialog />
      </div>

      {teams.length === 0 ? (
        <Card className="p-10 text-center">
          <Users className="h-10 w-10 mx-auto text-muted-foreground" />
          <h2 className="mt-3 text-lg font-medium">No teams yet</h2>
          <p className="text-muted-foreground text-sm">Create one to start sharing connections.</p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {teams.map((t) => (
            <Card key={t.id} className="p-5 space-y-3">
              <h3 className="font-medium">{t.name}</h3>
              {t.description && <p className="text-sm text-muted-foreground line-clamp-2">{t.description}</p>}
              <Button asChild variant="outline" size="sm">
                <Link href={`/teams/${t.id}`}>Manage</Link>
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
