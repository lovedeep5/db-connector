/**
 * Registers an active flow's `schedule` trigger with the existing node-cron
 * scheduler. The same cron infrastructure that runs scheduled reports also
 * runs scheduled flows; they just point at different runners.
 */
import cron, { type ScheduledTask } from "node-cron";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { runFlow, FlowConcurrencyError } from "@/server/services/flow-runner";
import type { FlowDefinition } from "./types";

type Entry = { task: ScheduledTask; cron: string };

const g = globalThis as unknown as {
  __dbcFlowSchedules?: Map<string, Entry>;
  __dbcFlowSchedInit?: boolean;
};
const registry: Map<string, Entry> = (g.__dbcFlowSchedules ??= new Map());

export async function ensureFlowSchedulesStarted(): Promise<void> {
  if (g.__dbcFlowSchedInit) return;
  g.__dbcFlowSchedInit = true;
  await refreshAllFlows();
  // eslint-disable-next-line no-console
  console.log(`[flows] started with ${registry.size} active schedules`);
}

export async function refreshAllFlows(): Promise<void> {
  const flows = await db.select().from(schema.flows);
  const seen = new Set<string>();
  for (const f of flows) {
    seen.add(f.id);
    if (f.isActive) registerFlow(f.id, f.definition);
    else unregisterFlow(f.id);
  }
  for (const id of [...registry.keys()]) if (!seen.has(id)) unregisterFlow(id);
}

export async function refreshOneFlow(flowId: string): Promise<void> {
  const [row] = await db.select().from(schema.flows).where(eq(schema.flows.id, flowId));
  if (!row || !row.isActive) {
    unregisterFlow(flowId);
    return;
  }
  registerFlow(flowId, row.definition);
}

export function unregisterFlow(flowId: string): void {
  const e = registry.get(flowId);
  if (!e) return;
  e.task.stop();
  registry.delete(flowId);
}

function registerFlow(flowId: string, definitionRaw: string): void {
  let def: FlowDefinition;
  try { def = JSON.parse(definitionRaw) as FlowDefinition; } catch { return; }
  if (def.trigger?.type !== "schedule") {
    unregisterFlow(flowId);
    return;
  }
  const cronExpr = def.trigger.config.cron;
  if (!cron.validate(cronExpr)) return;

  const existing = registry.get(flowId);
  if (existing) {
    if (existing.cron === cronExpr) return;
    existing.task.stop();
    registry.delete(flowId);
  }

  const task = cron.schedule(cronExpr, async () => {
    try {
      await runFlow({ flowId, trigger: { kind: "schedule", firedAt: new Date() } });
    } catch (e) {
      if (e instanceof FlowConcurrencyError) return; // expected, recorded as skipped
      // eslint-disable-next-line no-console
      console.error(`[flows] run failed ${flowId}:`, (e as Error).message);
    }
  }, { scheduled: true });

  registry.set(flowId, { task, cron: cronExpr });
}
