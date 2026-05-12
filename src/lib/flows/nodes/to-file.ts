import { z } from "zod";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { FileOutput, NodeDef } from "../types";

const Config = z.object({
  /**
   * The array of rows to write. The form stores a template reference like
   * `{{ $node.q1.rows }}` or `{{ $node.loop_1.results }}`; the templating
   * engine resolves it to the array before zod validates the shape. This
   * mirrors the Loop node's `items` field — no "node id + auto-detect"
   * magic, no path resolver inside the node. If the user's source is
   * nested, they point at it with `{{ $node.X.body.data.rows }}` directly.
   */
  rows: z.array(z.record(z.unknown()), {
    invalid_type_error:
      "Rows must resolve to an array of objects. Use Insert ref to point at the upstream array (e.g. {{ $node.<id>.rows }}).",
    required_error: "Pick the rows to write via Insert ref.",
  }),
  /** Filename without extension; the format adds the extension. */
  filename: z.string().min(1).default("report"),
  format: z.enum(["csv", "xlsx", "json", "ndjson"]).default("csv"),
});

const MIME: Record<string, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  json: "application/json; charset=utf-8",
  ndjson: "application/x-ndjson; charset=utf-8",
};

export const toFileNode: NodeDef<z.infer<typeof Config>, FileOutput> = {
  type: "transform.toFile",
  label: "To File",
  description: "Convert rows into CSV, Excel, JSON or NDJSON. Pass the result to Send Email or HTTP.",
  category: "transform",
  icon: "FileDown",
  accent: "amber",
  schema: Config,
  // Stored as a string here so the form's TemplateField can edit it; the
  // executor templates it to an array before zod runs.
  defaultConfig: () => ({ rows: [] as Record<string, unknown>[], filename: "report", format: "csv" }),
  takesInput: true,
  async execute(_ctx, cfg) {
    const rows = cfg.rows;
    const ext = cfg.format === "ndjson" ? "ndjson" : cfg.format;
    const filename = `${cfg.filename.replace(/[^a-z0-9_\-]+/gi, "_")}.${ext}`;
    const buffer = serialise(rows, cfg.format);
    return {
      filename,
      contentType: MIME[cfg.format],
      size: buffer.length,
      contentBase64: buffer.toString("base64"),
    };
  },
};

function serialise(rows: Record<string, unknown>[], format: "csv" | "xlsx" | "json" | "ndjson"): Buffer {
  if (format === "json") {
    return Buffer.from(JSON.stringify(rows, null, 2), "utf8");
  }
  if (format === "ndjson") {
    return Buffer.from(rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  }
  if (format === "csv") {
    const flat = rows.map(flatten);
    return Buffer.from(Papa.unparse(flat), "utf8");
  }
  // xlsx
  const ws = XLSX.utils.json_to_sheet(rows.map(flatten));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return Buffer.from(XLSX.write(wb, { bookType: "xlsx", type: "array" }) as Uint8Array);
}

function flatten(r: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    out[k] = v && typeof v === "object" ? JSON.stringify(v) : v;
  }
  return out;
}
