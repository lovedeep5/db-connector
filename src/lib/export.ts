"use client";
import Papa from "papaparse";
import * as XLSX from "xlsx";

export type ExportFormat = "csv" | "json" | "xlsx";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function flatten(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      out[k] = v && typeof v === "object" ? JSON.stringify(v) : (v as unknown);
    }
    return out;
  });
}

export function exportRows(rows: Record<string, unknown>[], name: string, format: ExportFormat) {
  if (rows.length === 0) return;
  const safe = name.replace(/[^a-z0-9_\-]+/gi, "_");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${safe}-${ts}`;
  switch (format) {
    case "csv": {
      const csv = Papa.unparse(flatten(rows));
      downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${filename}.csv`);
      return;
    }
    case "json": {
      downloadBlob(
        new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" }),
        `${filename}.json`
      );
      return;
    }
    case "xlsx": {
      const ws = XLSX.utils.json_to_sheet(flatten(rows));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
      const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      downloadBlob(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${filename}.xlsx`);
      return;
    }
  }
}
