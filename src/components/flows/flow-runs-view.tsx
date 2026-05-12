"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Loader2, MinusCircle, Webhook, CalendarClock, MousePointerClick } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, truncate } from "@/lib/utils";

type Run = {
  id: string;
  triggerType: "schedule" | "manual" | "webhook";
  status: "pending" | "running" | "success" | "error" | "cancelled";
  durationMs: number | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
};

type NodeRun = {
  id: string;
  nodeId: string;
  nodeType: string;
  status: "pending" | "running" | "success" | "error" | "skipped";
  durationMs: number | null;
  errorMessage: string | null;
  input: string | null;
  output: string | null;
  startedAt: string;
};

export function FlowRunsView({ flowId }: { flowId: string }) {
  const { data, isLoading, refetch } = useQuery<{ data: Run[]; nodeRunsForLatest: NodeRun[] }>({
    queryKey: ["flow-runs", flowId],
    queryFn: async () => {
      const r = await fetch(`/api/flows/${flowId}/runs`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      return j;
    },
    refetchInterval: 5000,
  });

  if (isLoading) return <Card className="p-6 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></Card>;
  if (!data || data.data.length === 0)
    return <Card className="p-10 text-center text-muted-foreground">No runs yet. Trigger one to see results here.</Card>;

  return (
    <div className="space-y-2">
      {data.data.map((r, i) => (
        <RunCard key={r.id} run={r} expandedNodeRuns={i === 0 ? data.nodeRunsForLatest : null} onRefresh={() => refetch()} />
      ))}
    </div>
  );
}

function RunCard({ run, expandedNodeRuns }: { run: Run; expandedNodeRuns: NodeRun[] | null; onRefresh: () => void }) {
  const [open, setOpen] = React.useState(!!expandedNodeRuns);
  return (
    <Card className="p-3">
      <button
        type="button"
        className="w-full flex items-center gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <StatusBadge status={run.status} />
        <TriggerIcon t={run.triggerType} />
        <span className="text-xs text-muted-foreground">{new Date(run.startedAt).toLocaleString()}</span>
        {run.durationMs !== null && <span className="text-xs text-muted-foreground">· {run.durationMs}ms</span>}
        {run.errorMessage && <span className="text-xs text-destructive truncate">· {truncate(run.errorMessage, 80)}</span>}
      </button>
      {open && expandedNodeRuns && (
        <ul className="mt-2 pl-6 space-y-1.5">
          {expandedNodeRuns.map((n) => <NodeRunRow key={n.id} n={n} />)}
        </ul>
      )}
    </Card>
  );
}

function NodeRunRow({ n }: { n: NodeRun }) {
  const [open, setOpen] = React.useState(false);
  return (
    <li className={cn("text-xs border-l-2 pl-3", n.status === "error" ? "border-destructive" : "border-border")}>
      <button type="button" className="flex items-center gap-2 w-full text-left" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span className="font-mono">{n.nodeId}</span>
        <Badge variant="outline" className="text-[10px]">{n.nodeType}</Badge>
        <StatusBadge status={n.status} small />
        {n.durationMs !== null && <span className="text-muted-foreground">{n.durationMs}ms</span>}
      </button>
      {open && (
        <div className="mt-1 space-y-2 pl-5">
          {n.errorMessage && (
            <pre className="bg-destructive/10 text-destructive p-2 rounded text-[11px] whitespace-pre-wrap">{n.errorMessage}</pre>
          )}
          {n.input && (
            <details className="text-[11px]">
              <summary className="cursor-pointer text-muted-foreground">input</summary>
              <pre className="mt-1 p-2 bg-muted rounded text-[11px] overflow-x-auto whitespace-pre">{prettyJSON(n.input)}</pre>
            </details>
          )}
          {n.output && (
            <details className="text-[11px]">
              <summary className="cursor-pointer text-muted-foreground">output</summary>
              <pre className="mt-1 p-2 bg-muted rounded text-[11px] overflow-x-auto whitespace-pre">{prettyJSON(n.output)}</pre>
            </details>
          )}
        </div>
      )}
    </li>
  );
}

function StatusBadge({ status, small }: { status: string; small?: boolean }) {
  const cls = small ? "text-[10px]" : "";
  if (status === "success") return <Badge variant="success" className={cn("gap-1", cls)}><CheckCircle2 className="h-3 w-3" /> success</Badge>;
  if (status === "error") return <Badge variant="destructive" className={cn("gap-1", cls)}><AlertCircle className="h-3 w-3" /> error</Badge>;
  if (status === "skipped" || status === "cancelled") return <Badge variant="secondary" className={cn("gap-1", cls)}><MinusCircle className="h-3 w-3" /> {status}</Badge>;
  return <Badge variant="outline" className={cn("gap-1", cls)}>{status}</Badge>;
}

function TriggerIcon({ t }: { t: Run["triggerType"] }) {
  if (t === "schedule") return <CalendarClock className="h-3.5 w-3.5 text-blue-500" />;
  if (t === "webhook") return <Webhook className="h-3.5 w-3.5 text-violet-500" />;
  return <MousePointerClick className="h-3.5 w-3.5 text-muted-foreground" />;
}

function prettyJSON(raw: string): string {
  try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
}
