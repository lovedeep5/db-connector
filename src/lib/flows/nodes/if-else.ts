import { z } from "zod";
import type { NodeDef } from "../types";
import {
  evaluateCondition,
  OPERATORS,
  type Combinator,
  type Condition,
} from "../condition-eval";

/**
 * Form-based If / Else. The user adds N rows of (left, operator, right)
 * via the inspector form, picks AND/OR, and the flow branches to `true`
 * or `false` port. Templated values on left/right resolve against
 * `$node.*` / `$trigger.*` / `$loop.*` like everywhere else — so the
 * "left" can be a real field reference from a previous step.
 *
 * Mirrors n8n's IfV2 node. No JS sandbox needed.
 */
const ConditionSchema = z.object({
  left: z.unknown(),
  operator: z.enum(OPERATORS),
  right: z.unknown().optional(),
});

const Config = z.object({
  conditions: z.array(ConditionSchema).min(1, "Add at least one condition"),
  combinator: z.enum(["and", "or"]).default("and"),
});

type Output = {
  branch: "true" | "false";
  /** Passes the input through so downstream nodes keep working on the same data. */
  value: unknown;
  /** Per-condition booleans for debugging. */
  results: boolean[];
};

export const ifElseNode: NodeDef<z.infer<typeof Config>, Output> = {
  type: "control.ifElse",
  label: "If / Else",
  description: "Branch on form-based conditions (left / operator / right). Two output ports.",
  category: "control",
  icon: "Split",
  accent: "amber",
  schema: Config,
  defaultConfig: () => ({ conditions: [{ left: "", operator: "equals", right: "" }], combinator: "and" }),
  takesInput: true,
  outputPorts: ["true", "false"],
  computeActivePorts: (out) => [out.branch],
  async execute(ctx, cfg) {
    const conditions = cfg.conditions as Condition[];
    const combinator = (cfg.combinator ?? "and") as Combinator;
    const results = conditions.map((c) => evaluateCondition(c));
    const passed = combinator === "or" ? results.some(Boolean) : results.every(Boolean);
    const lastValue = [...ctx.prevOutputs.values()].pop();
    return { branch: passed ? "true" : "false", value: lastValue, results };
  },
};
