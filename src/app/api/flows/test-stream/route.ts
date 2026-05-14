import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { testRunFlow, type TestRunEvent } from "@/server/services/flow-test-runner";
import { pruneToAncestorsOf } from "@/lib/flows/subflow";
import { normalizeFlowDefinition, pickEntryTrigger } from "@/lib/flows/definition";
import { probeS3OnceForTest } from "@/lib/flows/s3-poller";
import { isTriggerType, type FlowDefinition, type FlowNode, type TriggerPayload } from "@/lib/flows/types";

export const runtime = "nodejs";

const DefSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  trigger: z.object({ type: z.string(), config: z.record(z.unknown()) }).optional(),
  nodes: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      config: z.record(z.unknown()),
      position: z.object({ x: z.number(), y: z.number() }),
      timeoutMs: z.number().int().positive().optional(),
    })
  ),
  edges: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      target: z.string(),
      sourcePort: z.string().optional(),
    })
  ),
});

const Body = z.object({
  definition: DefSchema,
  defaultNodeTimeoutMs: z.number().int().positive().optional(),
  /** Optional — when present, only the ancestors of this node id are run. */
  targetNodeId: z.string().optional(),
  /**
   * Optional — fire the run as if THIS trigger node had triggered. Used by
   * the "Test this trigger" button so a multi-trigger flow can be tested
   * one entry-point at a time. For S3 triggers, the route actually polls
   * the bucket once to build a real payload (so the user gets to see
   * whether their creds + prefix actually find anything).
   */
  entryTriggerId: z.string().optional(),
});

/**
 * Streaming test-run endpoint. Returns NDJSON: one JSON object per line.
 *
 *   { type: "nodeStart", nodeId, nodeType }
 *   { type: "nodeEnd",   result: TestNodeResult }
 *   ...
 *   { type: "done",      result: TestRunResult }
 *
 * The client uses this to highlight the currently-processing node on the
 * canvas in real time. The non-streaming Server Action (testRunFlowAction)
 * still exists for callers that don't need live feedback.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  // Normalize so the entry-trigger lookup walks the canonical v2 shape.
  const fullDef = normalizeFlowDefinition(parsed.definition as FlowDefinition);

  // targetNodeId (Run-this-step) and entryTriggerId (Test-this-trigger) are
  // mutually-exclusive sub-modes. Validate up front so a bad request fails
  // before we open the stream.
  if (parsed.targetNodeId && !fullDef.nodes.find((n) => n.id === parsed.targetNodeId)) {
    return NextResponse.json({ error: "Target node is not in this flow." }, { status: 400 });
  }
  // When the caller picks a trigger explicitly we honor it; otherwise auto-
  // pick (prefer manual, else any trigger). This keeps the legacy main
  // "Test run" button working AND records a faithful trigger payload no
  // matter which entry point ended up firing.
  let entryTrigger: FlowNode | undefined;
  if (parsed.entryTriggerId) {
    entryTrigger = fullDef.nodes.find((n) => n.id === parsed.entryTriggerId);
    if (!entryTrigger) {
      return NextResponse.json({ error: "Trigger node not found." }, { status: 400 });
    }
    if (!isTriggerType(entryTrigger.type)) {
      return NextResponse.json({ error: "Selected node is not a trigger." }, { status: 400 });
    }
  } else if (!parsed.targetNodeId) {
    // Step-runs prune to ancestors; for those we keep the legacy "no entry"
    // behaviour (all roots reachable). For full test runs we pick one.
    entryTrigger = pickEntryTrigger(fullDef);
  }

  const def = parsed.targetNodeId
    ? pruneToAncestorsOf(fullDef, parsed.targetNodeId)
    : fullDef;

  const encoder = new TextEncoder();
  const userId = session.user.id;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };
      try {
        // When testing a specific trigger, build the matching payload — for
        // S3, that means actually polling the bucket once so the user sees
        // whether credentials / prefix / suffix find anything.
        let trigger: TriggerPayload | undefined;
        if (entryTrigger) {
          trigger = await buildTriggerPayload(entryTrigger, userId, send);
          if (!trigger) {
            // Tester already received an explanatory event; close cleanly.
            send({ type: "done", result: { status: "error", errorMessage: "Trigger test cancelled.", durationMs: 0, nodes: [] } });
            return;
          }
        }
        const finalResult = await testRunFlow({
          definition: def,
          userId,
          defaultNodeTimeoutMs: parsed.defaultNodeTimeoutMs,
          trigger,
          // Pass the resolved trigger id (explicit or auto-picked) so the
          // runner restricts execution to its downstream and records the
          // matching payload on the trigger's node-run row.
          entryTriggerId: entryTrigger?.id,
          onEvent: (event: TestRunEvent) => send(event),
        });
        send({ type: "done", result: finalResult });
      } catch (e) {
        send({ type: "fatal", message: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no", // disable proxy buffering so chunks flush immediately
    },
  });
}

/**
 * Synthesize the right TriggerPayload for a "Test this trigger" run.
 *
 *  - manual  → minimal `{ kind: "manual", startedBy: <user> }`
 *  - schedule → `{ kind: "schedule", firedAt: now }`
 *  - webhook  → empty body/headers/query so the flow sees a well-formed
 *               payload (`{{ $trigger.body }}` resolves to null cleanly)
 *  - s3       → REAL poll: list the bucket, take the newest matching object,
 *               generate a presigned GET url. Returns null and pushes a
 *               friendly `fatal` event when the credential is invalid or
 *               the bucket/prefix is empty (so the user actually learns
 *               whether their setup works).
 */
async function buildTriggerPayload(
  triggerNode: { id: string; type: string; config: Record<string, unknown> },
  userId: string,
  send: (obj: unknown) => void
): Promise<TriggerPayload | undefined> {
  if (triggerNode.type === "manual") {
    return { kind: "manual", startedBy: userId };
  }
  if (triggerNode.type === "schedule") {
    return { kind: "schedule", firedAt: new Date() };
  }
  if (triggerNode.type === "webhook") {
    return { kind: "webhook", body: null, headers: {}, query: {} };
  }
  if (triggerNode.type === "s3.objectCreated") {
    const cfg = triggerNode.config as {
      connectionId?: string;
      bucket?: string;
      prefix?: string;
      suffix?: string;
    };
    if (!cfg.connectionId || !cfg.bucket) {
      send({
        type: "fatal",
        message:
          "S3 trigger needs a credential and a bucket before it can be tested.",
      });
      return undefined;
    }
    try {
      const probe = await probeS3OnceForTest({
        connectionId: cfg.connectionId,
        bucket: cfg.bucket,
        prefix: cfg.prefix,
        suffix: cfg.suffix,
      });
      if (!probe) {
        send({
          type: "fatal",
          message:
            `No objects found in s3://${cfg.bucket}/${cfg.prefix ?? ""} (suffix=${cfg.suffix ?? "*"}). ` +
            "Drop a file in and try again, or double-check the prefix.",
        });
        return undefined;
      }
      return probe;
    } catch (e) {
      send({
        type: "fatal",
        message: `S3 poll failed: ${(e as Error).message}`,
      });
      return undefined;
    }
  }
  // Unknown trigger type — fall back to manual so the test at least runs.
  return { kind: "manual", startedBy: userId };
}
