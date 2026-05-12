import type { NodeDef } from "./types";

/** Map of node type → definition. Populated by importing nodes/* modules. */
const REGISTRY = new Map<string, NodeDef>();

export function registerNode(def: NodeDef): void {
  REGISTRY.set(def.type, def);
}

export function getNode(type: string): NodeDef | undefined {
  return REGISTRY.get(type);
}

export function allNodes(): NodeDef[] {
  return [...REGISTRY.values()];
}

export function isRegistered(type: string): boolean {
  return REGISTRY.has(type);
}
