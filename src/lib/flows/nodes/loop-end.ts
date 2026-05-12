import { z } from "zod";
import type { NodeDef } from "../types";

/**
 * Loop End — explicit terminator for a Loop body.
 *
 * Drop this at the end of an iter body. Whatever value flows into it becomes
 * the `results[i]` slot on the parent Loop's `done` payload for that iteration.
 * One Loop End per branch (in if/else bodies) is normal — exactly one runs per
 * iteration thanks to the branching, and that's the one that contributes to
 * `results[i]`.
 *
 * The node is single-input, no output (it's a sink). When the executor walks
 * the body for an iteration and reaches this node type, it records the
 * upstream value as the iteration's collected result.
 *
 * `execute` returns the upstream value passthrough so the per-iter output
 * shown in test-run history is informative rather than `null`.
 */
const Config = z.object({
  /** Optional label so the editor can disambiguate multiple Loop Ends. */
  note: z.string().optional(),
});

export const loopEndNode: NodeDef<z.infer<typeof Config>, unknown> = {
  type: "control.loopEnd",
  label: "Loop End",
  description:
    "Marks the end of a Loop body. The value flowing in becomes results[i] for the parent Loop's `done` port.",
  category: "control",
  icon: "CornerDownLeft",
  accent: "amber",
  schema: Config,
  defaultConfig: () => ({}),
  takesInput: true,
  // No outputPorts and the catalog flags noSourceHandle so the canvas omits
  // the right-hand source dot.
  async execute(ctx) {
    return [...ctx.prevOutputs.values()].pop();
  },
};
