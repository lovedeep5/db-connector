"use client";
import * as React from "react";
import { Plus } from "lucide-react";
import { ACTION_CATALOG } from "./node-catalog";
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

/**
 * Compact node palette. Each item is a single row (icon + label only).
 * The full description is exposed via the `title` attribute on hover so
 * the list stays dense — six rows fit in ~200 px instead of 400 px.
 */
export function NodePalette({ onAdd }: { onAdd: (type: string) => void }) {
  return (
    <div className="p-2 space-y-0.5">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground px-2 pt-1 pb-1.5">
        Drag onto canvas
      </div>
      {ACTION_CATALOG.map((c) => {
        const Icon = c.icon;
        return (
          <div
            key={c.type}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(NODE_DRAG_TYPE, c.type);
              e.dataTransfer.effectAllowed = "move";
            }}
            onClick={() => onAdd(c.type)}
            role="button"
            tabIndex={0}
            title={c.description}
            className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/60 cursor-grab active:cursor-grabbing transition-colors"
          >
            <div className={cn("p-1 rounded shrink-0", ACCENT_BG[c.accent] ?? ACCENT_BG.slate)}>
              <Icon className="h-3.5 w-3.5" />
            </div>
            <span className="text-xs font-medium truncate flex-1">{c.label}</span>
            <Plus className="h-3 w-3 opacity-0 group-hover:opacity-60 shrink-0" />
          </div>
        );
      })}
    </div>
  );
}
