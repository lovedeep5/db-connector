/**
 * Computes the list of templated references available to a given node in the
 * flow editor. Uses the actual shape from the last test run when available;
 * otherwise falls back to "well-known" paths per node type.
 *
 * Loop-awareness: when the selected node is inside a Loop's iter body,
 * `$node.<loopId>` is shown as the bare per-iter item (sample taken from
 * inputs[0] of the last test run). A separate `$loop.*` group is also added
 * for iteration metadata (index / total / isFirst / isLast). When the
 * selected node is outside the body — downstream of the "done" port, or
 * there's no loop ancestor at all — the loop is shown with its done-payload
 * refs (.count, .results, .inputs).
 */
import type { FlowDefinition, FlowNode, TriggerSpec } from "@/lib/flows/types";
import { ancestorsOf } from "@/lib/flows/subflow";
import { iterSubgraphFor } from "@/lib/flows/loop-graph";
import type { TestRunResult } from "@/server/services/flow-test-runner";
import type { RefGroup, RefPath } from "./ref-picker";

const MAX_PATHS_PER_NODE = 30;
const MAX_DEPTH = 3;

/** Last-resort path set when no test output exists yet. */
const DEFAULT_PATHS: Record<string, string[]> = {
  "db.query": [".rows", ".rows[0]", ".rowCount", ".columns"],
  "http.request": [".status", ".ok", ".body", ".headers"],
  "transform.toFile": [".filename", ".contentBase64", ".size", ".contentType"],
  "email.send": [".messageId", ".recipients"],
  "code.js": [""],
  // Outside a loop body, $node.<loopId> is the done payload.
  "control.loop": [".count", ".iterations", ".inputs", ".results", ".results[0]"],
  // Loop End is a body terminator; downstream nodes never reference it.
  "control.loopEnd": [],
};

/**
 * Curated refs for nodes where the auto-walker over the test-run output
 * produces too many low-signal options. Each entry returns the short, hand-
 * picked list a user actually wants to map. When a node type has a preferred
 * builder, it skips the recursive walker entirely — the user can still type
 * deeper paths by hand (e.g. `{{ $node.x.results[0].myVar }}`), they just
 * don't get dropped into the dropdown noise.
 *
 * Why this exists: for non-technical users the dropdown was showing a flat
 * list with `.filename`, `.contentBase64`, `.size`, `.contentType` for To
 * File — when 99% of the time they want "the file" to attach. Same for the
 * Loop done port (results vs results[0] vs inputs vs inputs[0].field…).
 */
const PREFERRED_REFS: Record<
  string,
  (args: { id: string; node: FlowNode; sample: unknown }) => RefPath[]
> = {
  "transform.toFile": ({ id }) => [
    { template: `{{ $node.${id} }}`, preview: "the file (attach here)" },
    { template: `{{ $node.${id}.filename }}`, preview: "filename string" },
  ],
  "control.loop": ({ id }) => [
    // Done-port shape. Iter-context refs are handled by pathsForLoopIter.
    { template: `{{ $node.${id}.results }}`, preview: "processed array" },
    { template: `{{ $node.${id}.count }}`, preview: "item count" },
    { template: `{{ $node.${id}.iterations }}`, preview: "batch count" },
  ],
  "transform.setVariable": ({ id, node }) => {
    // Read configured variable names — Set Variable now supports up to 15
    // entries. Legacy single-var nodes have { name, value } at the top.
    const raw = node.config as { name?: unknown; vars?: unknown };
    const names: string[] = [];
    if (Array.isArray(raw.vars)) {
      for (const v of raw.vars) {
        if (v && typeof v === "object") {
          const n = (v as { name?: unknown }).name;
          if (typeof n === "string" && n) names.push(n);
        }
      }
    } else if (typeof raw.name === "string" && raw.name) {
      names.push(raw.name);
    }
    if (names.length === 0) names.push("value");
    return names.map((n) => ({ template: `{{ $node.${id}.${n} }}`, preview: `your "${n}"` }));
  },
  "transform.extractPath": ({ id }) => [
    { template: `{{ $node.${id} }}`, preview: "the extracted value" },
  ],
};

/** $loop.* refs available inside any loop body. */
const LOOP_META_PATHS: RefPath[] = [
  { template: "{{ $loop.index }}", preview: "iter # (0-based)" },
  { template: "{{ $loop.total }}", preview: "total iters" },
  { template: "{{ $loop.isFirst }}", preview: "boolean" },
  { template: "{{ $loop.isLast }}", preview: "boolean" },
];

export function buildAvailableRefs(args: {
  definition: FlowDefinition;
  selectedNodeId: string | null;
  lastTestRun: TestRunResult | null;
}): RefGroup[] {
  const { definition, selectedNodeId, lastTestRun } = args;
  const groups: RefGroup[] = [];

  // Trigger group
  const triggerPaths = pathsForTrigger(definition.trigger, lastTestRun);
  if (triggerPaths.length > 0) {
    groups.push({ label: "Trigger", paths: triggerPaths });
  }

  // Pre-compute which loop ancestors the selected node sits inside the body of.
  // For those loops we treat `$node.<loopId>` as the bare per-iter item (using
  // inputs[0] as the sample) instead of the done payload — otherwise the
  // dropdown would offer `.inputs[0].field`, a static reference to the first
  // source item rather than the live iteration value.
  const insideBodyOfLoops = selectedNodeId
    ? loopsWhoseBodyContains(definition, selectedNodeId)
    : new Set<string>();

  // Iteration metadata group ($loop.*) — only relevant when the selected node
  // sits inside at least one loop body.
  if (insideBodyOfLoops.size > 0) {
    groups.push({ label: "Loop iteration", paths: LOOP_META_PATHS });
  }

  // For each upstream node of the selected one (or every node if nothing is selected).
  const nodeIds = selectedNodeId
    ? [...ancestorsOf(definition, selectedNodeId)]
    : definition.nodes.map((n) => n.id);

  for (const id of nodeIds) {
    const node = definition.nodes.find((n) => n.id === id);
    if (!node) continue;
    const isIterContext = node.type === "control.loop" && insideBodyOfLoops.has(id);
    const sample = isIterContext
      ? iterSampleFor(id, lastTestRun)
      : lastTestRun?.nodes.find((nr) => nr.nodeId === id)?.output;
    const paths = isIterContext
      ? pathsForLoopIter(id, sample)
      : pathsForNode(id, node, sample);
    if (paths.length === 0) continue;
    const label = isIterContext
      ? `${node.type} · ${id}  (current item)`
      : `${node.type} · ${id}`;
    groups.push({ label, paths });
  }

  return groups;
}

/**
 * The set of loop-node ids whose iter body contains `selectedNodeId`. Used
 * by the ref builder to switch a loop ref between its iter-shape and its
 * done-shape based on where the cursor is. A node can sit inside multiple
 * nested loops (once we support nesting); each is reported.
 */
function loopsWhoseBodyContains(def: FlowDefinition, selectedNodeId: string): Set<string> {
  const out = new Set<string>();
  for (const n of def.nodes) {
    if (n.type !== "control.loop") continue;
    const body = iterSubgraphFor(n.id, def);
    if (body.has(selectedNodeId)) out.add(n.id);
  }
  return out;
}

/**
 * Sample used to walk paths for `$node.<loopId>` when the selected node is
 * inside the loop body. The last test run records the loop's *done* payload
 * (because that's what overrides prevOutputs after iteration finishes), so
 * we use `inputs[0]` as a stand-in for the bare per-iter item — that's what
 * `$node.<loopId>` actually carries during a real iteration.
 */
function iterSampleFor(loopId: string, lastTestRun: TestRunResult | null): unknown {
  const recorded = lastTestRun?.nodes.find((nr) => nr.nodeId === loopId)?.output as
    | { inputs?: unknown[] }
    | undefined;
  return recorded?.inputs?.[0];
}

function pathsForLoopIter(id: string, sample: unknown): RefPath[] {
  const out: RefPath[] = [{ template: `{{ $node.${id} }}`, preview: sample === undefined ? "current item" : typeOf(sample) }];
  if (sample !== undefined && sample !== null && typeof sample === "object") {
    walkPaths(sample, "", out, MAX_DEPTH, id);
  }
  return out.slice(0, MAX_PATHS_PER_NODE);
}

function pathsForTrigger(trigger: TriggerSpec, lastTestRun: TestRunResult | null): RefPath[] {
  void lastTestRun; // (reserved for future webhook payload introspection)
  if (trigger.type === "webhook") {
    return [
      { template: "{{ $trigger.body }}" },
      { template: "{{ $trigger.headers }}" },
      { template: "{{ $trigger.query }}" },
    ];
  }
  if (trigger.type === "schedule") {
    return [{ template: "{{ $trigger.firedAt }}", preview: "ISO date" }];
  }
  return [{ template: "{{ $trigger.startedBy }}", preview: "user id" }];
}

function pathsForNode(id: string, node: FlowNode, sample: unknown): RefPath[] {
  // Curated short-list wins over the auto-walker for noisy node types.
  const curate = PREFERRED_REFS[node.type];
  if (curate) return curate({ id, node, sample });

  if (sample !== undefined && sample !== null) {
    const out: RefPath[] = [{ template: `{{ $node.${id} }}`, preview: typeOf(sample) }];
    walkPaths(sample, "", out, MAX_DEPTH, id);
    return out.slice(0, MAX_PATHS_PER_NODE);
  }
  const defaults = DEFAULT_PATHS[node.type] ?? [""];
  return defaults.map((p) => ({ template: `{{ $node.${id}${p} }}` }));
}

function walkPaths(value: unknown, prefix: string, out: RefPath[], depth: number, nodeId: string): void {
  if (out.length >= MAX_PATHS_PER_NODE) return;
  if (depth <= 0) return;
  if (Array.isArray(value)) {
    if (value.length > 0) {
      const childPath = `${prefix}[0]`;
      out.push({ template: `{{ $node.${nodeId}${childPath} }}`, preview: typeOf(value[0]) });
      walkPaths(value[0], childPath, out, depth - 1, nodeId);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const k of Object.keys(value as Record<string, unknown>)) {
      if (out.length >= MAX_PATHS_PER_NODE) return;
      const child = (value as Record<string, unknown>)[k];
      const childPath = `${prefix}.${k}`;
      out.push({ template: `{{ $node.${nodeId}${childPath} }}`, preview: typeOf(child) });
      walkPaths(child, childPath, out, depth - 1, nodeId);
    }
  }
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return `array(${v.length})`;
  if (typeof v === "string") {
    const s = v.length > 20 ? v.slice(0, 18) + "…" : v;
    return `"${s}"`;
  }
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return String(v);
  if (typeof v === "object") return "object";
  return typeof v;
}
