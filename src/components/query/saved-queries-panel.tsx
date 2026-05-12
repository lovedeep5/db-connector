"use client";
import * as React from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  BookmarkPlus,
  Globe,
  Lock,
  Users,
  Trash2,
  Pencil,
  Loader2,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { SaveQueryDialog } from "@/components/query/save-query-dialog";
import { deleteSavedQuery } from "@/server/actions/saved-queries";

export type SavedQuery = {
  id: string;
  name: string;
  description: string | null;
  statement: string;
  visibility: "private" | "team" | "connection";
  sharedWithTeamId: string | null;
  userId: string;
  isMine: boolean;
  owner: { id: string; name: string; email: string } | null;
  team: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
};

type ListResponse = { data: SavedQuery[]; myTeams: { id: string; name: string }[] };

export function SavedQueriesPanel({
  connectionId,
  currentStatement,
  onLoad,
}: {
  connectionId: string;
  currentStatement: string;
  onLoad: (statement: string) => void;
}) {
  const qc = useQueryClient();
  const [filter, setFilter] = React.useState("");
  const [scope, setScope] = React.useState<"all" | "mine" | "shared">("all");
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<SavedQuery | null>(null);

  const { data, isLoading, refetch } = useQuery<ListResponse>({
    queryKey: ["saved-queries", connectionId],
    queryFn: async () => {
      const r = await fetch(`/api/db/saved-queries?connectionId=${connectionId}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      return j as ListResponse;
    },
    enabled: !!connectionId,
  });

  const filtered = React.useMemo(() => {
    if (!data) return [] as SavedQuery[];
    let rows = data.data;
    if (scope === "mine") rows = rows.filter((r) => r.isMine);
    if (scope === "shared") rows = rows.filter((r) => !r.isMine);
    if (filter.trim()) {
      const f = filter.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(f) ||
          (r.description ?? "").toLowerCase().includes(f) ||
          r.statement.toLowerCase().includes(f)
      );
    }
    return rows;
  }, [data, scope, filter]);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => deleteSavedQuery(id),
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["saved-queries", connectionId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="text-sm flex flex-col h-full">
      <div className="p-2 border-b space-y-2">
        <div className="relative">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search saved queries…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 pl-7"
          />
        </div>
        <div className="flex items-center gap-1">
          {(["all", "mine", "shared"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={cn(
                "px-2 py-0.5 rounded text-xs",
                scope === s
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-accent"
              )}
            >
              {s === "all" ? "All" : s === "mine" ? "Mine" : "Shared with me"}
            </button>
          ))}
          <div className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setSaveOpen(true)}
            disabled={!currentStatement.trim()}
            title={currentStatement.trim() ? "" : "Write something in the editor first"}
          >
            <BookmarkPlus className="h-3.5 w-3.5" /> Save current
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="p-3 flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div className="p-4 text-xs text-muted-foreground text-center">
            {data && data.data.length === 0
              ? "No saved queries yet. Click 'Save current' to add one."
              : "Nothing matches that filter."}
          </div>
        )}
        <ul className="divide-y">
          {filtered.map((q) => (
            <li key={q.id} className="group p-3 hover:bg-accent/50">
              <button
                type="button"
                onClick={() => onLoad(q.statement)}
                className="text-left w-full"
              >
                <div className="flex items-start gap-1.5">
                  <span className="font-medium truncate">{q.name}</span>
                  <VisibilityBadge q={q} />
                </div>
                {q.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {q.description}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground mt-1">
                  {q.isMine ? "You" : q.owner?.name || q.owner?.email || "—"}
                  {" · "}
                  {new Date(q.updatedAt).toLocaleDateString()}
                </p>
              </button>
              {q.isMine && (
                <div className="flex gap-1 mt-1 opacity-0 group-hover:opacity-100 transition">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={(e) => { e.stopPropagation(); setEditing(q); }}
                    title="Edit"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete "${q.name}"?`)) deleteMutation.mutate(q.id);
                    }}
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      {saveOpen && (
        <SaveQueryDialog
          open={saveOpen}
          onOpenChange={setSaveOpen}
          mode="create"
          connectionId={connectionId}
          statement={currentStatement}
          myTeams={data?.myTeams ?? []}
          onSaved={() => refetch()}
        />
      )}
      {editing && (
        <SaveQueryDialog
          open={!!editing}
          onOpenChange={(v) => !v && setEditing(null)}
          mode="edit"
          id={editing.id}
          statement={editing.statement}
          initial={{
            name: editing.name,
            description: editing.description ?? "",
            visibility: editing.visibility,
            sharedWithTeamId: editing.sharedWithTeamId ?? undefined,
          }}
          myTeams={data?.myTeams ?? []}
          onSaved={() => refetch()}
        />
      )}
    </div>
  );
}

function VisibilityBadge({ q }: { q: SavedQuery }) {
  if (q.visibility === "private") {
    return (
      <Badge variant="outline" className="text-[10px] gap-1">
        <Lock className="h-2.5 w-2.5" /> Private
      </Badge>
    );
  }
  if (q.visibility === "team") {
    return (
      <Badge variant="secondary" className="text-[10px] gap-1">
        <Users className="h-2.5 w-2.5" /> {q.team?.name ?? "Team"}
      </Badge>
    );
  }
  return (
    <Badge variant="default" className="text-[10px] gap-1">
      <Globe className="h-2.5 w-2.5" /> Shared
    </Badge>
  );
}
