import { z } from "zod";
import type { NodeDef, RowsOutput } from "../types";
import { evalUserJs } from "../js-eval";

const Config = z.object({
  /**
   * JS predicate evaluated per array item. Receives `$item` (current row),
   * `$index` (zero-based), `$input` (the whole array). Truthy = keep.
   */
  predicate: z.string().min(1, "Write a predicate"),
  /** Optional source path on $input to pick the array from (e.g. "rows" or "body.data"). */
  arrayPath: z.string().optional(),
  timeoutMs: z.number().int().positive().max(60_000).default(10_000),
});

type Output = RowsOutput;

export const filterNode: NodeDef<z.infer<typeof Config>, Output> = {
  type: "transform.filter",
  label: "Filter",
  description: "Keep only items where the JS predicate returns truthy.",
  category: "transform",
  icon: "Filter",
  accent: "violet",
  schema: Config,
  defaultConfig: () => ({ predicate: "$item.active === true", timeoutMs: 10_000 }),
  takesInput: true,
  async execute(ctx, cfg) {
    const lastValue = [...ctx.prevOutputs.values()].pop();
    const arr = pickArray(lastValue, cfg.arrayPath);
    const kept: Record<string, unknown>[] = [];
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i];
      const ok = await evalUserJs({
        body: `return (${cfg.predicate});`,
        scope: { $item: item, $index: i, $input: arr, $prev: ctx.prevOutputs },
        timeoutMs: cfg.timeoutMs,
        filename: `flow-filter-${ctx.flowRunId}.js`,
        log: ctx.log,
      });
      if (ok) kept.push(item);
    }
    const columns = kept.length > 0 ? Array.from(new Set(kept.flatMap((r) => Object.keys(r)))) : [];
    return { rows: kept, columns, rowCount: kept.length };
  },
};

function pickArray(input: unknown, path?: string): Record<string, unknown>[] {
  let v: unknown = input;
  if (path) {
    for (const part of path.split(".").filter(Boolean)) {
      if (v && typeof v === "object") v = (v as Record<string, unknown>)[part];
    }
  } else if (v && typeof v === "object" && !Array.isArray(v) && "rows" in v) {
    v = (v as { rows: unknown }).rows;
  }
  if (!Array.isArray(v)) {
    throw new Error(`Filter: input is not an array. ${path ? `Path "${path}" resolved to ${typeof v}.` : "Provide an arrayPath if your input is an object."}`);
  }
  return v as Record<string, unknown>[];
}
