"use client";

import { toast } from "sonner";

export type ServerExportArgs = {
  connectionId: string;
  format: "csv" | "json" | "ndjson";
  statement?: string;
  schema?: string;
  table?: string;
  maxRows?: number;
};

/**
 * Fires a fetch to /api/db/export and streams the response straight to a
 * file download. The browser never holds the entire result in memory; rows
 * are written to disk as they arrive over the network.
 */
export async function triggerServerExport(args: ServerExportArgs) {
  const t = toast.loading("Preparing export…");
  try {
    const res = await fetch("/api/db/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!res.ok || !res.body) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `Export failed (${res.status})`);
    }
    const filename = parseFilename(res.headers.get("content-disposition")) ?? `export.${args.format}`;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Export ready", { id: t });
  } catch (err) {
    toast.error((err as Error).message, { id: t });
  }
}

function parseFilename(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/filename="?([^";]+)"?/i);
  return m?.[1] ?? null;
}
