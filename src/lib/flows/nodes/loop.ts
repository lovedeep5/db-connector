import { z } from "zod";
import type { NodeDef } from "../types";

/**
 * Loop / SplitInBatches — n8n-style iteration node.
 *
 * Two output ports:
 *   - "item" fires once per batch. The value flowing through that edge is the
 *     bare element (or array of N when batchSize > 1), exactly like any other
 *     node-to-node edge. Body nodes read it as `$input` or
 *     `{{ $node.<loopId>.<field> }}` — no wrapper accessor needed.
 *   - "done" fires once, after all iterations, carrying the inputs the loop
 *     was driven from plus the processed results collected from the body.
 *
 * Iteration metadata (index/total/isFirst/isLast) is exposed via a separate
 * templating scope key `{{ $loop.* }}` available inside the body — kept off
 * `$node.<loopId>` so the simple "give me the item" path stays clean.
 *
 * The node's `execute` is intentionally a no-op: the *executor* recognises
 * `control.loop` and drives per-iteration sub-graph evaluation itself.
 */
const Config = z.object({
  /**
   * The array to iterate. The form stores a template reference like
   * `{{ $node.q1.rows }}` or `{{ $node.http_1.body.data.users }}`. The
   * templating engine resolves the whole expression to the actual array
   * before this schema runs. Failing to resolve to an array surfaces a
   * clear "Expected array, received <type>" error from Zod.
   *
   * No special "dot-path" config — the existing ref system already handles
   * arbitrarily nested paths, so the loop stays single-purpose: take an
   * array, iterate it.
   */
  items: z.array(z.unknown(), {
    invalid_type_error:
      "Items must resolve to an array. Use Insert ref to point at an upstream array (e.g. {{ $node.<id>.rows }}).",
    required_error: "Pick the array to iterate via Insert ref.",
  }),
  /** Items per iteration. 1 = foreach (default), N = batched. */
  batchSize: z.coerce.number().int().positive().max(10_000).default(1),
  /** Safety cap so a runaway array can't blow up the worker. */
  maxIterations: z.coerce.number().int().positive().max(100_000).default(1_000),
});

/** Value flowing through the "item" port — the bare element (or batch array). */
export type LoopItemValue = unknown;

export type LoopDoneOutput = {
  done: true;
  count: number;        // number of source items the loop saw
  iterations: number;   // number of batches yielded
  inputs: unknown[];    // source items, in iteration order
  results: unknown[];   // collected outputs from `collectFrom` (or auto-sink) per iter
};

export const loopNode: NodeDef<z.infer<typeof Config>, LoopItemValue | LoopDoneOutput> = {
  type: "control.loop",
  label: "Loop",
  description:
    "Iterate over an array. 'item' port fires per batch with the bare element; 'done' fires after with the collected results.",
  category: "control",
  icon: "Repeat",
  accent: "amber",
  schema: Config,
  // The form stores `items` as a templated string (e.g. "{{ $node.q1.rows }}").
  // The runtime templating resolves it to the actual array before zod parses
  // the config, at which point `items: unknown[]` holds. We start with an
  // empty array so a freshly-dropped Loop is valid but yields zero iterations
  // until the user wires up an Insert ref.
  defaultConfig: () => ({ items: [] as unknown[], batchSize: 1, maxIterations: 1_000 }),
  takesInput: true,
  outputPorts: ["item", "done"],
  async execute() {
    throw new Error(
      "Loop node executed via NodeDef.execute — this should be impossible; the runner handles control.loop specially."
    );
  },
};

/** Chunk an array into groups of `size`. Last chunk may be shorter. */
export function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 1) return arr.map((x) => [x]);
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Find the Loop End node ids inside a given body. Each iteration, at most one
 * of these runs (the others are unreachable due to branching), and its
 * upstream value becomes `results[i]`.
 *
 * If a body has zero Loop End nodes, the executor falls back to picking the
 * body's sole sink — body nodes with no outgoing edge inside the body. This
 * keeps simple foreach flows working without forcing a Loop End on the user.
 */
export function findLoopEndIds(body: Set<string>, allNodes: { id: string; type: string }[]): Set<string> {
  const out = new Set<string>();
  for (const n of allNodes) {
    if (body.has(n.id) && n.type === "control.loopEnd") out.add(n.id);
  }
  return out;
}

/** Fallback sink picker used when the body has no Loop End nodes. */
export function bodySinks(body: Set<string>, edges: { source: string; target: string }[]): string[] {
  const sinks: string[] = [];
  for (const id of body) {
    const hasInnerOut = edges.some((e) => e.source === id && body.has(e.target));
    if (!hasInnerOut) sinks.push(id);
  }
  return sinks;
}
