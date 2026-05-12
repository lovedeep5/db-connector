"use client";
import * as React from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  Globe,
  Lock,
  Users,
  Plus,
  Play,
  Pencil,
  Trash2,
  Loader2,
  History,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import parser from "cron-parser";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { RunHistoryDialog } from "@/components/automations/run-history-dialog";
import {
  deleteSchedule,
  runScheduleNow,
  setScheduleActive,
} from "@/server/actions/schedules";

export type Schedule = {
  id: string;
  name: string;
  description: string | null;
  cronExpression: string;
  emailTo: string;
  emailSubject: string | null;
  statement: string;
  visibility: "private" | "team" | "connection";
  sharedWithTeamId: string | null;
  isActive: boolean;
  isMine: boolean;
  owner: { id: string; name: string; email: string } | null;
  team: { id: string; name: string } | null;
  connection: { id: string; name: string; type: string } | null;
  lastRunAt: string | null;
  lastRunStatus: "success" | "error" | "skipped" | null;
  createdAt: string;
  updatedAt: string;
};

type ListResponse = { data: Schedule[]; myTeams: { id: string; name: string }[] };

type Conn = { id: string; name: string; type: string };

export function AutomationsPanel({
  connections,
  canCreate,
}: {
  connections: Conn[];
  canCreate: boolean;
}) {
  const qc = useQueryClient();
  const [historyFor, setHistoryFor] = React.useState<Schedule | null>(null);

  const { data, isLoading } = useQuery<ListResponse>({
    queryKey: ["schedules"],
    queryFn: async () => {
      const r = await fetch("/api/schedules");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      return j as ListResponse;
    },
  });

  const runNow = useMutation({
    mutationFn: async (id: string) => runScheduleNow(id),
    onSuccess: () => {
      toast.success("Triggered. Check your inbox.");
      qc.invalidateQueries({ queryKey: ["schedules"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Automations</h1>
          <p className="text-sm text-muted-foreground">
            Run a saved query on a schedule and email the result.
          </p>
        </div>
        {canCreate && connections.length > 0 && (
          <Button asChild>
            <Link href="/automations/new"><Plus className="h-4 w-4" /> New automation</Link>
          </Button>
        )}
      </div>

      {connections.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          You don&apos;t have access to any databases yet, so there&apos;s nothing to schedule.
        </Card>
      ) : isLoading ? (
        <Card className="p-10 text-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mx-auto" />
        </Card>
      ) : (data?.data ?? []).length === 0 ? (
        <Card className="p-10 text-center space-y-3">
          <Calendar className="h-10 w-10 text-muted-foreground mx-auto" />
          <h2 className="text-lg font-medium">No automations yet</h2>
          <p className="text-sm text-muted-foreground">
            Pick a connection, write a query, set a schedule, list the recipients — done.
          </p>
          {canCreate && (
            <Button asChild>
              <Link href="/automations/new"><Plus className="h-4 w-4" /> Create your first automation</Link>
            </Button>
          )}
        </Card>
      ) : (
        <div className="space-y-3">
          {(data?.data ?? []).map((s) => (
            <ScheduleRow
              key={s.id}
              schedule={s}
              onToggle={async (v) => {
                try {
                  await setScheduleActive(s.id, v);
                  toast.success(v ? "Activated" : "Paused");
                  qc.invalidateQueries({ queryKey: ["schedules"] });
                } catch (e) { toast.error((e as Error).message); }
              }}
              onRunNow={() => runNow.mutate(s.id)}
              runningNow={runNow.isPending && runNow.variables === s.id}
              onDelete={async () => {
                if (!confirm(`Delete "${s.name}"? Run history will also be removed.`)) return;
                try {
                  await deleteSchedule(s.id);
                  toast.success("Deleted");
                  qc.invalidateQueries({ queryKey: ["schedules"] });
                } catch (e) { toast.error((e as Error).message); }
              }}
              onHistory={() => setHistoryFor(s)}
            />
          ))}
        </div>
      )}

      {historyFor && (
        <RunHistoryDialog
          open={!!historyFor}
          onOpenChange={(v) => !v && setHistoryFor(null)}
          schedule={historyFor}
        />
      )}
    </div>
  );
}

function ScheduleRow({
  schedule,
  onToggle,
  onRunNow,
  runningNow,
  onDelete,
  onHistory,
}: {
  schedule: Schedule;
  onToggle: (v: boolean) => void;
  onRunNow: () => void;
  runningNow: boolean;
  onDelete: () => void;
  onHistory: () => void;
}) {
  const nextRun = React.useMemo(() => {
    try {
      return parser.parseExpression(schedule.cronExpression).next().toDate();
    } catch {
      return null;
    }
  }, [schedule.cronExpression]);

  return (
    <Card className="p-4 hover:shadow-sm transition-shadow">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium truncate">{schedule.name}</h3>
            <VisibilityBadge schedule={schedule} />
            {schedule.connection && (
              <Badge variant="outline" className="text-[10px]">
                {schedule.connection.name} ({schedule.connection.type})
              </Badge>
            )}
            {schedule.lastRunStatus === "success" && (
              <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Last run OK</Badge>
            )}
            {schedule.lastRunStatus === "error" && (
              <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" /> Last run failed</Badge>
            )}
          </div>
          {schedule.description && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{schedule.description}</p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
            <span><span className="font-mono">{schedule.cronExpression}</span></span>
            {nextRun && <span>next: {nextRun.toLocaleString()}</span>}
            <span>→ {schedule.emailTo}</span>
            <span>owner: {schedule.isMine ? "you" : schedule.owner?.name ?? "—"}</span>
            {schedule.lastRunAt && <span>last run: {new Date(schedule.lastRunAt).toLocaleString()}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {schedule.isMine && (
            <div className="flex items-center gap-2 mr-1">
              <Switch checked={schedule.isActive} onCheckedChange={onToggle} aria-label="Active" />
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={onHistory} title="Run history">
            <History className="h-3.5 w-3.5" />
          </Button>
          {schedule.isMine && (
            <>
              <Button variant="ghost" size="sm" onClick={onRunNow} disabled={runningNow} title="Run now">
                {runningNow ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              </Button>
              <Button asChild variant="ghost" size="sm" title="Edit">
                <Link href={`/automations/${schedule.id}/edit`}>
                  <Pencil className="h-3.5 w-3.5" />
                </Link>
              </Button>
              <Button variant="ghost" size="sm" className="text-destructive" onClick={onDelete} title="Delete">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

function VisibilityBadge({ schedule }: { schedule: Schedule }) {
  if (schedule.visibility === "private") {
    return <Badge variant="outline" className="text-[10px] gap-1"><Lock className="h-2.5 w-2.5" /> Private</Badge>;
  }
  if (schedule.visibility === "team") {
    return <Badge variant="secondary" className="text-[10px] gap-1"><Users className="h-2.5 w-2.5" /> {schedule.team?.name ?? "Team"}</Badge>;
  }
  return <Badge variant="default" className="text-[10px] gap-1"><Globe className="h-2.5 w-2.5" /> Shared</Badge>;
}
