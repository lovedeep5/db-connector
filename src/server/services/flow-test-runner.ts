/**
 * In-memory ("ephemeral") flow runner used by the editor's "Test run" button.
 *
 * Differences from `runFlow`:
 *   - The flow does not need to exist in the DB; you pass the definition.
 *   - Nothing is persisted to `flow_runs` / `flow_node_runs`.
 *   - Per-node inputs/outputs are returned to the caller so the canvas can
 *     decorate each node with its latest result.
 *
 * Per-flow concurrency caps and ScheduleConcurrency errors do not apply —
 * test runs are always allowed.
 */
import { applyTemplate, buildScope } from "@/lib/flows/templating";
import { getNode } from "@/lib/flows/registry";
import { ensureNodesRegistered } from "@/lib/flows/nodes";
import { iterSubgraphFor, topoSortSubset } from "@/lib/flows/loop-graph";
import {
  bodySinks,
  chunk,
  findLoopEndIds,
  type LoopDoneOutput,
} from "@/lib/flows/nodes/loop";
import type {
  FlowDefinition,
  FlowEdge,
  FlowNode,
  TriggerPayload,
} from "@/lib/flows/types";

ensureNodesRegistered();

export type TestNodeResult = {
  nodeId: string;
  nodeType: string;
  status: "success" | "error" | "skipped";
  durationMs: number;
  input?: unknown;
  output?: unknown;
  errorMessage?: string;
  logs?: string[];
};

export type TestRunResult = {
  status: "success" | "error";
  errorMessage?: string;
  durationMs: number;
  nodes: TestNodeResult[];
};

/**
 * Progress events emitted during a test run. Consumed by the streaming
 * API route to send live "currently processing" feedback to the canvas.
 * `nodeEnd` carries the same shape as the eventual `TestRunResult.nodes[i]`
 * so the client can update the per-node status in place.
 */
export type TestRunEvent =
  | { type: "nodeStart"; nodeId: string; nodeType: string }
  | { type: "nodeEnd"; result: TestNodeResult };

export type TestRunOpts = {
  definition: FlowDefinition;
  userId: string;
  defaultNodeTimeoutMs?: number;
  trigger?: TriggerPayload;
  /**
   * Called as each node begins and finishes execution. Optional — the
   * non-streaming Server Action path doesn't subscribe; the streaming
   * route handler does, to relay events to the client.
   */
  onEvent?: (event: TestRunEvent) => void;
};

export async function testRunFlow(opts: TestRunOpts): Promise<TestRunResult> {
  const started = Date.now();
  const def = opts.definition;
  const trigger: TriggerPayload = opts.trigger ?? { kind: "manual", startedBy: opts.userId };
  const defaultTimeout = opts.defaultNodeTimeoutMs ?? 60_000;

  const order = topoSort(def.nodes, def.edges);
  const prevOutputs = new Map<string, unknown>();
  const reachable = initialReachable(def);
  const consumedByLoop = new Set<string>();
  const results: TestNodeResult[] = [];

  // Event helpers — the streaming route subscribes via opts.onEvent.
  const emit = (e: TestRunEvent) => opts.onEvent?.(e);
  const record = (r: TestNodeResult) => {
    results.push(r);
    emit({ type: "nodeEnd", result: r });
  };
  const startNode = (nodeId: string, nodeType: string) => {
    emit({ type: "nodeStart", nodeId, nodeType });
  };

  let overallStatus: "success" | "error" = "success";
  let overallError: string | undefined;

  for (const node of order) {
    if (consumedByLoop.has(node.id)) continue;
    if (!reachable.has(node.id)) {
      record({
        nodeId: node.id,
        nodeType: node.type,
        status: "skipped",
        durationMs: 0,
      });
      continue;
    }
    const ndef = getNode(node.type);
    if (!ndef) {
      record({
        nodeId: node.id,
        nodeType: node.type,
        status: "error",
        durationMs: 0,
        errorMessage: `Unknown node type: ${node.type}`,
      });
      overallStatus = "error";
      overallError = `Unknown node type: ${node.type}`;
      break;
    }

    if (node.type === "control.loop") {
      const outcome = await runLoopTest({
        def,
        loopNode: node,
        prevOutputs,
        reachable,
        consumedByLoop,
        results,
        record,
        startNode,
        trigger,
        userId: opts.userId,
        defaultTimeout,
      });
      if (outcome.error) {
        overallStatus = "error";
        overallError = outcome.error;
        break;
      }
      continue;
    }

    startNode(node.id, node.type);
    const scope = buildScope({ prevOutputs, trigger: triggerForScope(trigger) });
    const templated = applyTemplate(node.config, scope);
    const parsed = ndef.schema.safeParse(templated);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      record({
        nodeId: node.id,
        nodeType: node.type,
        status: "error",
        durationMs: 0,
        errorMessage: `Config invalid: ${msg}`,
      });
      overallStatus = "error";
      overallError = `Config invalid on node ${node.id}: ${msg}`;
      break;
    }

    const nodeStart = Date.now();
    const logs: string[] = [];
    try {
      const output = await runWithTimeout(
        () =>
          ndef.execute(
            {
              flowId: "__test__",
              flowRunId: `test-${nodeStart}`,
              userId: opts.userId,
              prevOutputs,
              trigger,
              log: (line) => logs.push(line),
            },
            parsed.data as never
          ),
        node.timeoutMs ?? defaultTimeout
      );
      prevOutputs.set(node.id, output);
      propagateReachable(node.id, ndef.computeActivePorts?.(output), def.edges, reachable);
      record({
        nodeId: node.id,
        nodeType: node.type,
        status: "success",
        durationMs: Date.now() - nodeStart,
        input: safeSerialise(parsed.data),
        output: safeSerialise(output),
        logs: logs.length ? logs : undefined,
      });
    } catch (e) {
      const msg = (e as Error).message;
      record({
        nodeId: node.id,
        nodeType: node.type,
        status: "error",
        durationMs: Date.now() - nodeStart,
        input: safeSerialise(parsed.data),
        errorMessage: msg,
        logs: logs.length ? logs : undefined,
      });
      overallStatus = "error";
      overallError = msg;
      break;
    }
  }

  return {
    status: overallStatus,
    errorMessage: overallError,
    durationMs: Date.now() - started,
    nodes: results,
  };
}

function triggerForScope(t: TriggerPayload): unknown {
  if (t.kind === "schedule") return { kind: t.kind, firedAt: t.firedAt.toISOString() };
  return t;
}

function initialReachable(def: FlowDefinition): Set<string> {
  const nodeIds = new Set(def.nodes.map((n) => n.id));
  const incomingFromDag = new Map<string, number>();
  for (const e of def.edges) {
    if (!nodeIds.has(e.target) || !nodeIds.has(e.source)) continue;
    incomingFromDag.set(e.target, (incomingFromDag.get(e.target) ?? 0) + 1);
  }
  const reachable = new Set<string>();
  for (const n of def.nodes) {
    if (!incomingFromDag.has(n.id)) reachable.add(n.id);
  }
  return reachable;
}

function propagateReachable(
  nodeId: string,
  activePorts: string[] | undefined,
  edges: FlowDefinition["edges"],
  reachable: Set<string>
) {
  const portsActive = activePorts ? new Set(activePorts) : null;
  for (const e of edges) {
    if (e.source !== nodeId) continue;
    const sp = e.sourcePort ?? "";
    if (portsActive === null || portsActive.has(sp)) {
      reachable.add(e.target);
    }
  }
}

function topoSort(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
  const incoming = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    incoming.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (!incoming.has(e.target) || !adj.has(e.source)) continue;
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
  if (ordered.length !== nodes.length) {
    throw new Error("Flow has a cycle — cannot execute.");
  }
  return ordered;
}

async function runWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Node timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Test-mode driver for a `control.loop` node. Mirrors `executeLoop` in the
 * persistent runner but writes to the in-memory `results` array instead of
 * the run-history table. Returns `{ error }` so the caller can short-circuit
 * the outer pass on failure.
 */
async function runLoopTest(args: {
  def: FlowDefinition;
  loopNode: FlowNode;
  prevOutputs: Map<string, unknown>;
  reachable: Set<string>;
  consumedByLoop: Set<string>;
  results: TestNodeResult[];
  record: (r: TestNodeResult) => void;
  startNode: (nodeId: string, nodeType: string) => void;
  trigger: TriggerPayload;
  userId: string;
  defaultTimeout: number;
}): Promise<{ error?: string }> {
  const { def, loopNode, prevOutputs, reachable, consumedByLoop, record, startNode, trigger, defaultTimeout } = args;
  void args.results; // body of loop never reads results directly — record() does.
  const ndef = getNode(loopNode.type)!;
  const loopStart = Date.now();

  startNode(loopNode.id, loopNode.type);
  const scope = buildScope({ prevOutputs, trigger: triggerForScope(trigger) });
  const templated = applyTemplate(loopNode.config, scope);
  const parsed = ndef.schema.safeParse(templated);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    record({
      nodeId: loopNode.id,
      nodeType: loopNode.type,
      status: "error",
      durationMs: 0,
      errorMessage: `Config invalid: ${msg}`,
    });
    return { error: `Config invalid on node ${loopNode.id}: ${msg}` };
  }
  const cfg = parsed.data as {
    items: unknown[];
    batchSize: number;
    maxIterations: number;
  };

  const items = cfg.items;
  const batches = chunk(items, cfg.batchSize);
  if (batches.length > cfg.maxIterations) {
    const msg = `Loop would run ${batches.length} times (max ${cfg.maxIterations}).`;
    record({
      nodeId: loopNode.id,
      nodeType: loopNode.type,
      status: "error",
      durationMs: Date.now() - loopStart,
      input: safeSerialise(cfg),
      errorMessage: msg,
    });
    return { error: msg };
  }

  const body = iterSubgraphFor(loopNode.id, def);
  for (const id of body) consumedByLoop.add(id);
  const bodyOrder = topoSortSubset(def.nodes, def.edges, body);

  const loopEndIds = findLoopEndIds(body, def.nodes);
  const fallbackSinkId =
    loopEndIds.size === 0 && body.size > 0
      ? (bodySinks(body, def.edges)[0] ?? null)
      : null;

  type BodyRow = {
    node: FlowNode;
    iterations: number;
    lastInput: unknown;
    lastOutput: unknown;
    lastLogs: string[];
    totalDurationMs: number;
  };
  const bodyRows = new Map<string, BodyRow>();
  for (const bn of bodyOrder) {
    bodyRows.set(bn.id, {
      node: bn,
      iterations: 0,
      lastInput: undefined,
      lastOutput: undefined,
      lastLogs: [],
      totalDurationMs: 0,
    });
  }

  const collectedResults: unknown[] = [];
  const flatInputs: unknown[] = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const bareItem = cfg.batchSize === 1 ? batch[0] : batch;
    flatInputs.push(bareItem);
    prevOutputs.set(loopNode.id, bareItem);
    const loopMeta = {
      index: i,
      total: batches.length,
      isFirst: i === 0,
      isLast: i === batches.length - 1,
    };

    const bodyReach = new Set<string>();
    for (const bn of bodyOrder) {
      const dagIncoming = def.edges.some(
        (e) => e.target === bn.id && body.has(e.source) && e.source !== loopNode.id
      );
      if (!dagIncoming) bodyReach.add(bn.id);
    }

    let collectedThisIter: unknown = null;

    for (const bn of bodyOrder) {
      if (!bodyReach.has(bn.id)) continue;
      const bdef = getNode(bn.type);
      if (!bdef) {
        record({
          nodeId: bn.id,
          nodeType: bn.type,
          status: "error",
          durationMs: 0,
          errorMessage: `Unknown node type: ${bn.type}`,
        });
        return { error: `Unknown node type: ${bn.type}` };
      }
      startNode(bn.id, bn.type);
      const bScope = buildScope({
        prevOutputs,
        trigger: triggerForScope(trigger),
        loop: loopMeta,
      });
      const bTemplated = applyTemplate(bn.config, bScope);
      const bParsed = bdef.schema.safeParse(bTemplated);
      if (!bParsed.success) {
        const msg = bParsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ");
        record({
          nodeId: bn.id,
          nodeType: bn.type,
          status: "error",
          durationMs: 0,
          errorMessage: `Config invalid (loop iter ${i}): ${msg}`,
        });
        return { error: `Config invalid on node ${bn.id} (loop iter ${i}): ${msg}` };
      }

      const nStart = Date.now();
      const logs: string[] = [];
      try {
        const output = await runWithTimeout(
          () =>
            bdef.execute(
              {
                flowId: "__test__",
                flowRunId: `test-${nStart}`,
                userId: args.userId,
                prevOutputs,
                trigger,
                log: (line) => logs.push(line),
              },
              bParsed.data as never
            ),
          bn.timeoutMs ?? defaultTimeout
        );
        prevOutputs.set(bn.id, output);
        propagateBodyTest(bn.id, bdef.computeActivePorts?.(output), def.edges, body, bodyReach);
        if (loopEndIds.has(bn.id) || bn.id === fallbackSinkId) collectedThisIter = output;
        const row = bodyRows.get(bn.id)!;
        row.iterations += 1;
        row.lastInput = bParsed.data;
        row.lastOutput = output;
        row.lastLogs = logs;
        row.totalDurationMs += Date.now() - nStart;
      } catch (e) {
        const msg = (e as Error).message;
        record({
          nodeId: bn.id,
          nodeType: bn.type,
          status: "error",
          durationMs: Date.now() - nStart,
          input: safeSerialise(bParsed.data),
          errorMessage: `${msg} (loop iter ${i})`,
          logs: logs.length ? logs : undefined,
        });
        return { error: msg };
      }
    }
    collectedResults.push(collectedThisIter);
  }

  const doneOutput: LoopDoneOutput = {
    done: true,
    count: items.length,
    iterations: batches.length,
    inputs: flatInputs,
    results: collectedResults,
  };
  prevOutputs.set(loopNode.id, doneOutput);

  record({
    nodeId: loopNode.id,
    nodeType: loopNode.type,
    status: "success",
    durationMs: Date.now() - loopStart,
    input: safeSerialise(cfg),
    output: safeSerialise(doneOutput),
  });
  for (const row of bodyRows.values()) {
    const status: "success" | "skipped" = row.iterations === 0 ? "skipped" : "success";
    record({
      nodeId: row.node.id,
      nodeType: row.node.type,
      status,
      durationMs: row.totalDurationMs,
      input: row.iterations > 0 ? safeSerialise(row.lastInput) : undefined,
      output:
        row.iterations > 0
          ? safeSerialise({ iterations: row.iterations, lastOutput: row.lastOutput })
          : undefined,
      logs: row.lastLogs.length ? row.lastLogs : undefined,
    });
  }
  propagateReachable(loopNode.id, ["done"], def.edges, reachable);
  return {};
}

function propagateBodyTest(
  nodeId: string,
  activePorts: string[] | undefined,
  edges: FlowEdge[],
  body: Set<string>,
  bodyReach: Set<string>
) {
  const portsActive = activePorts ? new Set(activePorts) : null;
  for (const e of edges) {
    if (e.source !== nodeId) continue;
    if (!body.has(e.target)) continue;
    const sp = e.sourcePort ?? "";
    if (portsActive === null || portsActive.has(sp)) bodyReach.add(e.target);
  }
}

function safeSerialise(value: unknown): unknown {
  // Track the *ancestor chain*, not every object ever seen — see flow-runner
  // for the long version. Sibling references to the same object must serialise
  // as full clones, not "[circular]". This is why the loop's results array was
  // showing "[circular]" for items past the first.
  const ancestors = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (v == null) return v;
    if (Buffer.isBuffer(v)) return `<binary ${v.length} bytes>`;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "bigint") return v.toString();
    if (typeof v !== "object") return v;
    if (ancestors.has(v as object)) return "[circular]";
    ancestors.add(v as object);
    try {
      if (Array.isArray(v)) {
        const slice = v.length > 100 ? v.slice(0, 100) : v;
        const out = slice.map(walk);
        if (v.length > 100) out.push(`<... ${v.length - 100} more rows>`);
        return out;
      }
      const obj: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (k === "contentBase64" && typeof val === "string") {
          obj[k] = `<base64 ${val.length} chars>`;
        } else {
          obj[k] = walk(val);
        }
      }
      return obj;
    } finally {
      ancestors.delete(v as object);
    }
  };
  return walk(value);
}
