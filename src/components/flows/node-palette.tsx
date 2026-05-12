"use client";
import * as React from "react";
import { Plus, Search, X } from "lucide-react";
import { CATALOG, type CatalogEntry } from "./node-catalog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const ACCENT_BG: Record<string, string> = {
  blue: "bg-blue-500/10 text-blue-600",
  violet: "bg-violet-500/10 text-violet-600",
  emerald: "bg-emerald-500/10 text-emerald-600",
  amber: "bg-amber-500/10 text-amber-700",
  rose: "bg-rose-500/10 text-rose-600",
  slate: "bg-slate-500/10 text-slate-600",
};

/** dataTransfer key used between palette and canvas drop target. */
export const NODE_DRAG_TYPE = "application/dbc-node-type";

type TabKey = "triggers" | "actions" | "control";

const TABS: { key: TabKey; label: string }[] = [
  { key: "triggers", label: "Triggers" },
  { key: "actions", label: "Actions" },
  { key: "control", label: "Flow Control" },
];

/**
 * Map a catalog entry to a tab. The catalog's existing `category` field is
 * already the right discriminator — trigger → Triggers, control → Flow
 * Control, everything else (data/io/transform) → Actions.
 */
function tabOf(entry: CatalogEntry): TabKey {
  if (entry.category === "trigger") return "triggers";
  if (entry.category === "control") return "control";
  return "actions";
}

function matchesSearch(entry: CatalogEntry, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return entry.label.toLowerCase().includes(needle)
    || entry.description.toLowerCase().includes(needle)
    || entry.type.toLowerCase().includes(needle);
}

/**
 * Node palette with three tabs and a search box. Search filters within the
 * active tab; if the query matches nothing in the active tab, we auto-switch
 * to the first tab that has matches — saves the user a click.
 */
export function NodePalette({ onAdd }: { onAdd: (type: string) => void }) {
  const [tab, setTab] = React.useState<TabKey>("triggers");
  const [query, setQuery] = React.useState("");

  // Partition catalog once per tab; cheap and avoids per-keystroke re-sorts.
  const byTab = React.useMemo(() => {
    const out: Record<TabKey, CatalogEntry[]> = { triggers: [], actions: [], control: [] };
    for (const c of CATALOG) out[tabOf(c)].push(c);
    return out;
  }, []);

  const visibleInTab = React.useMemo(
    () => byTab[tab].filter((c) => matchesSearch(c, query)),
    [byTab, tab, query]
  );

  // Counts per tab for the search-aware tab badges.
  const counts = React.useMemo(() => {
    const out: Record<TabKey, number> = { triggers: 0, actions: 0, control: 0 };
    for (const k of Object.keys(byTab) as TabKey[]) {
      out[k] = byTab[k].filter((c) => matchesSearch(c, query)).length;
    }
    return out;
  }, [byTab, query]);

  // If the user types something that doesn't match the current tab, hop to
  // the first tab that does have matches so they don't see an empty list.
  React.useEffect(() => {
    if (!query) return;
    if (counts[tab] > 0) return;
    const next = TABS.find((t) => counts[t.key] > 0);
    if (next) setTab(next.key);
  }, [query, counts, tab]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b space-y-2">
        <div className="relative">
          <Search className="h-3 w-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search nodes"
            className="pl-7 pr-7 h-7 text-xs"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-accent"
              aria-label="Clear search"
            >
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          )}
        </div>
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "flex-1 text-[10px] font-medium px-1.5 py-1 rounded-md transition-colors flex items-center justify-center gap-1",
                tab === t.key
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <span className="truncate">{t.label}</span>
              {query && counts[t.key] !== byTab[t.key].length && (
                <span className="text-[9px] opacity-70">{counts[t.key]}</span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {visibleInTab.length === 0 ? (
          <div className="text-[11px] text-muted-foreground px-2 py-4 text-center">
            {query ? `No matches for "${query}"` : "Nothing here yet"}
          </div>
        ) : (
          visibleInTab.map((c) => <PaletteItem key={c.type} entry={c} onAdd={onAdd} />)
        )}
      </div>
    </div>
  );
}

function PaletteItem({ entry, onAdd }: { entry: CatalogEntry; onAdd: (type: string) => void }) {
  const Icon = entry.icon;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(NODE_DRAG_TYPE, entry.type);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => onAdd(entry.type)}
      role="button"
      tabIndex={0}
      title={entry.description}
      className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/60 cursor-grab active:cursor-grabbing transition-colors"
    >
      <div className={cn("p-1 rounded shrink-0", ACCENT_BG[entry.accent] ?? ACCENT_BG.slate)}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <span className="text-xs font-medium truncate flex-1">{entry.label}</span>
      <Plus className="h-3 w-3 opacity-0 group-hover:opacity-60 shrink-0" />
    </div>
  );
}
