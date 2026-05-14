import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { testRunFlow, type TestRunEvent } from "@/server/services/flow-test-runner";
import { pruneToAncestorsOf } from "@/lib/flows/subflow";
import type { FlowDefinition } from "@/lib/flows/types";

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

  const fullDef = parsed.definition as FlowDefinition;
  const def = parsed.targetNodeId
    ? pruneToAncestorsOf(fullDef, parsed.targetNodeId)
    : fullDef;
  if (parsed.targetNodeId && !fullDef.nodes.find((n) => n.id === parsed.targetNodeId)) {
    return NextResponse.json({ error: "Target node is not in this flow." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const userId = session.user.id;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };
      try {
        const finalResult = await testRunFlow({
          definition: def,
          userId,
          defaultNodeTimeoutMs: parsed.defaultNodeTimeoutMs,
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
