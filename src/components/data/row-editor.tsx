"use client";
import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, Loader2, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export type EditorColumn = {
  /** Alias as it appears in the row object */
  alias: string;
  /** Real column name to use when sending to the server */
  source: string;
  isPrimaryKey: boolean;
  dataType?: string;
  nullable?: boolean;
};

type Common = {
  connectionId: string;
  schema: string;
  table: string;
  columns: EditorColumn[];
  onDone: () => void;
};

// ─────────────────────────── Edit row ────────────────────────────

export function EditRowDialog({
  open,
  onOpenChange,
  row,
  ...c
}: Common & {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  row: Record<string, unknown>;
}) {
  const [values, setValues] = React.useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const col of c.columns) v[col.source] = stringify(row[col.alias]);
    return v;
  });

  const m = useMutation({
    mutationFn: async () => {
      const where: Record<string, unknown> = {};
      for (const col of c.columns) {
        if (col.isPrimaryKey) where[col.source] = row[col.alias];
      }
      if (Object.keys(where).length === 0) throw new Error("No primary key found in this row");
      const set: Record<string, unknown> = {};
      for (const col of c.columns) {
        if (col.isPrimaryKey) continue;
        const original = stringify(row[col.alias]);
        if (values[col.source] !== original) {
          set[col.source] = parseValue(values[col.source]);
        }
      }
      if (Object.keys(set).length === 0) throw new Error("Nothing changed");
      const r = await fetch("/api/db/rows?action=update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: c.connectionId, schema: c.schema, name: c.table, where, set }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      return j.data;
    },
    onSuccess: () => { toast.success("Row updated"); c.onDone(); onOpenChange(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit row</DialogTitle>
          <DialogDescription>
            Empty fields are saved as null. Use JSON literal for arrays/objects.
            Editing {c.schema}.{c.table}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {c.columns.map((col) => (
            <FieldRow
              key={col.source}
              col={col}
              value={values[col.source] ?? ""}
              onChange={(v) => setValues((m) => ({ ...m, [col.source]: v }))}
              disabled={col.isPrimaryKey}
            />
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending}>
            {m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────── Insert row ────────────────────────────

export function InsertRowDialog({
  trigger,
  ...c
}: Common & {
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [values, setValues] = React.useState<Record<string, string>>({});

  const m = useMutation({
    mutationFn: async () => {
      const row: Record<string, unknown> = {};
      for (const col of c.columns) {
        const v = values[col.source];
        if (v === undefined || v === "") continue;
        row[col.source] = parseValue(v);
      }
      const r = await fetch("/api/db/rows?action=insert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: c.connectionId, schema: c.schema, name: c.table, row }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      return j.data;
    },
    onSuccess: () => { toast.success("Row inserted"); c.onDone(); setOpen(false); setValues({}); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline">
            <Plus className="h-3.5 w-3.5" /> Insert
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Insert row</DialogTitle>
          <DialogDescription>
            Leave fields empty to use defaults. Use JSON for objects/arrays. Inserting into{" "}
            {c.schema}.{c.table}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {c.columns.map((col) => (
            <FieldRow
              key={col.source}
              col={col}
              value={values[col.source] ?? ""}
              onChange={(v) => setValues((m) => ({ ...m, [col.source]: v }))}
              placeholder={col.nullable ? "(null)" : ""}
            />
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending}>
            {m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Insert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────── Delete row ────────────────────────────

export function deleteRowMutationArgs(c: Common, row: Record<string, unknown>) {
  const where: Record<string, unknown> = {};
  for (const col of c.columns) {
    if (col.isPrimaryKey) where[col.source] = row[col.alias];
  }
  if (Object.keys(where).length === 0) throw new Error("No primary key found in this row");
  return { connectionId: c.connectionId, schema: c.schema, name: c.table, where };
}

export function DeleteRowDialog({
  open,
  onOpenChange,
  row,
  ...c
}: Common & {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  row: Record<string, unknown>;
}) {
  const m = useMutation({
    mutationFn: async () => {
      const body = deleteRowMutationArgs(c, row);
      const r = await fetch("/api/db/rows?action=delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      return j.data;
    },
    onSuccess: () => { toast.success("Row deleted"); c.onDone(); onOpenChange(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const pkSummary = c.columns
    .filter((col) => col.isPrimaryKey)
    .map((col) => `${col.source}=${String(row[col.alias])}`)
    .join(", ");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete row?</DialogTitle>
          <DialogDescription>
            This permanently removes the row in {c.schema}.{c.table} where {pkSummary}.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" disabled={m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────── Helpers ────────────────────────────

function FieldRow({
  col,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  col: EditorColumn;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs flex items-center gap-1">
        {col.isPrimaryKey && <KeyRound className="h-3 w-3 text-amber-500" />}
        <span className="font-mono">{col.source}</span>
        {col.dataType && <span className="text-muted-foreground">{col.dataType}</span>}
        {col.nullable && <Badge variant="outline">nullable</Badge>}
      </Label>
      <Input
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono text-xs"
        placeholder={placeholder}
      />
    </div>
  );
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function parseValue(raw: string): unknown {
  if (raw === "") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if (/^-?\d*\.\d+$/.test(raw)) return Number(raw);
  if ((raw.startsWith("{") && raw.endsWith("}")) || (raw.startsWith("[") && raw.endsWith("]"))) {
    try { return JSON.parse(raw); } catch { /* fall through */ }
  }
  return raw;
}
