import { z } from "zod";
import type { NodeDef, RowsOutput } from "../types";
import { runQuery } from "@/server/services/db-access";

const Config = z.object({
  connectionId: z.string().min(1, "Pick a connection"),
  statement: z.string().min(1, "Write a query"),
  rowLimit: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export const dbQueryNode: NodeDef<z.infer<typeof Config>, RowsOutput> = {
  type: "db.query",
  label: "DB Query",
  description: "Run SQL (or a MongoDB JSON command) against a connection.",
  category: "data",
  icon: "Database",
  accent: "blue",
  schema: Config,
  defaultConfig: () => ({ connectionId: "", statement: "select 1;" }),
  takesInput: true,
  async execute(ctx, cfg) {
    const result = await runQuery(
      { userId: ctx.userId },
      cfg.connectionId,
      cfg.statement,
      { rowLimit: cfg.rowLimit ?? 100_000, timeoutMs: cfg.timeoutMs ?? 600_000 }
    );
    return {
      rows: result.rows,
      columns: result.columns,
      rowCount: result.rowCount,
      truncated: result.truncated,
    };
  },
};
