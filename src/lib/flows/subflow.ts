import type { FlowDefinition } from "./types";

/**
 * Returns a new FlowDefinition containing only the target node and every node
 * that reaches it via the edge graph (its transitive ancestors). The trigger
 * is preserved as-is so the executor has a starting point.
 *
 * Used by "Run this step" — we don't need to execute downstream nodes when
 * testing a single step.
 */
export function pruneToAncestorsOf(def: FlowDefinition, targetNodeId: string): FlowDefinition {
  const reversed = new Map<string, string[]>();
  for (const e of def.edges) {
    const arr = reversed.get(e.target) ?? [];
    arr.push(e.source);
    reversed.set(e.target, arr);
  }

  const keep = new Set<string>([targetNodeId]);
  const queue: string[] = [targetNodeId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const parent of reversed.get(id) ?? []) {
      if (!keep.has(parent)) {
        keep.add(parent);
        queue.push(parent);
      }
    }
  }

  return {
    version: 1,
    trigger: def.trigger,
    nodes: def.nodes.filter((n) => keep.has(n.id)),
    edges: def.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
  };
}

/**
 * Returns the set of node ids that are transitive ancestors of `targetNodeId`.
 * Used by the UI's reference picker to know which previous nodes' outputs the
 * user can template from inside the currently-selected node.
 */
export function ancestorsOf(def: FlowDefinition, targetNodeId: string): Set<string> {
  const reversed = new Map<string, string[]>();
  for (const e of def.edges) {
    const arr = reversed.get(e.target) ?? [];
    arr.push(e.source);
    reversed.set(e.target, arr);
  }
  const out = new Set<string>();
  const queue: string[] = [targetNodeId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const parent of reversed.get(id) ?? []) {
      if (!out.has(parent)) {
        out.add(parent);
        queue.push(parent);
      }
    }
  }
  return out;
}
