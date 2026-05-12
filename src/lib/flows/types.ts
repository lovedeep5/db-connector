import type { ZodTypeAny } from "zod";

/**
 * Shape of a flow's DAG. Stored in `flows.definition` as JSON.
 */
export type FlowDefinition = {
  version: 1;
  trigger: TriggerSpec;
  nodes: FlowNode[];
  edges: FlowEdge[];
};

export type TriggerSpec =
  | { type: "schedule"; config: { cron: string } }
  | { type: "manual"; config: Record<string, never> }
  | { type: "webhook"; config: { method?: "POST" | "GET" } };

export type FlowNode = {
  id: string;
  type: string;
  config: Record<string, unknown>;
  position: { x: number; y: number };
  /** Per-node override of flow's default_node_timeout_ms */
  timeoutMs?: number;
};

export type FlowEdge = {
  id: string;
  source: string;
  target: string;
  /** Optional named port for branching nodes (true/false on if/else). */
  sourcePort?: string;
};

// ─── Trigger payload (input the executor receives) ─────────────────────

export type TriggerPayload =
  | { kind: "schedule"; firedAt: Date }
  | { kind: "manual"; startedBy: string }
  | { kind: "webhook"; body: unknown; headers: Record<string, string>; query: Record<string, string> };

// ─── Node execution interface ──────────────────────────────────────────

export type NodeCategory = "trigger" | "data" | "io" | "transform" | "control";

export type NodeContext = {
  flowId: string;
  flowRunId: string;
  /** The user the flow runs as — their RBAC applies to DB queries etc. */
  userId: string;
  /** All previous nodes' outputs, keyed by node id. */
  prevOutputs: Map<string, unknown>;
  /** Original trigger payload, available everywhere. */
  trigger: TriggerPayload;
  /** Logger that streams to flow_node_runs (used by JS code node). */
  log: (line: string) => void;
};

export interface NodeDef<Config = unknown, Output = unknown> {
  type: string;
  label: string;
  description: string;
  category: NodeCategory;
  /** lucide-react icon name */
  icon: string;
  /** Hex color or Tailwind class fragment for the accent. */
  accent: string;
  schema: ZodTypeAny;
  defaultConfig: () => Config;
  /** Whether this node receives data from upstream (false for triggers, true for everything else). */
  takesInput: boolean;
  /** Named output ports for branching nodes; omit for single-port (default ""). */
  outputPorts?: string[];
  /**
   * For branching nodes, return which port(s) activated given this run's
   * output. Edges leaving via inactive ports are ignored — their downstream
   * nodes are skipped. When omitted, all outgoing edges are live.
   */
  computeActivePorts?: (output: Output) => string[];
  execute: (ctx: NodeContext, config: Config) => Promise<Output>;
}

// ─── Wire-safe output shape passed between nodes ───────────────────────

/** Rows from a DB query. Universal "data" shape that other nodes consume. */
export type RowsOutput = {
  rows: Record<string, unknown>[];
  columns: string[];
  rowCount: number;
  truncated?: boolean;
};

/** Output of the to-file node — Buffer / metadata pair carried through. */
export type FileOutput = {
  filename: string;
  contentType: string;
  size: number;
  /** Base64-encoded content. Keeps the value JSON-serialisable for run history. */
  contentBase64: string;
};
