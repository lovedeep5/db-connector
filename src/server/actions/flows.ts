"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import cron from "node-cron";
import { db, schema } from "@/lib/db/client";
import { requireUser } from "@/lib/session";
import { loadEffectivePermissions } from "@/lib/rbac";
import { refreshOneFlow, unregisterFlow } from "@/lib/flows/scheduler-glue";
import { runFlow } from "@/server/services/flow-runner";
import type { FlowDefinition } from "@/lib/flows/types";

const TriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("schedule"), config: z.object({ cron: z.string().min(1) }) }),
  z.object({ type: z.literal("manual"), config: z.object({}).strict() }),
  z.object({ type: z.literal("webhook"), config: z.object({ method: z.enum(["GET", "POST"]).optional() }) }),
]);

const DefinitionSchema: z.ZodType<FlowDefinition> = z.object({
  version: z.literal(1),
  trigger: TriggerSchema,
  nodes: z.array(
    z.object({
      id: z.string().min(1),
      type: z.string().min(1),
      config: z.record(z.unknown()),
      position: z.object({ x: z.number(), y: z.number() }),
      timeoutMs: z.number().int().positive().optional(),
    })
  ),
  edges: z.array(
    z.object({
      id: z.string().min(1),
      source: z.string(),
      target: z.string(),
      sourcePort: z.string().optional(),
    })
  ),
});

const FlowInput = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional().nullable(),
  definition: DefinitionSchema,
  isActive: z.boolean().optional().default(true),
  visibility: z.enum(["private", "team", "everyone"]).default("private"),
  sharedWithTeamId: z.string().optional().nullable(),
  executionMode: z.enum(["sequential", "parallel"]).default("parallel"),
  maxConcurrentRuns: z.coerce.number().int().min(1).max(100).default(10),
  defaultNodeTimeoutMs: z.coerce.number().int().min(1_000).max(24 * 60 * 60 * 1000).default(60_000),
}).superRefine((v, ctx) => {
  if (v.definition.trigger.type === "schedule" && !cron.validate(v.definition.trigger.config.cron)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["definition", "trigger", "config", "cron"], message: "Invalid cron" });
  }
  if (v.visibility === "team" && !v.sharedWithTeamId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sharedWithTeamId"], message: "Pick a team" });
  }
});

export type FlowInput = z.infer<typeof FlowInput>;

async function loadFlowOrThrow(id: string, userId: string, isSuperAdmin: boolean) {
  const [row] = await db.select().from(schema.flows).where(eq(schema.flows.id, id));
  if (!row) throw new Error("Flow not found");
  if (row.userId !== userId && !isSuperAdmin) throw new Error("Only the owner can change this flow.");
  return row;
}

export async function createFlow(input: FlowInput): Promise<string> {
  const user = await requireUser();
  const data = FlowInput.parse(input);
  const sharedWithTeamId = data.visibility === "team" ? data.sharedWithTeamId ?? null : null;
  const webhookSecret = data.definition.trigger.type === "webhook" ? generateSecret() : null;
  const now = new Date();
  const [row] = await db
    .insert(schema.flows)
    .values({
      userId: user.id,
      name: data.name,
      description: data.description ?? null,
      definition: JSON.stringify(data.definition),
      isActive: data.isActive ?? true,
      visibility: data.visibility,
      sharedWithTeamId,
      executionMode: data.executionMode,
      maxConcurrentRuns: data.maxConcurrentRuns,
      defaultNodeTimeoutMs: data.defaultNodeTimeoutMs,
      webhookSecret,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  await refreshOneFlow(row.id);
  revalidatePath("/flows");
  return row.id;
}

export async function updateFlow(id: string, input: FlowInput): Promise<void> {
  const user = await requireUser();
  const existing = await loadFlowOrThrow(id, user.id, user.isSuperAdmin);
  const data = FlowInput.parse(input);
  const sharedWithTeamId = data.visibility === "team" ? data.sharedWithTeamId ?? null : null;
  // Generate a secret on first webhook trigger; reuse otherwise.
  let webhookSecret = existing.webhookSecret;
  if (data.definition.trigger.type === "webhook" && !webhookSecret) webhookSecret = generateSecret();
  if (data.definition.trigger.type !== "webhook") webhookSecret = null;
  await db
    .update(schema.flows)
    .set({
      name: data.name,
      description: data.description ?? null,
      definition: JSON.stringify(data.definition),
      isActive: data.isActive ?? true,
      visibility: data.visibility,
      sharedWithTeamId,
      executionMode: data.executionMode,
      maxConcurrentRuns: data.maxConcurrentRuns,
      defaultNodeTimeoutMs: data.defaultNodeTimeoutMs,
      webhookSecret,
      updatedAt: new Date(),
    })
    .where(eq(schema.flows.id, id));
  await refreshOneFlow(id);
  revalidatePath("/flows");
}

export async function setFlowActive(id: string, active: boolean): Promise<void> {
  const user = await requireUser();
  await loadFlowOrThrow(id, user.id, user.isSuperAdmin);
  await db.update(schema.flows).set({ isActive: active, updatedAt: new Date() }).where(eq(schema.flows.id, id));
  if (active) await refreshOneFlow(id);
  else unregisterFlow(id);
  revalidatePath("/flows");
}

export async function deleteFlow(id: string): Promise<void> {
  const user = await requireUser();
  await loadFlowOrThrow(id, user.id, user.isSuperAdmin);
  unregisterFlow(id);
  await db.delete(schema.flows).where(eq(schema.flows.id, id));
  revalidatePath("/flows");
}

export async function runFlowNow(id: string): Promise<{ runId: string; status: string }> {
  const user = await requireUser();
  await loadFlowOrThrow(id, user.id, user.isSuperAdmin);
  return runFlow({
    flowId: id,
    trigger: { kind: "manual", startedBy: user.id },
    startedBy: user.id,
  });
}

function generateSecret(): string {
  return randomBytes(24).toString("hex");
}

/**
 * Creates a pre-wired example flow so users can see a working Schedule →
 * Query → To File → Send Email pipeline. Defaults to manual trigger so the
 * user can immediately click "Run now" to test; the recipient is the current
 * user's email; if any of their connections is Postgres-compatible we use it,
 * otherwise we leave the connection picker empty so they fill it in.
 */
export async function createSampleFlow(): Promise<string> {
  const user = await requireUser();
  const perms = await loadEffectivePermissions(user.id);
  const allConns = await db
    .select({ id: schema.connections.id, type: schema.connections.type })
    .from(schema.connections);
  const visible = perms.isSuperAdmin ? allConns : allConns.filter((c) => perms.connections.has(c.id));
  const firstConn = visible.find((c) => c.type === "postgres") ?? visible[0];

  // Use a SQL flavour appropriate for the connection type we picked.
  const sqlFor: Record<string, string> = {
    postgres: "select now() as ts, 'sample row 1' as label\nunion all\nselect now(), 'sample row 2';",
    mysql: "select now() as ts, 'sample row 1' as label\nunion all\nselect now(), 'sample row 2';",
    oracle: "select sysdate as ts, 'sample row 1' as label from dual\nunion all\nselect sysdate, 'sample row 2' from dual",
    mongodb: '{ "collection": "users", "operation": "find", "limit": 5 }',
  };
  const statement = firstConn ? sqlFor[firstConn.type] ?? sqlFor.postgres : sqlFor.postgres;

  const QUERY_ID = "query_1";
  const FILE_ID = "to_file_1";
  const EMAIL_ID = "email_1";
  const TRIGGER_ID = "__trigger__";

  const definition: FlowDefinition = {
    version: 1,
    trigger: { type: "manual", config: {} as never },
    nodes: [
      {
        id: QUERY_ID,
        type: "db.query",
        position: { x: 280, y: 160 },
        config: { connectionId: firstConn?.id ?? "", statement },
      },
      {
        id: FILE_ID,
        type: "transform.toFile",
        position: { x: 540, y: 160 },
        config: { filename: "sample-report", format: "csv", rows: `{{ $node.${QUERY_ID}.rows }}` },
      },
      {
        id: EMAIL_ID,
        type: "email.send",
        position: { x: 800, y: 160 },
        config: {
          to: user.email ?? "you@example.com",
          subject: "Sample report from DBConnector",
          html:
            `<p>Hi ${user.name ?? "there"},</p>` +
            `<p>This is the sample workflow. The DB Query produced ` +
            `<strong>{{ $node.${QUERY_ID}.rowCount }}</strong> rows.</p>` +
            `<p>The CSV is attached. ✨</p>`,
          attachment: `{{ $node.${FILE_ID} }}`,
        },
      },
    ],
    edges: [
      { id: "e_trigger", source: TRIGGER_ID, target: QUERY_ID },
      { id: "e_q_to_f", source: QUERY_ID, target: FILE_ID },
      { id: "e_f_to_e", source: FILE_ID, target: EMAIL_ID },
    ],
  };

  const now = new Date();
  const [row] = await db
    .insert(schema.flows)
    .values({
      userId: user.id,
      name: "Sample · Daily CSV report by email",
      description:
        "Trigger → run a SQL query → turn rows into a CSV → email it. Test it with Run now, then edit each step.",
      definition: JSON.stringify(definition),
      isActive: false,
      visibility: "private",
      sharedWithTeamId: null,
      executionMode: "parallel",
      maxConcurrentRuns: 10,
      defaultNodeTimeoutMs: 60_000,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  await refreshOneFlow(row.id);
  revalidatePath("/flows");
  return row.id;
}

void and;
