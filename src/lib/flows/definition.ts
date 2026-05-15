/**
 * Normalises a stored FlowDefinition into the canonical v2 shape where
 * triggers live as first-class entries inside `nodes[]`. v1 stored the
 * single trigger in `def.trigger` and used a synthetic `__trigger__` id
 * for edges; this hoists it into the node list so the runner, scheduler,
 * poller, webhook handler and UI can all walk a single uniform structure.
 *
 * Also backfills default values for required trigger fields. Trigger node
 * configs are stored as `z.record(z.unknown())` so a field the user never
 * actively interacted with (e.g. S3 "First-poll mode" left on its default)
 * was previously absent from the saved JSON — leading to silent runtime
 * surprises like the poller treating a skipExisting trigger as processAll.
 * Filling here means every consumer (UI, poller, scheduler, webhook router)
 * always sees a complete config.
 *
 * Idempotent — calling on an already-v2 definition is a no-op.
 */
import type { FlowDefinition, FlowNode, TriggerNodeType } from "./types";
import { isTriggerType } from "./types";

const LEGACY_TRIGGER_ID = "__trigger__";

/**
 * Canonical defaults for trigger node configs. Single source of truth
 * shared between the editor's drop-node path and the read-normalization
 * path so an existing flow with a half-filled trigger gets healed on the
 * next load without the user having to reselect anything.
 */
export function triggerDefaults(type: string): Record<string, unknown> {
  switch (type) {
    case "schedule": return { cron: "0 9 * * *" };
    case "manual": return {};
    case "webhook": return { method: "POST" };
    case "s3.objectCreated":
      return {
        connectionId: "",
        bucket: "",
        prefix: "",
        suffix: "",
        pollIntervalSec: 60,
        mode: "skipExisting",
        maxBatch: 50,
      };
    default: return {};
  }
}

function withTriggerDefaults(node: FlowNode): FlowNode {
  if (!isTriggerType(node.type)) return node;
  const defaults = triggerDefaults(node.type);
  const filled: Record<string, unknown> = { ...defaults, ...node.config };
  // Bail out if nothing changed so the node object identity is preserved
  // (React Flow / memoized consumers care about reference stability).
  const same = Object.keys(filled).every((k) => filled[k] === node.config[k])
    && Object.keys(filled).length === Object.keys(node.config).length;
  return same ? node : { ...node, config: filled };
}

export function normalizeFlowDefinition(def: FlowDefinition): FlowDefinition {
  // Already v2: triggers are in nodes, def.trigger is absent / undefined.
  if (!def.trigger) {
    const filled = def.nodes.map(withTriggerDefaults);
    const changed = filled.some((n, i) => n !== def.nodes[i]);
    return changed
      ? { ...def, version: 2, trigger: undefined, nodes: filled }
      : { ...def, version: 2, trigger: undefined };
  }
  // Defensive: if both shapes are present, prefer the nodes[]-based one
  // and drop the legacy field.
  const hasTriggerNode = def.nodes.some((n) => isTriggerType(n.type));
  if (hasTriggerNode) {
    const filled = def.nodes.map(withTriggerDefaults);
    return { ...def, version: 2, trigger: undefined, nodes: filled };
  }
  // v1 → v2: lift def.trigger into a node. Keep id stable at "__trigger__"
  // so any existing edges from the legacy sentinel still resolve.
  const triggerNode: FlowNode = withTriggerDefaults({
    id: LEGACY_TRIGGER_ID,
    type: def.trigger.type,
    config: def.trigger.config as Record<string, unknown>,
    position: { x: 80, y: 200 },
  });
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
