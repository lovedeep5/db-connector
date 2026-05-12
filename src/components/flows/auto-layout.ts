/**
 * Auto-layout for the flow canvas. Uses Dagre to assign x/y positions to all
 * nodes given the edge graph. Handles multi-port branching (if/else, loop's
 * item/done) naturally — dagre just sees source→target edges and untangles
 * crossings on its own.
 *
 * We hand back NEW node objects with updated `position` so the caller can
 * setNodes() — keeping React Flow's identity-stable rerender happy.
 */
import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";

export type LayoutDirection = "LR" | "TB";

/**
 * Approximate node dimensions for dagre's spacing calculation. The canvas
 * renders nodes with w-56 (= 224px) and ~80px tall — close enough that
 * dagre's gap math doesn't visibly overlap or underlap.
 */
const NODE_W = 224;
const NODE_H = 80;

export function applyDagreLayout<T extends Node = Node>(
  nodes: T[],
  edges: Edge[],
  opts: { direction?: LayoutDirection; nodeSep?: number; rankSep?: number } = {}
): T[] {
  if (nodes.length === 0) return nodes;
  const direction = opts.direction ?? "LR";

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: direction,
    nodesep: opts.nodeSep ?? 60,   // gap between siblings at the same rank
    ranksep: opts.rankSep ?? 110,  // gap between successive ranks
    marginx: 20,
    marginy: 20,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    g.setNode(n.id, { width: NODE_W, height: NODE_H });
  }
  for (const e of edges) {
    // Skip edges whose endpoints aren't in the node set — keeps dagre from
    // throwing if the graph state is mid-edit and an edge references a node
    // that was removed but not yet pruned.
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    if (!pos) return n;
    // Dagre returns the centre of the node; React Flow wants the top-left.
    return { ...n, position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 } };
  });
}
