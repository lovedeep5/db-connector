"use client";
import * as React from "react";
import { Wand2, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type RefPath = {
  /** What gets inserted into the field. e.g. "{{ $node.q1.rowCount }}" */
  template: string;
  /** What's shown next to the entry (e.g. "10", "object", "string") */
  preview?: string;
};

export type RefGroup = {
  /** Group heading — "Trigger", or the upstream node's label + id. */
  label: string;
  paths: RefPath[];
};

/**
 * Dropdown button that lets the user insert a templated reference
 * (`{{ $node.q1.rowCount }}`) into a text field. The parent is responsible
 * for placing the chosen string at the cursor.
 */
export function RefPicker({
  groups,
  onPick,
  disabled,
}: {
  groups: RefGroup[];
  onPick: (template: string) => void;
  disabled?: boolean;
}) {
  if (groups.length === 0 || groups.every((g) => g.paths.length === 0)) {
    return null;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant="ghost" disabled={disabled} className="h-6 text-[10px] gap-1 px-1.5">
          <Wand2 className="h-3 w-3" /> Insert ref
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-h-80 overflow-y-auto">
        {groups.map((g, i) => (
          <React.Fragment key={g.label + i}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {g.label}
            </DropdownMenuLabel>
            {g.paths.length === 0 ? (
              <div className="px-2 py-1 text-[11px] text-muted-foreground italic">No paths — run the flow to discover them.</div>
            ) : (
              g.paths.map((p) => (
                <RefRow key={p.template} path={p} onPick={onPick} />
              ))
            )}
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RefRow({ path, onPick }: { path: RefPath; onPick: (t: string) => void }) {
  const [copied, setCopied] = React.useState(false);
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(path.template);
    setCopied(true);
    toast.success("Copied");
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div
      role="menuitem"
      onClick={() => onPick(path.template)}
      className="group flex items-center gap-1.5 px-2 py-1.5 text-sm rounded-sm cursor-pointer hover:bg-accent"
    >
      <code className="text-[10px] truncate flex-1">{path.template}</code>
      {path.preview && (
        <span className="text-[10px] text-muted-foreground shrink-0 max-w-[100px] truncate">
          {path.preview}
        </span>
      )}
      <button
        type="button"
        onClick={copy}
        className="h-5 w-5 rounded hover:bg-background flex items-center justify-center shrink-0 opacity-50 group-hover:opacity-100 transition-opacity"
        aria-label="Copy reference"
        title="Copy"
      >
        {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  );
}
