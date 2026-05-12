import { z } from "zod";
import type { NodeDef } from "../types";
import { evalUserJs } from "../js-eval";

const Config = z.object({
  /**
   * JS expression evaluated against `$input` (latest upstream output) and
   * `$prev` (Map of all upstream outputs). Truthy → "true" branch.
   */
  expression: z.string().min(1, "Write a condition"),
  timeoutMs: z.number().int().positive().max(60_000).default(5_000),
});

type Output = {
  /** Which branch was taken; downstream edges are filtered by sourcePort. */
  branch: "true" | "false";
  /** The same input value, passed through for downstream nodes to consume. */
  value: unknown;
  /** The expression's actual result, useful for debugging. */
  raw: unknown;
};

export const ifElseNode: NodeDef<z.infer<typeof Config>, Output> = {
  type: "control.ifElse",
  label: "If / Else",
  description: "Branch the flow based on a JS expression. Two output ports: true and false.",
  category: "control",
  icon: "Split",
  accent: "amber",
  schema: Config,
  defaultConfig: () => ({ expression: "$input.rowCount > 0", timeoutMs: 5_000 }),
  takesInput: true,
  outputPorts: ["true", "false"],
  computeActivePorts: (out) => [out.branch],
  async execute(ctx, cfg) {
    const lastValue = [...ctx.prevOutputs.values()].pop();
    const raw = await evalUserJs({
      body: `return (${cfg.expression});`,
      scope: { $input: lastValue, $prev: ctx.prevOutputs },
      timeoutMs: cfg.timeoutMs,
      filename: `flow-if-${ctx.flowRunId}.js`,
      log: ctx.log,
    });
    return { branch: raw ? "true" : "false", value: lastValue, raw };
  },
};
