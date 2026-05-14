import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { getNode } from "@/lib/flows/registry";
import { ensureNodesRegistered } from "@/lib/flows/nodes";
import { applyTemplate, buildScope } from "@/lib/flows/templating";
import { iterSubgraphFor, topoSortSubset } from "@/lib/flows/loop-graph";
import { parseAndNormalize } from "@/lib/flows/definition";
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
import { isTriggerType } from "@/lib/flows/types";

ensureNodesRegistered();

/**
 * In-process counter of how many runs of each flow are currently executing.
 * Used to enforce `max_concurrent_runs` and `execution_mode = sequential`.
 */
const g = globalThis as unknown as { __dbcFlowRunning?: Map<string, number> };
const running: Map<string, number> = (g.__dbcFlowRunning ??= new Map());

export type StartRunOpts = {
  flowId: string;
  trigger: TriggerPayload;
  startedBy?: string | null;
  /**
   * Id of the trigger node that fired this run. With v2 multi-trigger flows
   * the runner uses this to restrict execution to that trigger's downstream;
   * other trigger subgraphs in the same flow stay dormant. Omit for legacy
   * single-trigger flows (the runner falls back to "all root nodes").
   */
  entryTriggerId?: string;
};

export class FlowConcurrencyError extends Error {
  constructor(msg: string) { super(msg); this.name = "FlowConcurrencyError"; }
}

/**
 * Run a flow end-to-end. Returns when execution finishes (or fails). The
 * caller can `await` or fire-and-forget.
 */
export async function runFlow(opts: StartRunOpts): Promise<{ runId: string; status: "success" | "error" }> {
  const flow = await loadFlow(opts.flowId);
  if (!flow) throw new Error("Flow not found");
  if (!flow.isActive && opts.trigger.kind === "schedule") {
    throw new FlowConcurrencyError("Flow is inactive");
  }

  // Concurrency gates
  const inflight = running.get(opts.flowId) ?? 0;
  const cap = flow.executionMode === "sequential" ? 1 : flow.maxConcurrentRuns;
  if (inflight >= cap) {
    throw new FlowConcurrencyError(
      `Skipped: ${inflight} run(s) already in flight (cap ${cap}, mode ${flow.executionMode})`
    );
  }

  const def = parseDefinition(flow.definition);
  const startedAt = new Date();

  const [run] = await db
    .insert(schema.flowRuns)
    .values({
      flowId: flow.id,
      triggerType: opts.trigger.kind,
      triggerPayload: JSON.stringify(serialiseTrigger(opts.trigger)),
      status: "running",
      startedBy: opts.startedBy ?? null,
      startedAt,
    })
    .returning();

  running.set(opts.flowId, inflight + 1);

  let status: "success" | "error" = "success";
  let errorMessage: string | null = null;

  try {
    await executeNodes(flow, def, run.id, opts.trigger, opts.entryTriggerId);
  } catch (e) {
    status = "error";
    errorMessage = (e as Error).message;
  } finally {
    const finishedAt = new Date();
    await db
      .update(schema.flowRuns)
      .set({
        status,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        errorMessage,
      })
      .where(eq(schema.flowRuns.id, run.id));
    await db
      .update(schema.flows)
      .set({ lastRunAt: finishedAt, lastRunStatus: status })
      .where(eq(schema.flows.id, flow.id));
    running.set(opts.flowId, (running.get(opts.flowId) ?? 1) - 1);
  }
  return { runId: run.id, status };
}

// ─── internals ───

async function loadFlow(flowId: string) {
  const [row] = await db.select().from(schema.flows).where(eq(schema.flows.id, flowId));
  return row;
}

function parseDefinition(raw: string): FlowDefinition {
  // Always normalize to v2 (triggers in nodes[]) so the rest of the runner
  // walks a single uniform shape. parseAndNormalize throws on malformed JSON
  // with a friendly message.
  return parseAndNormalize(raw);
}

function serialiseTrigger(t: TriggerPayload): unknown {
  if (t.kind === "schedule") return { kind: t.kind, firedAt: t.firedAt.toISOString() };
  return t;
}

async function executeNodes(
  flow: typeof schema.flows.$inferSelect,
  def: FlowDefinition,
  runId: string,
  trigger: TriggerPayload,
  entryTriggerId?: string
) {
  const order = topoSort(def.nodes, def.edges);
  const prevOutputs = new Map<string, unknown>();
  const reachable = initialReachable(def, entryTriggerId);
  /** Nodes already executed as part of a loop's iter body — skip in the outer pass. */
  const consumedByLoop = new Set<string>();

  // Trigger nodes live in `nodes[]` but never go through execute() — they're
  // entry points, not steps. Pre-seed prevOutputs with the firing trigger's
  // payload so `{{ $node.<triggerId>.body }}` etc. works for templating.
  // Non-firing triggers get null so downstream that mistakenly references
  // them sees nothing (they're also not in `reachable`, so their downstream
  // doesn't run).
  const triggerNodeIds = new Set<string>();
  for (const n of def.nodes) {
    if (isTriggerType(n.type)) {
      triggerNodeIds.add(n.id);
      prevOutputs.set(
        n.id,
        n.id === entryTriggerId ? triggerForScope(trigger) : null
      );
    }
  }

  for (const node of order) {
    if (consumedByLoop.has(node.id)) continue;
    // Triggers don't have an execute(), but we still write a flow_node_runs
    // row so the run history shows WHAT fired this run (S3 key, webhook body,
    // schedule firedAt, etc.). Non-firing triggers in the same flow are
    // logged as skipped so the user can see at a glance which entry point
    // actually triggered.
    if (triggerNodeIds.has(node.id)) {
      const fired = reachable.has(node.id);
      if (fired) {
        propagateReachable(node.id, undefined, def.edges, reachable);
        await db.insert(schema.flowNodeRuns).values({
          flowRunId: runId,
          nodeId: node.id,
          nodeType: node.type,
          status: "success",
          output: JSON.stringify(safeSerialise(prevOutputs.get(node.id))),
          durationMs: 0,
          startedAt: new Date(),
        });
      } else {
        await db.insert(schema.flowNodeRuns).values({
          flowRunId: runId,
          nodeId: node.id,
          nodeType: node.type,
          status: "skipped",
          durationMs: 0,
          startedAt: new Date(),
        });
      }
      continue;
    }
    if (!reachable.has(node.id)) {
      // Upstream branching deactivated this path — skip without erroring.
      await db.insert(schema.flowNodeRuns).values({
        flowRunId: runId,
        nodeId: node.id,
        nodeType: node.type,
        status: "skipped",
        durationMs: 0,
        startedAt: new Date(),
      });
      continue;
    }

    const ndef = getNode(node.type);
    if (!ndef) {
      await recordNodeError(runId, node, "error", `Unknown node type: ${node.type}`);
      throw new Error(`Unknown node type: ${node.type}`);
    }

    if (node.type === "control.loop") {
      await executeLoop({
        flow,
        def,
        runId,
        trigger,
        loopNode: node,
        prevOutputs,
        reachable,
        consumedByLoop,
      });
      continue;
    }

    const scope = buildScope({ prevOutputs, trigger: triggerForScope(trigger) });
    const templatedConfig = applyTemplate(node.config, scope);
    const parsed = ndef.schema.safeParse(templatedConfig);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      await recordNodeError(runId, node, "error", `Config invalid: ${msg}`);
      throw new Error(`Config invalid on node ${node.id}: ${msg}`);
    }

    const startedAt = new Date();
    let logLines: string[] = [];
    try {
      const output = await runWithTimeout(
        () =>
          ndef.execute(
            {
              flowId: flow.id,
              flowRunId: runId,
              userId: flow.userId,
              prevOutputs,
              trigger,
              log: (line) => logLines.push(line),
            },
            parsed.data as never
          ),
        node.timeoutMs ?? flow.defaultNodeTimeoutMs
      );
      prevOutputs.set(node.id, output);
      propagateReachable(node.id, ndef.computeActivePorts?.(output), def.edges, reachable);
      const finishedAt = new Date();
      await db.insert(schema.flowNodeRuns).values({
        flowRunId: runId,
        nodeId: node.id,
        nodeType: node.type,
        status: "success",
        input: JSON.stringify(safeSerialise(parsed.data)),
        output: JSON.stringify(safeSerialise(output, logLines)),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        startedAt,
      });
    } catch (e) {
      const finishedAt = new Date();
      const errorMessage = (e as Error).message;
      await db.insert(schema.flowNodeRuns).values({
        flowRunId: runId,
        nodeId: node.id,
        nodeType: node.type,
        status: "error",
        input: JSON.stringify(safeSerialise(parsed.data)),
        output: logLines.length ? JSON.stringify({ logs: logLines }) : null,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        errorMessage,
        startedAt,
      });
      throw e;
    }
  }
}

/**
 * Drives a `control.loop` node.
 *
 * Per-iteration semantics:
 *   - The value flowing through the "item" port is the bare element (or the
 *     batch array when batchSize > 1). That's `$node.<loopId>` for the body,
 *     and naturally `$input` for any direct downstream node.
 *   - Iteration metadata is exposed separately as `{{ $loop.index/total/isFirst/isLast }}`.
 *
 * After all iterations, the "done" port's value is
 *   { done: true, count, iterations, inputs, results }
 * where `results[i]` is the per-iteration output of the body node identified
 * by `collectFrom` (or the body's sole sink when `collectFrom` is blank).
 * If an iteration skipped that node (e.g. an if/else branch was off), the
 * corresponding slot is `null` so positions stay aligned with `inputs`.
 *
 * Persistence: each iter-body node gets ONE flow_node_runs row carrying the
 * last iteration's output and an `iterations` count. Per-iteration history
 * would explode the table for large arrays — accepting some history loss for
 * predictable storage. Errors short-circuit the whole flow.
 */
async function executeLoop(args: {
  flow: typeof schema.flows.$inferSelect;
  def: FlowDefinition;
  runId: string;
  trigger: TriggerPayload;
  loopNode: FlowNode;
  prevOutputs: Map<string, unknown>;
  reachable: Set<string>;
  consumedByLoop: Set<string>;
}) {
  const { flow, def, runId, trigger, loopNode, prevOutputs, reachable, consumedByLoop } = args;
  const ndef = getNode(loopNode.type)!;

  const scope = buildScope({ prevOutputs, trigger: triggerForScope(trigger) });
  const templatedConfig = applyTemplate(loopNode.config, scope);
  const parsed = ndef.schema.safeParse(templatedConfig);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    await recordNodeError(runId, loopNode, "error", `Config invalid: ${msg}`);
    throw new Error(`Config invalid on node ${loopNode.id}: ${msg}`);
  }
  const cfg = parsed.data as {
    items: unknown[];
    batchSize: number;
    maxIterations: number;
  };

  const startedAt = new Date();
  const items = cfg.items;
  const batches = chunk(items, cfg.batchSize);
  if (batches.length > cfg.maxIterations) {
    const msg = `Loop would run ${batches.length} times (max ${cfg.maxIterations}). Raise the cap or shrink the input.`;
    await db.insert(schema.flowNodeRuns).values({
      flowRunId: runId,
      nodeId: loopNode.id,
      nodeType: loopNode.type,
      status: "error",
      input: JSON.stringify(safeSerialise(cfg)),
      durationMs: Date.now() - startedAt.getTime(),
      errorMessage: msg,
      startedAt,
    });
    throw new Error(msg);
  }

  const body = iterSubgraphFor(loopNode.id, def);
  for (const id of body) consumedByLoop.add(id);
  const bodyOrder = topoSortSubset(def.nodes, def.edges, body);

  // Per-iteration "what becomes results[i]" is determined by Loop End nodes
  // inside the body. If the body has any Loop End, whichever one ran that
  // iteration (typically just one due to upstream branching) supplies the
  // collected value. Otherwise, fall back to the body's sole sink — keeps
  // simple foreach flows working without forcing a Loop End on the user.
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
    firstStartedAt: Date | null;
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
      firstStartedAt: null,
      totalDurationMs: 0,
    });
  }

  const collectedResults: unknown[] = [];
  const flatInputs: unknown[] = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const bareItem = cfg.batchSize === 1 ? batch[0] : batch;
    flatInputs.push(bareItem);
    // The "item" edge carries the bare element — body nodes see this as
    // $input and write {{ $node.<loopId>.<field> }} for fields, exactly the
    // same shape as any other node-to-node edge in the system.
    prevOutputs.set(loopNode.id, bareItem);
    const loopMeta = {
      index: i,
      total: batches.length,
      isFirst: i === 0,
      isLast: i === batches.length - 1,
    };

    // Reachability inside the body — restart each iteration so a branch
    // inside the loop can re-decide per item.
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
        await recordNodeError(runId, bn, "error", `Unknown node type: ${bn.type}`);
        throw new Error(`Unknown node type: ${bn.type}`);
      }

      const bScope = buildScope({
        prevOutputs,
        trigger: triggerForScope(trigger),
        loop: loopMeta,
      });
      const bTemplated = applyTemplate(bn.config, bScope);
      const bParsed = bdef.schema.safeParse(bTemplated);
      if (!bParsed.success) {
        const msg = bParsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ");
        await recordNodeError(runId, bn, "error", `Config invalid: ${msg}`);
        throw new Error(`Config invalid on node ${bn.id} (loop iter ${i}): ${msg}`);
      }

      const nStarted = new Date();
      const logs: string[] = [];
      try {
        const output = await runWithTimeout(
          () =>
            bdef.execute(
              {
                flowId: flow.id,
                flowRunId: runId,
                userId: flow.userId,
                prevOutputs,
                trigger,
                log: (line) => logs.push(line),
              },
              bParsed.data as never
            ),
          bn.timeoutMs ?? flow.defaultNodeTimeoutMs
        );
        prevOutputs.set(bn.id, output);
        propagateBody(bn.id, bdef.computeActivePorts?.(output), def.edges, body, bodyReach);
        if (loopEndIds.has(bn.id) || bn.id === fallbackSinkId) collectedThisIter = output;
        const row = bodyRows.get(bn.id)!;
        row.iterations += 1;
        row.lastInput = bParsed.data;
        row.lastOutput = output;
        row.lastLogs = logs;
        if (!row.firstStartedAt) row.firstStartedAt = nStarted;
        row.totalDurationMs += Date.now() - nStarted.getTime();
      } catch (e) {
        const msg = (e as Error).message;
        await db.insert(schema.flowNodeRuns).values({
          flowRunId: runId,
          nodeId: bn.id,
          nodeType: bn.type,
          status: "error",
          input: JSON.stringify(safeSerialise(bParsed.data)),
          output: logs.length ? JSON.stringify({ logs }) : null,
          durationMs: Date.now() - nStarted.getTime(),
          errorMessage: `${msg} (loop iter ${i})`,
          startedAt: nStarted,
        });
        throw e;
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

  await db.insert(schema.flowNodeRuns).values({
    flowRunId: runId,
    nodeId: loopNode.id,
    nodeType: loopNode.type,
    status: "success",
    input: JSON.stringify(safeSerialise(cfg)),
    output: JSON.stringify(safeSerialise(doneOutput)),
    durationMs: Date.now() - startedAt.getTime(),
    startedAt,
  });

  for (const row of bodyRows.values()) {
    const status = row.iterations === 0 ? "skipped" : "success";
    await db.insert(schema.flowNodeRuns).values({
      flowRunId: runId,
      nodeId: row.node.id,
      nodeType: row.node.type,
      status,
      input: row.iterations > 0 ? JSON.stringify(safeSerialise(row.lastInput)) : null,
      output:
        row.iterations > 0
          ? JSON.stringify(
              safeSerialise(
                { iterations: row.iterations, lastOutput: row.lastOutput },
                row.lastLogs
              )
            )
          : null,
      durationMs: row.totalDurationMs,
      startedAt: row.firstStartedAt ?? startedAt,
    });
  }

  propagateReachable(loopNode.id, ["done"], def.edges, reachable);
}

/** Reachability propagation restricted to nodes inside the loop body. */
function propagateBody(
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

/**
 * Initial reachability for the topo pass.
 *
 *  - If `entryTriggerId` is supplied (multi-trigger v2 fire), only THAT
 *    trigger node is initially reachable. The main loop then propagates
 *    downstream as each node finishes — other trigger subgraphs stay
 *    dormant for this run.
 *  - Otherwise (legacy / test runs without a chosen entry), every node
 *    with no DAG-internal incoming edge is a root.
 */
function initialReachable(def: FlowDefinition, entryTriggerId?: string): Set<string> {
  if (entryTriggerId && def.nodes.some((n) => n.id === entryTriggerId)) {
    return new Set<string>([entryTriggerId]);
  }
  const nodeIds = new Set(def.nodes.map((n) => n.id));
  const incomingFromDag = new Map<string, number>();
  for (const e of def.edges) {
    if (!nodeIds.has(e.target)) continue;
    if (!nodeIds.has(e.source)) continue;
    incomingFromDag.set(e.target, (incomingFromDag.get(e.target) ?? 0) + 1);
  }
  const reachable = new Set<string>();
  for (const n of def.nodes) {
    if (!incomingFromDag.has(n.id)) reachable.add(n.id);
  }
  return reachable;
}

/**
 * After a node runs, walk its outgoing edges and mark targets reachable when
 * the edge's `sourcePort` matches one of this node's active ports. If the
 * node didn't declare ports (`computeActivePorts` returned undefined), every
 * outgoing edge is treated as live.
 */
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

function triggerForScope(t: TriggerPayload): unknown {
  if (t.kind === "schedule") return { kind: t.kind, firedAt: t.firedAt.toISOString() };
  return t;
}

async function recordNodeError(runId: string, node: FlowNode, status: "error", msg: string) {
  await db.insert(schema.flowNodeRuns).values({
    flowRunId: runId,
    nodeId: node.id,
    nodeType: node.type,
    status,
    errorMessage: msg,
    durationMs: 0,
    startedAt: new Date(),
  });
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
 * Make a value JSON-serialisable for run history. Truncates large file
 * payloads and binary content so the run-history table doesn't bloat.
 */
function safeSerialise(value: unknown, logs?: string[]): unknown {
  // Track the *ancestor chain* (add on enter, remove on leave) — NOT every
  // object ever seen during the walk. That distinction matters: two siblings
  // can legitimately reference the same object (e.g. the loop's `inputs[i]`
  // appears both directly and indirectly via downstream node outputs); only
  // when an object is its own ancestor is it a true cycle.
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
        return slice.map(walk);
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
  const out = walk(value);
  if (logs && logs.length) {
    return { value: out, logs };
  }
  return out;
}
