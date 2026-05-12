"use client";
import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Database, Play, Loader2, Plus, Gauge, Clock, BookmarkPlus, Network, FolderTree } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResultsGrid } from "@/components/query/results-grid";
import { SchemaTree } from "@/components/query/schema-tree";
import { SavedQueriesPanel } from "@/components/query/saved-queries-panel";
import { SaveQueryDialog } from "@/components/query/save-query-dialog";
import { useQuery } from "@tanstack/react-query";
import type { QueryResult } from "@/lib/drivers/types";

const MonacoEditor = dynamic(() => import("@/components/query/monaco-editor").then((m) => m.MonacoEditor), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
      Loading editor…
    </div>
  ),
});

type Conn = { id: string; name: string; type: string; access: "read" | "write" };

const DEFAULT_TEMPLATES: Record<string, string> = {
  postgres: "-- ⌘/Ctrl+Enter to execute\nselect now();",
  mysql: "-- ⌘/Ctrl+Enter to execute\nselect now();",
  oracle: "-- Ctrl+Enter to execute\nselect sysdate from dual",
  mongodb: '{\n  "collection": "users",\n  "operation": "find",\n  "filter": {},\n  "limit": 50\n}',
};

const ROW_LIMIT_PRESETS = [
  { value: 1000, label: "1 000" },
  { value: 10000, label: "10 000" },
  { value: 50000, label: "50 000" },
  { value: 100000, label: "100 000 (max)" },
];

const TIMEOUT_PRESETS = [
  { value: 10_000, label: "10s" },
  { value: 30_000, label: "30s" },
  { value: 60_000, label: "60s" },
  { value: 300_000, label: "5m" },
  { value: 600_000, label: "10m" },
  { value: 1_800_000, label: "30m (max)" },
];

export function QueryWorkbench({
  connections,
  initialConnectionId,
  canManageConnections = false,
}: {
  connections: Conn[];
  initialConnectionId?: string;
  canManageConnections?: boolean;
}) {
  const [connectionId, setConnectionId] = React.useState(initialConnectionId ?? "");
  const conn = connections.find((c) => c.id === connectionId);
  const [statement, setStatement] = React.useState("");
  const [result, setResult] = React.useState<QueryResult | null>(null);
  const [executedStatement, setExecutedStatement] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [rowLimit, setRowLimit] = React.useState(10_000);
  const [timeoutMs, setTimeoutMs] = React.useState(60_000);
  const [leftTab, setLeftTab] = React.useState<"schema" | "saved">("schema");
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [resultsFullscreen, setResultsFullscreen] = React.useState(false);

  // Fetch the user's teams once per connection so the save dialog can show them
  // without re-fetching every time it opens.
  const { data: savedMeta } = useQuery<{ myTeams: { id: string; name: string }[] }>({
    queryKey: ["saved-queries-meta", connectionId],
    queryFn: async () => {
      if (!connectionId) return { myTeams: [] };
      const r = await fetch(`/api/db/saved-queries?connectionId=${connectionId}`);
      const j = await r.json();
      if (!r.ok) return { myTeams: [] };
      return { myTeams: j.myTeams ?? [] };
    },
    enabled: !!connectionId,
  });

  React.useEffect(() => {
    if (conn && !statement) setStatement(DEFAULT_TEMPLATES[conn.type] ?? "");
  }, [conn, statement]);

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/db/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId, statement, rowLimit, timeoutMs }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Query failed");
      return json.data as QueryResult;
    },
    onSuccess: (data) => {
      setResult(data);
      setExecutedStatement(statement);
      setError(null);
      toast.success(
        `${data.rowCount.toLocaleString()} row${data.rowCount === 1 ? "" : "s"} · ${data.durationMs}ms${data.truncated ? " (capped)" : ""}`
      );
    },
    onError: (err: Error) => { setError(err.message); setResult(null); toast.error(err.message); },
  });

  const run = () => { if (statement.trim() && connectionId) runMutation.mutate(); };

  if (connections.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-10">
        <div className="text-center max-w-md space-y-3">
          <Database className="h-10 w-10 mx-auto text-muted-foreground" />
          {canManageConnections ? (
            <>
              <h2 className="text-lg font-medium">No databases yet</h2>
              <p className="text-sm text-muted-foreground">
                Add a connection (Postgres, MySQL, MongoDB or Oracle) to start querying.
              </p>
              <Button asChild>
                <Link href="/connections/new"><Plus className="h-4 w-4" /> Add connection</Link>
              </Button>
            </>
          ) : (
            <>
              <h2 className="text-lg font-medium">No databases assigned</h2>
              <p className="text-sm text-muted-foreground">
                Ask an admin to add you to a team that has access to a database.
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b p-3 flex flex-wrap items-center gap-3 bg-card/60">
        <Database className="h-4 w-4 text-muted-foreground" />
        <Select value={connectionId} onValueChange={setConnectionId}>
          <SelectTrigger className="w-72"><SelectValue placeholder="Pick a database" /></SelectTrigger>
          <SelectContent>
            {connections.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name} ({c.type})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {conn && (
          <Badge variant={conn.access === "write" ? "default" : "secondary"}>
            {conn.access === "write" ? "Read & Write" : "Read only"}
          </Badge>
        )}
        <div className="flex-1" />
        <SettingsMenu
          rowLimit={rowLimit}
          setRowLimit={setRowLimit}
          timeoutMs={timeoutMs}
          setTimeoutMs={setTimeoutMs}
        />
        <Button
          variant="outline"
          onClick={() => setSaveOpen(true)}
          disabled={!statement.trim() || !connectionId}
        >
          <BookmarkPlus className="h-4 w-4" /> Save
        </Button>
        <Button onClick={run} disabled={runMutation.isPending || !connectionId}>
          {runMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Run
        </Button>
      </div>
      <div className="flex flex-1 overflow-hidden">
        {!resultsFullscreen && (
          <aside className="w-[25%] min-w-[260px] border-r flex flex-col bg-card/30 min-h-0">
            <div className="flex border-b bg-card/60">
              <SidebarTab active={leftTab === "schema"} onClick={() => setLeftTab("schema")} icon={FolderTree}>
                Schema
              </SidebarTab>
              <SidebarTab active={leftTab === "saved"} onClick={() => setLeftTab("saved")} icon={Network}>
                Saved
              </SidebarTab>
            </div>
            <div className="flex-1 overflow-hidden">
              {conn && leftTab === "schema" && (
                <div className="h-full overflow-auto">
                  <SchemaTree connectionId={conn.id} connectionType={conn.type} />
                </div>
              )}
              {conn && leftTab === "saved" && (
                <SavedQueriesPanel
                  connectionId={conn.id}
                  currentStatement={statement}
                  onLoad={(s) => setStatement(s)}
                />
              )}
            </div>
          </aside>
        )}
        <div className="flex-1 flex flex-col min-w-0">
          {!resultsFullscreen && (
            <div className="h-72 border-b">
              <MonacoEditor
                value={statement}
                onChange={setStatement}
                language={conn?.type === "mongodb" ? "json" : "sql"}
                onRun={run}
              />
            </div>
          )}
          <div className="flex-1 overflow-hidden">
            <Tabs defaultValue="results" className="h-full flex flex-col">
              <div className="px-3 pt-2 border-b">
                <TabsList>
                  <TabsTrigger value="results">Results</TabsTrigger>
                  <TabsTrigger value="error">Issues</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="results" className="flex-1 overflow-hidden m-0">
                {result ? (
                  <ResultsGrid
                    result={result}
                    connectionId={connectionId}
                    statement={executedStatement ?? statement}
                    isFullscreen={resultsFullscreen}
                    onToggleFullscreen={() => setResultsFullscreen((v) => !v)}
                    canWrite={conn?.access === "write"}
                    onMutated={() => runMutation.mutate()}
                  />
                ) : (
                  <Card className="m-3 p-10 text-center text-muted-foreground">
                    Run a query to see results here.
                  </Card>
                )}
              </TabsContent>
              <TabsContent value="error" className="m-0 p-3">
                {error ? (
                  <pre className="text-sm text-destructive whitespace-pre-wrap bg-destructive/10 rounded p-3">{error}</pre>
                ) : (
                  <p className="text-sm text-muted-foreground">No errors.</p>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
      {saveOpen && connectionId && (
        <SaveQueryDialog
          open={saveOpen}
          onOpenChange={setSaveOpen}
          mode="create"
          connectionId={connectionId}
          statement={statement}
          myTeams={savedMeta?.myTeams ?? []}
          onSaved={() => setLeftTab("saved")}
        />
      )}
    </div>
  );
}

function SettingsMenu({
  rowLimit,
  setRowLimit,
  timeoutMs,
  setTimeoutMs,
}: {
  rowLimit: number;
  setRowLimit: (n: number) => void;
  timeoutMs: number;
  setTimeoutMs: (n: number) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Gauge className="h-3.5 w-3.5" />
          {(rowLimit / 1000).toFixed(0)}k rows · {formatTimeout(timeoutMs)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="flex items-center gap-2">
          <Gauge className="h-3.5 w-3.5" /> Row limit
        </DropdownMenuLabel>
        <div className="px-2 pb-2">
          <Select value={String(rowLimit)} onValueChange={(v) => setRowLimit(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ROW_LIMIT_PRESETS.map((p) => (
                <SelectItem key={p.value} value={String(p.value)}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground mt-1">
            Server stops fetching at this many rows. Use Export to download the full result.
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5" /> Statement timeout
        </DropdownMenuLabel>
        <div className="px-2 pb-2">
          <Select value={String(timeoutMs)} onValueChange={(v) => setTimeoutMs(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIMEOUT_PRESETS.map((p) => (
                <SelectItem key={p.value} value={String(p.value)}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground mt-1">
            Queries running longer than this are cancelled server-side.
          </p>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function formatTimeout(ms: number): string {
  if (ms >= 60_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 1000)}s`;
}

function SidebarTab({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex-1 px-3 py-2 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors " +
        (active
          ? "text-foreground border-b-2 border-primary"
          : "text-muted-foreground hover:text-foreground")
      }
    >
      <Icon className="h-3.5 w-3.5" /> {children}
    </button>
  );
}
