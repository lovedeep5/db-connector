"use client";
import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  AlertTriangle,
  Maximize2,
  Minimize2,
  Pencil,
  Trash2,
  KeyRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { cn, truncate } from "@/lib/utils";
import type { QueryResult } from "@/lib/drivers/types";
import { exportRows } from "@/lib/export";
import { triggerServerExport } from "@/lib/server-export";
import {
  DeleteRowDialog,
  EditRowDialog,
  InsertRowDialog,
  type EditorColumn,
} from "@/components/data/row-editor";

function renderCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return truncate(JSON.stringify(v), 200);
  return String(v);
}

const ROW_HEIGHT = 30;
const HEADER_HEIGHT = 30;
const ACTION_COL_WIDTH = 88;

export function ResultsGrid({
  result,
  connectionId,
  statement,
  isFullscreen,
  onToggleFullscreen,
  canWrite = false,
  onMutated,
}: {
  result: QueryResult;
  connectionId?: string;
  statement?: string;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  canWrite?: boolean;
  onMutated?: () => void;
}) {
  const parentRef = React.useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: result.rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const totalSize = rowVirtualizer.getTotalSize();
  const items = rowVirtualizer.getVirtualItems();

  const columnWidths = React.useMemo(() => {
    const widths: Record<string, number> = {};
    for (const c of result.columns) widths[c] = Math.max(c.length * 8 + 32, 120);
    const sample = result.rows.slice(0, 50);
    for (const row of sample) {
      for (const c of result.columns) {
        const s = renderCell(row[c]);
        widths[c] = Math.min(Math.max(widths[c], s.length * 7 + 24), 420);
      }
    }
    return widths;
  }, [result.columns, result.rows]);

  // Editability — only when the driver reported a single-table source AND the
  // user has write access on this connection.
  const editable = canWrite && connectionId && result.editable ? result.editable : null;
  const editorColumns = React.useMemo<EditorColumn[]>(() => {
    if (!editable) return [];
    return editable.columns.map((c) => ({
      alias: c.alias,
      source: c.source,
      isPrimaryKey: c.isPrimaryKey,
    }));
  }, [editable]);
  const pkSourceSet = React.useMemo(
    () => new Set(editorColumns.filter((c) => c.isPrimaryKey).map((c) => c.source)),
    [editorColumns]
  );

  const [editingRow, setEditingRow] = React.useState<Record<string, unknown> | null>(null);
  const [deletingRow, setDeletingRow] = React.useState<Record<string, unknown> | null>(null);

  const canServerExport = !!(connectionId && statement);
  const showActions = !!editable;

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b text-xs">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>
            {result.rowCount.toLocaleString()} row{result.rowCount === 1 ? "" : "s"} · {result.durationMs}ms
          </span>
          {result.affectedRows !== undefined && <span>· {result.affectedRows} affected</span>}
          {editable && (
            <Badge variant="success" className="ml-1 gap-1">
              <KeyRound className="h-3 w-3" /> Editable · {editable.schema}.{editable.table}
            </Badge>
          )}
          {result.truncated && (
            <Badge variant="warning" className="ml-1">
              <AlertTriangle className="h-3 w-3" /> Limited to {result.rowCount.toLocaleString()} rows · use Export to download all
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {editable && connectionId && (
            <InsertRowDialog
              connectionId={connectionId}
              schema={editable.schema}
              table={editable.table}
              columns={editorColumns}
              onDone={() => onMutated?.()}
            />
          )}
          {onToggleFullscreen && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleFullscreen}
              title={isFullscreen ? "Show editor" : "Maximize results"}
            >
              {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              {isFullscreen ? "Restore" : "Maximize"}
            </Button>
          )}
          {result.rows.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm"><Download className="h-3.5 w-3.5" /> Export</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {canServerExport ? (
                  <>
                    <DropdownMenuItem onSelect={() => triggerServerExport({ connectionId: connectionId!, statement: statement!, format: "csv" })}>
                      <FileText className="h-4 w-4" /> CSV (full result, streamed)
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => triggerServerExport({ connectionId: connectionId!, statement: statement!, format: "ndjson" })}>
                      <FileJson className="h-4 w-4" /> NDJSON (full result, streamed)
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => triggerServerExport({ connectionId: connectionId!, statement: statement!, format: "json" })}>
                      <FileJson className="h-4 w-4" /> JSON array (full result, streamed)
                    </DropdownMenuItem>
                  </>
                ) : null}
                <DropdownMenuItem onSelect={() => exportRows(result.rows, "results", "csv")}>
                  <FileText className="h-4 w-4" /> CSV (visible {result.rowCount.toLocaleString()})
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportRows(result.rows, "results", "json")}>
                  <FileJson className="h-4 w-4" /> JSON (visible)
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportRows(result.rows, "results", "xlsx")}>
                  <FileSpreadsheet className="h-4 w-4" /> Excel (visible)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {result.rows.length === 0 ? (
        <div className="p-6 text-center text-muted-foreground text-sm">No rows returned.</div>
      ) : (
        <div ref={parentRef} className="flex-1 overflow-auto relative">
          <div
            style={{
              height: totalSize + HEADER_HEIGHT,
              width: "max-content",
              minWidth: "100%",
            }}
            className="relative"
          >
            <div className="sticky top-0 z-10 flex bg-card/95 backdrop-blur border-b" style={{ height: HEADER_HEIGHT }}>
              {result.columns.map((c) => (
                <div
                  key={c}
                  className="px-3 py-1.5 text-xs font-medium text-muted-foreground font-mono whitespace-nowrap flex items-center gap-1"
                  style={{ width: columnWidths[c] }}
                >
                  {pkSourceSet.has(c) && <KeyRound className="h-3 w-3 text-amber-500" />}
                  {c}
                </div>
              ))}
              {showActions && (
                <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground" style={{ width: ACTION_COL_WIDTH }}>
                  Actions
                </div>
              )}
            </div>
            {items.map((vi) => {
              const row = result.rows[vi.index];
              return (
                <div
                  key={vi.key}
                  data-index={vi.index}
                  className={cn(
                    "absolute left-0 flex border-b text-xs font-mono",
                    vi.index % 2 === 0 ? "bg-background" : "bg-muted/30"
                  )}
                  style={{
                    top: vi.start + HEADER_HEIGHT,
                    height: ROW_HEIGHT,
                  }}
                >
                  {result.columns.map((c) => (
                    <div
                      key={c}
                      className="px-3 py-1.5 whitespace-nowrap overflow-hidden text-ellipsis"
                      style={{ width: columnWidths[c] }}
                      title={renderCell(row[c])}
                    >
                      {renderCell(row[c])}
                    </div>
                  ))}
                  {showActions && (
                    <div
                      className="px-2 py-0.5 flex items-center justify-end gap-1"
                      style={{ width: ACTION_COL_WIDTH }}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => setEditingRow(row)}
                        title="Edit row"
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive"
                        onClick={() => setDeletingRow(row)}
                        title="Delete row"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {editable && connectionId && editingRow && (
        <EditRowDialog
          open={!!editingRow}
          onOpenChange={(v) => !v && setEditingRow(null)}
          row={editingRow}
          connectionId={connectionId}
          schema={editable.schema}
          table={editable.table}
          columns={editorColumns}
          onDone={() => { setEditingRow(null); onMutated?.(); }}
        />
      )}
      {editable && connectionId && deletingRow && (
        <DeleteRowDialog
          open={!!deletingRow}
          onOpenChange={(v) => !v && setDeletingRow(null)}
          row={deletingRow}
          connectionId={connectionId}
          schema={editable.schema}
          table={editable.table}
          columns={editorColumns}
          onDone={() => { setDeletingRow(null); onMutated?.(); }}
        />
      )}
    </div>
  );
}
