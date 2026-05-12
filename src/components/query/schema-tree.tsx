"use client";
import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ChevronDown, Table2, Eye, Folder, Loader2, Box } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

type SchemaInfo = { name: string };
type ObjectInfo = { schema: string; name: string; kind: "table" | "view" | "collection" };

export function SchemaTree({ connectionId, connectionType }: { connectionId: string; connectionType: string }) {
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  const [filter, setFilter] = React.useState("");

  const { data: schemas, isLoading } = useQuery({
    queryKey: ["schemas", connectionId],
    queryFn: async () => {
      const r = await fetch(`/api/db/schemas?connectionId=${connectionId}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      return j.data as SchemaInfo[];
    },
  });

  return (
    <div className="text-sm">
      <div className="p-2 border-b">
        <Input
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-8"
        />
      </div>
      <div className="p-1">
        {isLoading && (
          <div className="p-3 text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}
        {schemas?.map((s) => (
          <SchemaNode
            key={s.name}
            connectionId={connectionId}
            schemaName={s.name}
            open={!!open[s.name]}
            onToggle={() => setOpen((m) => ({ ...m, [s.name]: !m[s.name] }))}
            filter={filter}
          />
        ))}
      </div>
    </div>
  );
}

function SchemaNode({
  connectionId,
  schemaName,
  open,
  onToggle,
  filter,
}: {
  connectionId: string;
  schemaName: string;
  open: boolean;
  onToggle: () => void;
  filter: string;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["objects", connectionId, schemaName],
    queryFn: async () => {
      const r = await fetch(`/api/db/objects?connectionId=${connectionId}&schema=${encodeURIComponent(schemaName)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      return j.data as ObjectInfo[];
    },
    enabled: open,
  });

  const filtered = (data ?? []).filter((o) =>
    filter ? o.name.toLowerCase().includes(filter.toLowerCase()) : true
  );

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "flex items-center gap-1 w-full px-2 py-1 rounded hover:bg-accent hover:text-accent-foreground text-left font-medium"
        )}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Folder className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="truncate">{schemaName}</span>
      </button>
      {open && (
        <div className="pl-5">
          {isLoading && (
            <div className="p-2 text-muted-foreground text-xs">Loading…</div>
          )}
          {filtered.map((o) => {
            const Icon = o.kind === "view" ? Eye : o.kind === "collection" ? Box : Table2;
            return (
              <Link
                key={o.schema + ":" + o.name}
                href={`/connections/${connectionId}/${encodeURIComponent(o.schema)}/${encodeURIComponent(o.name)}`}
                className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="truncate">{o.name}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
