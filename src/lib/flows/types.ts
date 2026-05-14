import type { ZodTypeAny } from "zod";

/**
 * Shape of a flow's DAG. Stored in `flows.definition` as JSON.
 *
 * v1 had a separate `trigger: TriggerSpec` field — exactly one trigger.
 * v2 makes triggers first-class members of `nodes[]` so a flow can have
 * any number of them (e.g. run on schedule AND let users hit a webhook
 * on demand). `trigger` is kept as an OPTIONAL legacy field; on load,
 * `normalizeFlowDefinition` hoists it into `nodes[]` as the canonical
 * shape so all downstream code works the same way.
 */
export type FlowDefinition = {
  version: 1 | 2;
  /** Legacy v1 single trigger. Always undefined after normalization. */
  trigger?: TriggerSpec;
  nodes: FlowNode[];
  edges: FlowEdge[];
};

/** Catalog types that are entry-points rather than executable steps. */
export const TRIGGER_NODE_TYPES = [
  "schedule",
  "manual",
  "webhook",
  "s3.objectCreated",
] as const;
export type TriggerNodeType = typeof TRIGGER_NODE_TYPES[number];

export function isTriggerType(t: string): t is TriggerNodeType {
  return (TRIGGER_NODE_TYPES as readonly string[]).includes(t);
}

export type TriggerSpec =
  | { type: "schedule"; config: { cron: string } }
  | { type: "manual"; config: Record<string, never> }
  | {
      type: "webhook";
      config: {
        /** HTTP method accepted on the inbound URL. */
        method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
        /** Optional shared secret. When set, requests MUST send it as the X-Webhook-Secret header. */
        secret?: string;
      };
    }
  | {
      type: "s3.objectCreated";
      config: {
        /** S3 credential id from the connections table. */
        connectionId: string;
        bucket: string;
        /** Folder prefix (optional). e.g. "uploads/incoming/" */
        prefix?: string;
        /** Suffix / extension filter (optional). e.g. ".csv" */
        suffix?: string;
        /** Seconds between polls. Server clamps to [30, 1800]. */
        pollIntervalSec: number;
        /**
         * - skipExisting: when first activated, ignore existing objects;
         *   only fire for keys that land after.
         * - processAll: fire for every existing object on first poll, then
         *   stream new ones.
         */
        mode: "skipExisting" | "processAll";
        /** Cap on objects fired per poll. Default 50. Backlog spills to the next tick. */
        maxBatch: number;
      };
    };

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
  | { kind: "webhook"; body: unknown; headers: Record<string, string>; query: Record<string, string> }
  | {
      kind: "s3";
      bucket: string;
      key: string;
      size: number;
      /** ISO timestamp string for predictable templating. */
      lastModified: string;
      etag: string;
      contentType?: string;
      /** Short-lived presigned GET URL so the Download File node "just works". */
      presignedUrl: string;
    };

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
