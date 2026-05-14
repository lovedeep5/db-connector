import { z } from "zod";
import type { NodeDef, RowsOutput } from "../types";
import { applyTemplate, buildScope } from "../templating";
import {
  evaluateAll,
  OPERATORS,
  type Combinator,
  type Condition,
} from "../condition-eval";

/**
 * Form-based Filter. The user picks an array (`items` — a templated ref
 * like `{{ $node.q1.rows }}`) and one or more conditions with the same
 * (left, operator, right) shape as If/Else. Matching items pass through
 * unchanged; non-matching items are dropped.
 *
 * Conditions can reference `{{ $item.<field> }}` to read the current item.
 * The templating engine leaves `$item` tokens unresolved during the outer
 * config-templating pass; this executor templates each condition again
 * per item with `$item` bound, so per-row checks just work.
 */
const ConditionSchema = z.object({
  left: z.unknown(),
  operator: z.enum(OPERATORS),
  right: z.unknown().optional(),
});

const Config = z.object({
  items: z.unknown(),
  conditions: z.array(ConditionSchema).min(1, "Add at least one condition"),
  combinator: z.enum(["and", "or"]).default("and"),
});

type Output = RowsOutput;

export const filterNode: NodeDef<z.infer<typeof Config>, Output> = {
  type: "transform.filter",
  label: "Filter",
  description: "Keep array items matching one or more conditions (form-based; no JS needed).",
  category: "transform",
  icon: "Filter",
  accent: "violet",
  schema: Config,
  defaultConfig: () => ({
    items: "",
    conditions: [{ left: "{{ $item }}", operator: "equals", right: "" }],
    combinator: "and",
  }),
  takesInput: true,
  async execute(ctx, cfg) {
    const arr = pickArray(cfg.items);
    const combinator = (cfg.combinator ?? "and") as Combinator;
    const kept: Record<string, unknown>[] = [];
    // Conditions arrive partially-resolved: $node/$trigger refs already
    // baked in, $item refs preserved as raw `{{ $item.X }}` tokens by the
    // outer templater's "deferred prefix" handling. Re-template here per
    // item with $item bound.
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i];
      const itemScope = buildScope({
        prevOutputs: ctx.prevOutputs,
        trigger: ctx.trigger,
        item,
        index: i,
      });
      const resolved: Condition[] = cfg.conditions.map((c) => ({
        left: applyTemplate(c.left, itemScope),
        operator: c.operator,
        right: applyTemplate(c.right, itemScope),
      }));
      if (evaluateAll(resolved, combinator)) kept.push(item);
    }
    const columns = kept.length > 0 ? Array.from(new Set(kept.flatMap((r) => Object.keys(r)))) : [];
    return { rows: kept, columns, rowCount: kept.length };
  },
};

function pickArray(input: unknown): Record<string, unknown>[] {
  if (Array.isArray(input)) return input as Record<string, unknown>[];
  // Friendly fallback: { rows: [...] } passed through directly (common from DB Query).
  if (input && typeof input === "object" && Array.isArray((input as { rows?: unknown }).rows)) {
    return (input as { rows: Record<string, unknown>[] }).rows;
  }
  throw new Error(
    `Filter: "Array to filter" did not resolve to an array. Use Insert ref to point at the upstream array (e.g. {{ $node.query_1.rows }}).`
  );
}
