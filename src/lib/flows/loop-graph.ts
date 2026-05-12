import type { FlowDefinition, FlowEdge, FlowNode } from "./types";

/**
 * Given a loop node id, return the set of nodes that form its iter body —
 * i.e. nodes reachable forward from the loop's "item" port edges, excluding
 * any node also reachable from the "done" port. The loop node itself is not
 * included.
 *
 * Nodes in this set are re-executed once per iteration by the runner; nodes
 * reachable only from the "done" port run once, after all iterations.
 */
export function iterSubgraphFor(loopId: string, def: FlowDefinition): Set<string> {
  const doneReach = bfsForward(
    def.edges.filter((e) => e.source === loopId && e.sourcePort === "done").map((e) => e.target),
    def.edges
  );
  const itemReach = bfsForward(
    def.edges.filter((e) => e.source === loopId && e.sourcePort === "item").map((e) => e.target),
    def.edges
  );
  const iter = new Set<string>();
  for (const id of itemReach) {
    if (id === loopId) continue;
    if (doneReach.has(id)) continue;
    iter.add(id);
  }
  return iter;
}

function bfsForward(seeds: string[], edges: FlowEdge[]): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const arr = adj.get(e.source) ?? [];
    arr.push(e.target);
    adj.set(e.source, arr);
  }
  const out = new Set<string>(seeds);
  const queue = [...seeds];
  while (queue.length) {
    const id = queue.shift()!;
    for (const t of adj.get(id) ?? []) {
      if (!out.has(t)) {
        out.add(t);
        queue.push(t);
      }
    }
  }
  return out;
}

/**
 * Topo-sort restricted to a given set of nodes. Used to order the iter body
 * of a loop. Edges that touch nodes outside `subset` are ignored (the loop
 * node itself is one such "outside" predecessor — its targets become roots).
 */
export function topoSortSubset(
  allNodes: FlowNode[],
  edges: FlowEdge[],
  subset: Set<string>
): FlowNode[] {
  const nodes = allNodes.filter((n) => subset.has(n.id));
  const incoming = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    incoming.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (!subset.has(e.target) || !subset.has(e.source)) continue;
    incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
    adj.get(e.source)!.push(e.target);
  }
  const queue: string[] = [];
  for (const [id, n] of incoming.entries()) if (n === 0) queue.push(id);
  const ordered: FlowNode[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    const node = nodes.find((n) => n.id === id);
    if (node) ordered.push(node);
    for (const next of adj.get(id) ?? []) {
      incoming.set(next, (incoming.get(next) ?? 1) - 1);
      if (incoming.get(next) === 0) queue.push(next);
    }
  }
  return ordered;
}
