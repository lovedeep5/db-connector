"use server";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { testRunFlow, type TestRunResult } from "@/server/services/flow-test-runner";
import { pruneToAncestorsOf } from "@/lib/flows/subflow";
import type { FlowDefinition } from "@/lib/flows/types";

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
  edges: z.array(z.object({ id: z.string(), source: z.string(), target: z.string(), sourcePort: z.string().optional() })),
});

const Body = z.object({
  definition: DefSchema,
  defaultNodeTimeoutMs: z.number().int().positive().optional(),
});

export async function testRunFlowAction(input: z.infer<typeof Body>): Promise<TestRunResult> {
  const user = await requireUser();
  const data = Body.parse(input);
  return testRunFlow({
    definition: data.definition as FlowDefinition,
    userId: user.id,
    defaultNodeTimeoutMs: data.defaultNodeTimeoutMs,
  });
}

const StepBody = Body.extend({ targetNodeId: z.string().min(1) });

/**
 * Test only the subgraph that ends at `targetNodeId` — i.e. the target and
 * every node that transitively feeds it. Lets users iterate on a single step
 * without re-running the whole flow.
 */
export async function testRunUpToNodeAction(input: z.infer<typeof StepBody>): Promise<TestRunResult> {
  const user = await requireUser();
  const data = StepBody.parse(input);
  const def = data.definition as FlowDefinition;
  if (!def.nodes.find((n) => n.id === data.targetNodeId)) {
    throw new Error("Target node is not in this flow.");
  }
  const pruned = pruneToAncestorsOf(def, data.targetNodeId);
  return testRunFlow({
    definition: pruned,
    userId: user.id,
    defaultNodeTimeoutMs: data.defaultNodeTimeoutMs,
  });
}
