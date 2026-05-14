/**
 * Registers every active flow's `schedule` trigger node(s) with the existing
 * node-cron scheduler. A flow can have any number of schedule triggers
 * (each its own cron); we keep one cron task per (flowId, triggerNodeId).
 *
 * Registry key is `${flowId}::${triggerNodeId}` so refreshes can replace
 * individual entries without affecting siblings.
 */
import cron, { type ScheduledTask } from "node-cron";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { runFlow, FlowConcurrencyError } from "@/server/services/flow-runner";
import { parseAndNormalize, triggerNodesOfType } from "./definition";

type Entry = { task: ScheduledTask; cron: string };

const g = globalThis as unknown as {
  __dbcFlowSchedules?: Map<string, Entry>;
  __dbcFlowSchedInit?: boolean;
};
const registry: Map<string, Entry> = (g.__dbcFlowSchedules ??= new Map());

const keyOf = (flowId: string, triggerNodeId: string) => `${flowId}::${triggerNodeId}`;

export async function ensureFlowSchedulesStarted(): Promise<void> {
  if (g.__dbcFlowSchedInit) return;
  g.__dbcFlowSchedInit = true;
  await refreshAllFlows();
  // eslint-disable-next-line no-console
  console.log(`[flows] started with ${registry.size} active schedule triggers`);
}

export async function refreshAllFlows(): Promise<void> {
  const flows = await db.select().from(schema.flows);
  const seenKeys = new Set<string>();
  for (const f of flows) {
    if (!f.isActive) {
      unregisterFlow(f.id);
      continue;
    }
    for (const key of registerScheduleTriggers(f.id, f.definition)) seenKeys.add(key);
  }
  for (const key of [...registry.keys()]) if (!seenKeys.has(key)) stopEntry(key);
}

export async function refreshOneFlow(flowId: string): Promise<void> {
  const [row] = await db.select().from(schema.flows).where(eq(schema.flows.id, flowId));
  if (!row || !row.isActive) {
    unregisterFlow(flowId);
    return;
  }
  const seen = registerScheduleTriggers(flowId, row.definition);
  // Stop any orphan entries that previously existed for this flow but were removed.
  for (const key of [...registry.keys()]) {
    if (key.startsWith(`${flowId}::`) && !seen.has(key)) stopEntry(key);
  }
}

/** Stop every cron entry belonging to a flow. Called on delete / deactivate. */
export function unregisterFlow(flowId: string): void {
  for (const key of [...registry.keys()]) {
    if (key.startsWith(`${flowId}::`)) stopEntry(key);
  }
}

function stopEntry(key: string) {
  const e = registry.get(key);
  if (!e) return;
  e.task.stop();
  registry.delete(key);
}

/**
 * Walks every schedule-type trigger node in the flow and ensures a cron
 * task is registered for it. Returns the set of registry keys it touched
 * so the caller can prune orphans.
 */
function registerScheduleTriggers(flowId: string, definitionRaw: string): Set<string> {
  const seen = new Set<string>();
  let def;
  try { def = parseAndNormalize(definitionRaw); } catch { return seen; }
  for (const tn of triggerNodesOfType(def, "schedule")) {
    const cronExpr = (tn.config as { cron?: unknown }).cron;
    if (typeof cronExpr !== "string" || !cron.validate(cronExpr)) continue;
    const key = keyOf(flowId, tn.id);
    seen.add(key);
    const existing = registry.get(key);
    if (existing && existing.cron === cronExpr) continue;
    if (existing) {
      existing.task.stop();
      registry.delete(key);
    }
    const task = cron.schedule(cronExpr, async () => {
      try {
        await runFlow({
          flowId,
          trigger: { kind: "schedule", firedAt: new Date() },
          entryTriggerId: tn.id,
        });
      } catch (e) {
        if (e instanceof FlowConcurrencyError) return;
        // eslint-disable-next-line no-console
        console.error(`[flows] run failed ${flowId} trigger=${tn.id}:`, (e as Error).message);
      }
    }, { scheduled: true });
    registry.set(key, { task, cron: cronExpr });
  }
  return seen;
}
