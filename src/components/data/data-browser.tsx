"use client";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Pencil,
  Trash2,
  FileJson,
  FileSpreadsheet,
  FileText,
  KeyRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exportRows } from "@/lib/export";
import { triggerServerExport } from "@/lib/server-export";
import { truncate } from "@/lib/utils";
import type { QueryResult } from "@/lib/drivers/types";
import {
  DeleteRowDialog,
  EditRowDialog,
  InsertRowDialog,
  type EditorColumn,
} from "@/components/data/row-editor";

type Column = {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
};

type Props = {
  connectionId: string;
  connectionType: string;
  schema: string;
  name: string;
  access: "read" | "write";
  columns: Column[];
};

const PAGE_SIZE = 100;

export function DataBrowser({ connectionId, connectionType, schema, name, access, columns }: Props) {
  const [page, setPage] = React.useState(0);
  const qc = useQueryClient();

  const cacheKey = ["rows", connectionId, schema, name, page] as const;
  const { data, isFetching, refetch } = useQuery({
    queryKey: cacheKey,
    queryFn: async () => {
      const r = await fetch(`/api/db/rows?action=fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId,
          schema,
          name,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      return j.data as QueryResult;
    },
  });

  const cols = data?.columns ?? columns.map((c) => c.name);
  const pkColumns = columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
  const canEdit = access === "write" && pkColumns.length > 0;
  const canInsert = access === "write";

  const editorColumns: EditorColumn[] = React.useMemo(
    () =>
      columns.map((c) => ({
        alias: c.name,
        source: c.name,
        isPrimaryKey: c.isPrimaryKey,
        dataType: c.dataType,
        nullable: c.nullable,
      })),
    [columns]
  );

  const invalidate = React.useCallback(
    () => qc.invalidateQueries({ queryKey: ["rows", connectionId, schema, name] }),
    [qc, connectionId, schema, name]
  );

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-3 py-2 flex items-center justify-between gap-2 bg-card/50">
        <div className="text-xs text-muted-foreground">
          {pkColumns.length > 0 ? (
            <span className="flex items-center gap-1">
              <KeyRound className="h-3.5 w-3.5" /> PK: {pkColumns.join(", ")}
            </span>
          ) : (
            <span>No primary key — edits disabled.</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
          {canInsert && (
            <InsertRowDialog
              connectionId={connectionId}
              schema={schema}
              table={name}
              columns={editorColumns}
              onDone={invalidate}
            />
          )}
          {data?.rows.length ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline"><Download className="h-3.5 w-3.5" /> Export</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem onSelect={() => triggerServerExport({ connectionId, schema, table: name, format: "csv" })}>
                  <FileText className="h-4 w-4" /> Entire table · CSV (streamed)
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => triggerServerExport({ connectionId, schema, table: name, format: "ndjson" })}>
                  <FileJson className="h-4 w-4" /> Entire table · NDJSON (streamed)
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportRows(data.rows, name, "csv")}>
                  <FileText className="h-4 w-4" /> Current page · CSV
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportRows(data.rows, name, "json")}>
                  <FileJson className="h-4 w-4" /> Current page · JSON
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportRows(data.rows, name, "xlsx")}>
                  <FileSpreadsheet className="h-4 w-4" /> Current page · Excel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <div className="flex items-center gap-1 text-xs">
            <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            Page {page + 1}
            <Button size="sm" variant="ghost" disabled={(data?.rows.length ?? 0) < PAGE_SIZE} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {!data && isFetching && (
          <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
        )}
        {data && data.rows.length === 0 && (
          <div className="p-10 text-center text-sm text-muted-foreground">No rows.</div>
        )}
        {data && data.rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                {cols.map((c) => {
                  const meta = columns.find((cc) => cc.name === c);
                  return (
                    <TableHead key={c} className="font-mono text-xs whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        {meta?.isPrimaryKey && <KeyRound className="h-3 w-3 text-amber-500" />}
                        {c}
                        {meta && <span className="text-muted-foreground">·{meta.dataType}</span>}
                      </div>
                    </TableHead>
                  );
                })}
                {canEdit && <TableHead className="w-20"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row, i) => (
                <RowItem
                  key={i}
                  row={row}
                  cols={cols}
                  canEdit={canEdit}
                  connectionId={connectionId}
                  schema={schema}
                  name={name}
                  editorColumns={editorColumns}
                  onDone={invalidate}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <div className="border-t px-3 py-2 text-xs text-muted-foreground">
        {data ? `${data.rows.length} rows · ${data.durationMs}ms` : ""}
        {connectionType === "mongodb" && " · Mongo edits use the _id field as primary key."}
      </div>
    </div>
  );
}

function renderCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return truncate(JSON.stringify(v), 120);
  return truncate(String(v), 120);
}

function RowItem({
  row,
  cols,
  canEdit,
  connectionId,
  schema,
  name,
  editorColumns,
  onDone,
}: {
  row: Record<string, unknown>;
  cols: string[];
  canEdit: boolean;
  connectionId: string;
  schema: string;
  name: string;
  editorColumns: EditorColumn[];
  onDone: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  return (
    <>
      <TableRow>
        {cols.map((c) => (
          <TableCell key={c} className="font-mono text-xs whitespace-nowrap">{renderCell(row[c])}</TableCell>
        ))}
        {canEdit && (
          <TableCell className="text-right">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleting(true)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </TableCell>
        )}
      </TableRow>
      {editing && (
        <EditRowDialog
          open={editing}
          onOpenChange={setEditing}
          row={row}
          connectionId={connectionId}
          schema={schema}
          table={name}
          columns={editorColumns}
          onDone={() => { setEditing(false); onDone(); }}
        />
      )}
      {deleting && (
        <DeleteRowDialog
          open={deleting}
          onOpenChange={setDeleting}
          row={row}
          connectionId={connectionId}
          schema={schema}
          table={name}
          columns={editorColumns}
          onDone={() => { setDeleting(false); onDone(); }}
        />
      )}
    </>
  );
}
