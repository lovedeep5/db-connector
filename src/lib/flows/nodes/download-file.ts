import { z } from "zod";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { NodeDef } from "../types";

const Config = z.object({
  url: z.string().url("Enter a full URL"),
  method: z.enum(["GET", "POST"]).default("GET"),
  headers: z.record(z.string()).optional(),
  /** POST body (string or JSON object). */
  body: z.unknown().optional(),
  /**
   * - auto: detect by Content-Type / file extension; parse tables, keep binaries raw
   * - parsed: force-parse, error if not a known table format
   * - raw: never parse — useful for binary files even with .csv URLs
   */
  mode: z.enum(["auto", "parsed", "raw"]).default("auto"),
  /** Override the inferred filename (without changing the extension). */
  filenameOverride: z.string().optional(),
  /** Hard cap on bytes downloaded. Default 100 MB. */
  maxBytes: z.coerce.number().int().positive().max(2 * 1024 * 1024 * 1024).default(100 * 1024 * 1024),
  timeoutMs: z.coerce.number().int().positive().max(30 * 60_000).default(60_000),
});

type Output = {
  /** Suggested filename (header → URL basename → fallback). */
  filename: string;
  contentType: string;
  size: number;
  /** Raw bytes, base64-encoded. Always present. */
  contentBase64: string;
  /** Source URL the file came from. */
  url: string;

  /** When parsing succeeded, rows / columns / rowCount are populated. */
  parsed: boolean;
  parseFormat?: "csv" | "tsv" | "json" | "ndjson" | "xlsx";
  parseWarning?: string;
  rows?: Record<string, unknown>[];
  columns?: string[];
  rowCount?: number;
};

export const downloadFileNode: NodeDef<z.infer<typeof Config>, Output> = {
  type: "io.downloadFile",
  label: "Download File",
  description:
    "Fetch a file from a URL. In auto mode, tables (CSV/JSON/XLSX) are parsed into rows AND kept as the raw file — both shapes available on the output.",
  category: "io",
  icon: "Download",
  accent: "blue",
  schema: Config,
  defaultConfig: () => ({
    url: "https://example.com/data.csv",
    method: "GET",
    mode: "auto",
    maxBytes: 100 * 1024 * 1024,
    timeoutMs: 60_000,
  }),
  takesInput: true,
  async execute(ctx, cfg) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
    try {
      const init: RequestInit = { method: cfg.method, headers: cfg.headers, signal: ctrl.signal };
      if (cfg.body !== undefined && cfg.method !== "GET") {
        init.body = typeof cfg.body === "string" ? cfg.body : JSON.stringify(cfg.body);
      }
      const res = await fetch(cfg.url, init);
      if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} ${res.statusText}`);

      // Stream the body so we can enforce maxBytes without buffering everything if huge.
      const chunks: Uint8Array[] = [];
      let received = 0;
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body to download");
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > cfg.maxBytes) {
          await reader.cancel();
          throw new Error(`File exceeds size cap (${cfg.maxBytes} bytes). Increase maxBytes or use a smaller source.`);
        }
        chunks.push(value);
      }
      const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));

      const contentType = (res.headers.get("content-type") ?? "application/octet-stream").toLowerCase();
      const filename =
        cfg.filenameOverride?.trim() ||
        fromContentDisposition(res.headers.get("content-disposition")) ||
        basenameFromUrl(cfg.url) ||
        "download";

      const output: Output = {
        filename,
        contentType,
        size: buf.length,
        contentBase64: buf.toString("base64"),
        url: cfg.url,
        parsed: false,
      };

      // Parse?
      const format = decideFormat(cfg.mode, contentType, filename);
      if (format) {
        try {
          const parsed = parseAs(buf, format);
          output.parsed = true;
          output.parseFormat = format;
          output.rows = parsed.rows;
          output.columns = parsed.columns;
          output.rowCount = parsed.rows.length;
        } catch (e) {
          const msg = (e as Error).message;
          if (cfg.mode === "parsed") throw new Error(`Parse failed (${format}): ${msg}`);
          output.parseWarning = `Parse attempted (${format}) but failed: ${msg}. Returning raw bytes.`;
          ctx.log(output.parseWarning);
        }
      }
      return output;
    } finally {
      clearTimeout(timer);
    }
  },
};

function decideFormat(
  mode: "auto" | "parsed" | "raw",
  contentType: string,
  filename: string
): "csv" | "tsv" | "json" | "ndjson" | "xlsx" | null {
  if (mode === "raw") return null;
  const lower = filename.toLowerCase();
  if (mode === "parsed" || mode === "auto") {
    if (contentType.includes("csv") || lower.endsWith(".csv")) return "csv";
    if (contentType.includes("tab-separated") || lower.endsWith(".tsv")) return "tsv";
    if (lower.endsWith(".ndjson") || lower.endsWith(".jsonl") || contentType.includes("ndjson") || contentType.includes("jsonl")) return "ndjson";
    if (contentType.includes("json") || lower.endsWith(".json")) return "json";
    if (
      contentType.includes("spreadsheetml") ||
      contentType.includes("ms-excel") ||
      lower.endsWith(".xlsx") ||
      lower.endsWith(".xls")
    ) return "xlsx";
  }
  if (mode === "parsed") throw new Error("mode=parsed but the file isn't a recognised table format (CSV/TSV/JSON/NDJSON/XLSX).");
  return null;
}

function parseAs(
  buf: Buffer,
  format: "csv" | "tsv" | "json" | "ndjson" | "xlsx"
): { rows: Record<string, unknown>[]; columns: string[] } {
  if (format === "csv" || format === "tsv") {
    const text = buf.toString("utf8");
    const result = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: true,
      delimiter: format === "tsv" ? "\t" : undefined,
    });
    if (result.errors.length > 0) {
      const first = result.errors[0];
      throw new Error(`${first.type}: ${first.message} (row ${first.row})`);
    }
    return { rows: result.data, columns: result.meta.fields ?? [] };
  }
  if (format === "ndjson") {
    const text = buf.toString("utf8");
    const rows = text.split("\n").map((s) => s.trim()).filter(Boolean).map((l) => JSON.parse(l));
    const columns = rows.length > 0 ? Array.from(new Set(rows.flatMap((r) => Object.keys(r)))) : [];
    return { rows, columns };
  }
  if (format === "json") {
    const text = buf.toString("utf8");
    const value = JSON.parse(text);
    if (Array.isArray(value)) {
      const columns = value.length > 0 && typeof value[0] === "object"
        ? Array.from(new Set(value.flatMap((r) => Object.keys(r))))
        : [];
      return { rows: value, columns };
    }
    // Single object → one row.
    return { rows: [value], columns: Object.keys(value) };
  }
  if (format === "xlsx") {
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) throw new Error("XLSX has no sheets");
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { rows, columns };
  }
  throw new Error(`Unsupported format: ${format}`);
}

function fromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  return m ? decodeURIComponent(m[1]) : null;
}

function basenameFromUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    const last = u.pathname.split("/").filter(Boolean).pop();
    return last ?? null;
  } catch {
    return null;
  }
}
