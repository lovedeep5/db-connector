/**
 * Normalises a stored FlowDefinition into the canonical v2 shape where
 * triggers live as first-class entries inside `nodes[]`. v1 stored the
 * single trigger in `def.trigger` and used a synthetic `__trigger__` id
 * for edges; this hoists it into the node list so the runner, scheduler,
 * poller, webhook handler and UI can all walk a single uniform structure.
 *
 * Idempotent — calling on an already-v2 definition is a no-op.
 */
import type { FlowDefinition, FlowNode, TriggerNodeType } from "./types";
import { isTriggerType } from "./types";

const LEGACY_TRIGGER_ID = "__trigger__";

export function normalizeFlowDefinition(def: FlowDefinition): FlowDefinition {
  // Already v2: triggers are in nodes, def.trigger is absent / undefined.
  if (!def.trigger) {
    return { ...def, version: 2, trigger: undefined };
  }
  // Defensive: if both shapes are present, prefer the nodes[]-based one
  // and drop the legacy field.
  const hasTriggerNode = def.nodes.some((n) => isTriggerType(n.type));
  if (hasTriggerNode) {
    return { ...def, version: 2, trigger: undefined };
  }
  // v1 → v2: lift def.trigger into a node. Keep id stable at "__trigger__"
  // so any existing edges from the legacy sentinel still resolve.
  const triggerNode: FlowNode = {
    id: LEGACY_TRIGGER_ID,
    type: def.trigger.type,
    config: def.trigger.config as Record<string, unknown>,
    position: { x: 80, y: 200 },
  };
  return {
    version: 2,
    nodes: [triggerNode, ...def.nodes],
    edges: def.edges,
    trigger: undefined,
  };
}

/** Returns the trigger nodes from a (normalized) FlowDefinition. */
export function triggerNodes(def: FlowDefinition): FlowNode[] {
  return def.nodes.filter((n) => isTriggerType(n.type));
}

/** Returns the trigger nodes of a specific type. */
export function triggerNodesOfType(def: FlowDefinition, type: TriggerNodeType): FlowNode[] {
  return def.nodes.filter((n) => n.type === type);
}

/** Best-effort "entry trigger" for a test run / manual fire. Prefers manual. */
export function pickEntryTrigger(def: FlowDefinition): FlowNode | undefined {
  const triggers = triggerNodes(def);
  return (
    triggers.find((n) => n.type === "manual") ??
    triggers[0]
  );
}

/**
 * Parse the raw JSON string out of `flows.definition` into a normalized
 * FlowDefinition. Throws on malformed JSON.
 */
export function parseAndNormalize(raw: string): FlowDefinition {
  let def: FlowDefinition;
  try { def = JSON.parse(raw) as FlowDefinition; }
  catch { throw new Error("Flow definition is not valid JSON"); }
  return normalizeFlowDefinition(def);
}
