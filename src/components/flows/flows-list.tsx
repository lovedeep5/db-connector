"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  Globe,
  History,
  Loader2,
  Lock,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Users,
  Webhook,
  CalendarClock,
  MousePointerClick,
  Workflow,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  createSampleFlow,
  deleteFlow,
  runFlowNow,
  setFlowActive,
} from "@/server/actions/flows";

export type FlowRow = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  triggerType: "schedule" | "manual" | "webhook";
  visibility: "private" | "team" | "everyone";
  sharedWithTeamId: string | null;
  executionMode: "sequential" | "parallel";
  maxConcurrentRuns: number;
  isMine: boolean;
  owner: { id: string; name: string; email: string } | null;
  team: { id: string; name: string } | null;
  lastRunAt: string | null;
  lastRunStatus: "success" | "error" | "skipped" | "cancelled" | null;
  createdAt: string;
  updatedAt: string;
};

export function FlowsList({
  canCreate,
}: {
  canCreate: boolean;
  connections: { id: string; name: string; type: string }[];
  myTeams: { id: string; name: string }[];
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const { data, isLoading } = useQuery<{ data: FlowRow[] }>({
    queryKey: ["flows"],
    queryFn: async () => {
      const r = await fetch("/api/flows");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      return j;
    },
  });

  const sample = useMutation({
    mutationFn: () => createSampleFlow(),
    onSuccess: (newId) => {
      toast.success("Sample flow created — review the steps and click Run now");
      qc.invalidateQueries({ queryKey: ["flows"] });
      router.push(`/flows/${newId}/edit`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runNow = useMutation({
    mutationFn: async (id: string) => runFlowNow(id),
    onSuccess: (r) => {
      toast.success(r.status === "success" ? "Flow ran successfully" : "Flow ran with errors");
      qc.invalidateQueries({ queryKey: ["flows"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Workflow className="h-6 w-6" /> Flows
          </h1>
          <p className="text-sm text-muted-foreground">
            Build automations as a graph of triggers, queries, transforms and outputs.
          </p>
        </div>
        {canCreate && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => sample.mutate()} disabled={sample.isPending}>
              {sample.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Try a sample
            </Button>
            <Button asChild>
              <Link href="/flows/new"><Plus className="h-4 w-4" /> New flow</Link>
            </Button>
          </div>
        )}
      </div>

      {!canCreate ? (
        <Card className="p-10 text-center text-muted-foreground">
          You don&apos;t have access to any databases yet — flows need at least one connection.
        </Card>
      ) : isLoading ? (
        <Card className="p-10 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></Card>
      ) : (data?.data ?? []).length === 0 ? (
        <Card className="p-10 text-center space-y-3">
          <Workflow className="h-10 w-10 text-muted-foreground mx-auto" />
          <h2 className="text-lg font-medium">No flows yet</h2>
          <p className="text-sm text-muted-foreground">
            Drag together a trigger, a DB query, a transform, an output — saved and runnable on demand or on schedule.
          </p>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={() => sample.mutate()} disabled={sample.isPending}>
              {sample.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Try a sample
            </Button>
            <Button asChild>
              <Link href="/flows/new"><Plus className="h-4 w-4" /> Create from scratch</Link>
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(data?.data ?? []).map((f) => (
            <FlowCard
              key={f.id}
              flow={f}
              onToggle={async (v) => {
                try { await setFlowActive(f.id, v); toast.success(v ? "Activated" : "Paused"); qc.invalidateQueries({ queryKey: ["flows"] }); }
                catch (e) { toast.error((e as Error).message); }
              }}
              onRunNow={() => runNow.mutate(f.id)}
              running={runNow.isPending && runNow.variables === f.id}
              onDelete={async () => {
                if (!confirm(`Delete flow "${f.name}"? Run history will also be removed.`)) return;
                try { await deleteFlow(f.id); toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["flows"] }); }
                catch (e) { toast.error((e as Error).message); }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FlowCard({
  flow,
  onToggle,
  onRunNow,
  running,
  onDelete,
}: {
  flow: FlowRow;
  onToggle: (v: boolean) => void;
  onRunNow: () => void;
  running: boolean;
  onDelete: () => void;
}) {
  return (
    <Card className="p-4 space-y-3 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-medium truncate flex items-center gap-1.5">
            <TriggerIcon t={flow.triggerType} />
            <span className="truncate">{flow.name}</span>
          </h3>
          {flow.description && <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{flow.description}</p>}
        </div>
        <VisibilityBadge flow={flow} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {flow.lastRunStatus === "success" && (
          <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Last OK</Badge>
        )}
        {flow.lastRunStatus === "error" && (
          <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" /> Last failed</Badge>
        )}
        <Badge variant="outline" className="text-[10px]">{flow.executionMode}</Badge>
        <Badge variant="outline" className="text-[10px]">cap {flow.maxConcurrentRuns}</Badge>
      </div>

      <div className="text-[11px] text-muted-foreground">
        owner: {flow.isMine ? "you" : flow.owner?.name ?? "—"}
        {flow.lastRunAt && <> · last run: {new Date(flow.lastRunAt).toLocaleString()}</>}
      </div>

      <div className="flex items-center gap-1 pt-1">
        {flow.isMine && (
          <Switch checked={flow.isActive} onCheckedChange={onToggle} aria-label="Active" />
        )}
        <div className="flex-1" />
        <Button asChild variant="ghost" size="sm" title="Run history">
          <Link href={`/flows/${flow.id}/runs`}><History className="h-3.5 w-3.5" /></Link>
        </Button>
        {flow.isMine && (
          <>
            <Button variant="ghost" size="sm" onClick={onRunNow} disabled={running} title="Run now">
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            </Button>
            <Button asChild variant="ghost" size="sm" title="Edit">
              <Link href={`/flows/${flow.id}/edit`}><Pencil className="h-3.5 w-3.5" /></Link>
            </Button>
            <Button variant="ghost" size="sm" className="text-destructive" onClick={onDelete} title="Delete">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

function TriggerIcon({ t }: { t: FlowRow["triggerType"] }) {
  if (t === "schedule") return <CalendarClock className="h-4 w-4 text-blue-500" />;
  if (t === "webhook") return <Webhook className="h-4 w-4 text-violet-500" />;
  return <MousePointerClick className="h-4 w-4 text-muted-foreground" />;
}

function VisibilityBadge({ flow }: { flow: FlowRow }) {
  if (flow.visibility === "private") return <Badge variant="outline" className="text-[10px] gap-1"><Lock className="h-2.5 w-2.5" /> Private</Badge>;
  if (flow.visibility === "team") return <Badge variant="secondary" className="text-[10px] gap-1"><Users className="h-2.5 w-2.5" /> {flow.team?.name ?? "Team"}</Badge>;
  return <Badge variant="default" className="text-[10px] gap-1"><Globe className="h-2.5 w-2.5" /> Everyone</Badge>;
}
