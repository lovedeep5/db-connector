import Link from "next/link";
import { Database, Terminal, Users, ShieldCheck, ArrowRight, Network } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { db, schema } from "@/lib/db/client";
import { count } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { loadEffectivePermissions } from "@/lib/rbac";

export default async function DashboardPage() {
  const user = await requireUser();
  const perms = await loadEffectivePermissions(user.id);

  const [connections, users, teams, roles] = await Promise.all([
    db.select({ value: count() }).from(schema.connections).then((r) => r[0]),
    db.select({ value: count() }).from(schema.users).then((r) => r[0]),
    db.select({ value: count() }).from(schema.teams).then((r) => r[0]),
    db.select({ value: count() }).from(schema.roles).then((r) => r[0]),
  ]);

  const myConns = perms.isSuperAdmin
    ? (connections?.value ?? 0)
    : perms.connections.size;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Welcome back, {user.name?.split(" ")[0] ?? "there"} 👋
        </h1>
        <p className="text-muted-foreground">Your data, all in one place.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Database} label="My databases" value={myConns} />
        {perms.isSuperAdmin && (
          <>
            <StatCard icon={Users} label="Users" value={users?.value ?? 0} />
            <StatCard icon={Network} label="Teams" value={teams?.value ?? 0} />
            <StatCard icon={ShieldCheck} label="Roles" value={roles?.value ?? 0} />
          </>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ActionCard
          href="/query"
          icon={Terminal}
          title="Run a query"
          description="Open the query workbench to run SQL against your connections."
          enabled={perms.isSuperAdmin || perms.global.has("query:run")}
        />
        <ActionCard
          href="/connections"
          icon={Database}
          title="Browse databases"
          description="View schemas and explore data with one click."
          enabled
        />
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <Card>
      <CardContent className="p-6 flex items-center gap-4">
        <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-2xl font-semibold">{value}</div>
          <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function ActionCard({
  href,
  icon: Icon,
  title,
  description,
  enabled,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  enabled: boolean;
}) {
  return (
    <Card className="group">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-primary" /> {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild disabled={!enabled} variant="outline">
          <Link href={enabled ? href : "#"}>
            Open <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
