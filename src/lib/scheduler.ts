import cron, { type ScheduledTask } from "node-cron";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { runSchedule } from "@/server/services/schedule-runner";

/**
 * In-process cron registry. Stores a `node-cron` task per active schedule.
 * Re-registration is idempotent: replacing an entry stops the old task.
 *
 * v1 design: single pod, SQLite, no catch-up on missed firings. When the
 * metadata DB moves to Postgres we will swap this for a job queue
 * (pg-boss) that handles distributed locking and durability.
 */

type RegistryEntry = { task: ScheduledTask; cronExpression: string; running: boolean };

const g = globalThis as unknown as { __dbcScheduler?: Map<string, RegistryEntry>; __dbcSchedulerInit?: boolean };
const registry: Map<string, RegistryEntry> = (g.__dbcScheduler ??= new Map());

export function isValidCron(expr: string): boolean {
  return cron.validate(expr);
}

export async function ensureSchedulerStarted(): Promise<void> {
  if (g.__dbcSchedulerInit) return;
  g.__dbcSchedulerInit = true;
  await refreshAllSchedules();
  // eslint-disable-next-line no-console
  console.log(`[scheduler] started with ${registry.size} active schedules`);
  // Same boot path also starts the flow schedules.
  try {
    const { ensureFlowSchedulesStarted } = await import("@/lib/flows/scheduler-glue");
    await ensureFlowSchedulesStarted();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[flows] failed to start schedules:", e);
  }
  // And the S3 pollers — same single-pod lifecycle as cron, parallel ticker.
  try {
    const { ensureS3PollersStarted } = await import("@/lib/flows/s3-poller");
    await ensureS3PollersStarted();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[s3-trigger] failed to start pollers:", e);
  }
}

export async function refreshAllSchedules(): Promise<void> {
  const rows = await db.select().from(schema.schedules);
  const seen = new Set<string>();
  for (const row of rows) {
    seen.add(row.id);
    if (row.isActive) {
      register(row.id, row.cronExpression);
    } else {
      unregister(row.id);
    }
  }
  for (const id of [...registry.keys()]) {
    if (!seen.has(id)) unregister(id);
  }
}

/**
 * Add or replace a schedule's cron task. Safe to call repeatedly.
 */
export function register(scheduleId: string, cronExpression: string): void {
  const existing = registry.get(scheduleId);
  if (existing) {
    if (existing.cronExpression === cronExpression) return;
    existing.task.stop();
    registry.delete(scheduleId);
  }
  if (!cron.validate(cronExpression)) {
    // eslint-disable-next-line no-console
    console.warn(`[scheduler] invalid cron for ${scheduleId}: ${cronExpression}`);
    return;
  }
  const entry: RegistryEntry = {
    cronExpression,
    running: false,
    task: cron.schedule(
      cronExpression,
      async () => {
        if (entry.running) {
          // Previous run is still in flight — skip rather than overlap.
          await db.insert(schema.scheduleRuns).values({
            scheduleId,
            ranAt: new Date(),
            status: "skipped",
            durationMs: 0,
            errorMessage: "Previous run still in progress",
          });
          return;
        }
        entry.running = true;
        try {
          await runSchedule(scheduleId, { trigger: "cron" });
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error(`[scheduler] run failed for ${scheduleId}`, e);
        } finally {
          entry.running = false;
        }
      },
      { scheduled: true }
    ),
  };
  registry.set(scheduleId, entry);
}

export function unregister(scheduleId: string): void {
  const entry = registry.get(scheduleId);
  if (!entry) return;
  entry.task.stop();
  registry.delete(scheduleId);
}

export async function refreshOne(scheduleId: string): Promise<void> {
  const [row] = await db.select().from(schema.schedules).where(eq(schema.schedules.id, scheduleId));
  if (!row || !row.isActive) {
    unregister(scheduleId);
    return;
  }
  register(row.id, row.cronExpression);
}

export function listRegistered(): { scheduleId: string; cronExpression: string }[] {
  return [...registry.entries()].map(([scheduleId, e]) => ({
    scheduleId,
    cronExpression: e.cronExpression,
  }));
}
