/**
 * Polls S3-triggered flows on a per-trigger interval. Mirrors the
 * scheduler-glue pattern that drives cron-based Schedule triggers — same
 * single-pod limitation, same Map of active timers, same idempotent
 * refresh-on-save flow.
 *
 * State per trigger lives in `flows.trigger_state` (JSON text):
 *   {
 *     lastModifiedISO: "2026-05-13T18:00:00.000Z",
 *     recentKeys: ["uploads/a.csv", "uploads/b.csv"]   // ring buffer, max 200
 *   }
 *
 * The watermark is the latest `LastModified` we've fired for. On each poll
 * we list objects, keep those strictly newer than the watermark (with a 30s
 * grace window for clock skew), dedupe via `recentKeys`, and fire the flow
 * per new object. `recentKeys` exists because two objects can land in the
 * same second — without it we'd re-fire whichever one came in second on the
 * next poll.
 */
import { eq } from "drizzle-orm";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  type _Object as S3Object,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { db, schema } from "@/lib/db/client";
import { decryptJSON } from "@/lib/crypto";
import { runFlow, FlowConcurrencyError } from "@/server/services/flow-runner";
import type { FlowDefinition, TriggerSpec } from "./types";
import type { S3Config } from "@/lib/drivers/types";

type Entry = {
  timer: NodeJS.Timeout;
  intervalSec: number;
  configHash: string;
};

const RECENT_KEYS_MAX = 200;
const GRACE_MS = 30_000;
const MIN_INTERVAL = 30;
const MAX_INTERVAL = 1800;

type TriggerState = {
  lastModifiedISO?: string;
  recentKeys?: string[];
};

const g = globalThis as unknown as {
  __dbcS3Pollers?: Map<string, Entry>;
  __dbcS3PollerInit?: boolean;
};
const registry: Map<string, Entry> = (g.__dbcS3Pollers ??= new Map());

export async function ensureS3PollersStarted(): Promise<void> {
  if (g.__dbcS3PollerInit) return;
  g.__dbcS3PollerInit = true;
  await refreshAllS3Triggers();
  // eslint-disable-next-line no-console
  console.log(`[s3-trigger] started with ${registry.size} active pollers`);
}

export async function refreshAllS3Triggers(): Promise<void> {
  const flows = await db.select().from(schema.flows);
  const seen = new Set<string>();
  for (const f of flows) {
    seen.add(f.id);
    if (f.isActive) registerTrigger(f.id, f.definition);
    else unregisterTrigger(f.id);
  }
  for (const id of [...registry.keys()]) if (!seen.has(id)) unregisterTrigger(id);
}

export async function refreshOneS3Trigger(flowId: string): Promise<void> {
  const [row] = await db.select().from(schema.flows).where(eq(schema.flows.id, flowId));
  if (!row || !row.isActive) {
    unregisterTrigger(flowId);
    return;
  }
  registerTrigger(flowId, row.definition);
}

export function unregisterTrigger(flowId: string): void {
  const e = registry.get(flowId);
  if (!e) return;
  clearInterval(e.timer);
  registry.delete(flowId);
}

function registerTrigger(flowId: string, definitionRaw: string): void {
  let def: FlowDefinition;
  try { def = JSON.parse(definitionRaw) as FlowDefinition; } catch { return; }
  if (def.trigger?.type !== "s3.objectCreated") {
    unregisterTrigger(flowId);
    return;
  }
  const cfg = def.trigger.config;
  if (!cfg.connectionId || !cfg.bucket) {
    unregisterTrigger(flowId);
    return;
  }
  const intervalSec = clampInterval(cfg.pollIntervalSec);
  // Include enough config in the hash that meaningful edits force a restart
  // (so the next tick uses the new prefix/suffix/etc.) but harmless field
  // tweaks don't.
  const configHash = JSON.stringify({
    cid: cfg.connectionId,
    b: cfg.bucket,
    p: cfg.prefix ?? "",
    s: cfg.suffix ?? "",
    i: intervalSec,
    m: cfg.mode,
    mb: cfg.maxBatch,
  });
  const existing = registry.get(flowId);
  if (existing && existing.configHash === configHash) return;
  if (existing) {
    clearInterval(existing.timer);
    registry.delete(flowId);
  }
  const timer = setInterval(() => {
    pollOnce(flowId, def.trigger as Extract<TriggerSpec, { type: "s3.objectCreated" }>).catch((e) => {
      // eslint-disable-next-line no-console
      console.error(`[s3-trigger] poll error ${flowId}:`, (e as Error).message);
    });
  }, intervalSec * 1000);
  // Don't keep the Node process alive just for pollers (matters in scripts).
  timer.unref?.();
  registry.set(flowId, { timer, intervalSec, configHash });
}

function clampInterval(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 60;
  return Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Math.floor(v)));
}

async function pollOnce(
  flowId: string,
  trigger: Extract<TriggerSpec, { type: "s3.objectCreated" }>
): Promise<void> {
  const cfg = trigger.config;
  // Load the S3 credential. Bail quietly if it was deleted under our feet —
  // the trigger UI surfaces the missing connection separately.
  const [conn] = await db
    .select()
    .from(schema.connections)
    .where(eq(schema.connections.id, cfg.connectionId));
  if (!conn || conn.type !== "s3") return;
  const creds = decryptJSON<S3Config>(conn.encryptedConfig);

  // Load current state from the flow row each poll — keeps multi-tab edits
  // honest and lets the user reset state by clearing the column.
  const [row] = await db.select().from(schema.flows).where(eq(schema.flows.id, flowId));
  if (!row || !row.isActive) return;
  const state: TriggerState = row.triggerState ? safeParse(row.triggerState) : {};

  const client = makeClient(creds);
  // First poll for `skipExisting` flows establishes the watermark to "now"
  // without firing — old objects are intentionally ignored.
  if (!state.lastModifiedISO && cfg.mode === "skipExisting") {
    await saveState(flowId, { lastModifiedISO: new Date().toISOString(), recentKeys: [] });
    return;
  }
  const watermark = state.lastModifiedISO ? new Date(state.lastModifiedISO) : null;
  const recent = new Set(state.recentKeys ?? []);

  const newObjects = await listNew(client, cfg.bucket, cfg.prefix, cfg.suffix, watermark);
  if (newObjects.length === 0) return;

  // Cap per-poll fan-out so a burst of uploads doesn't queue up thousands
  // of flow runs simultaneously. The remainder gets picked up next tick.
  const batch = newObjects.slice(0, Math.max(1, cfg.maxBatch ?? 50));

  let newWatermark = watermark;
  const seen: string[] = [];

  for (const obj of batch) {
    if (!obj.Key || !obj.LastModified) continue;
    if (recent.has(obj.Key)) continue;
    seen.push(obj.Key);
    try {
      const presignedUrl = await getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: cfg.bucket, Key: obj.Key }),
        { expiresIn: 15 * 60 }
      );
      await runFlow({
        flowId,
        trigger: {
          kind: "s3",
          bucket: cfg.bucket,
          key: obj.Key,
          size: obj.Size ?? 0,
          lastModified: obj.LastModified.toISOString(),
          etag: (obj.ETag ?? "").replace(/"/g, ""),
          presignedUrl,
        },
      });
    } catch (e) {
      if (e instanceof FlowConcurrencyError) {
        // Skipped by concurrency cap — leave the key out of `recent` so we
        // retry it next poll. Don't advance the watermark past it.
        continue;
      }
      // eslint-disable-next-line no-console
      console.error(`[s3-trigger] run failed ${flowId} key=${obj.Key}:`, (e as Error).message);
    }
    if (!newWatermark || obj.LastModified > newWatermark) newWatermark = obj.LastModified;
  }

  // Trim recentKeys to a ring buffer so this column doesn't grow unbounded.
  const merged = [...(state.recentKeys ?? []), ...seen];
  const trimmed = merged.length > RECENT_KEYS_MAX ? merged.slice(-RECENT_KEYS_MAX) : merged;
  await saveState(flowId, {
    lastModifiedISO: newWatermark?.toISOString() ?? state.lastModifiedISO,
    recentKeys: trimmed,
  });
}

async function listNew(
  client: S3Client,
  bucket: string,
  prefix: string | undefined,
  suffix: string | undefined,
  watermark: Date | null
): Promise<S3Object[]> {
  // S3 LIST has no LastModified filter — we paginate and client-side filter.
  // For most "new uploads" prefixes (date-partitioned, dropbox-style) the
  // first page is enough; if not, the loop walks the rest until exhausted.
  const out: S3Object[] = [];
  const cutoff = watermark ? new Date(watermark.getTime() - GRACE_MS) : null;
  let token: string | undefined;
  for (let page = 0; page < 50; page++) {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix || undefined,
        ContinuationToken: token,
      })
    );
    for (const o of res.Contents ?? []) {
      if (!o.Key || !o.LastModified) continue;
      if (suffix && !o.Key.endsWith(suffix)) continue;
      if (cutoff && o.LastModified <= cutoff) continue;
      out.push(o);
    }
    if (!res.IsTruncated) break;
    token = res.NextContinuationToken;
  }
  // Oldest-first so per-iteration watermark advances correctly.
  out.sort((a, b) => (a.LastModified?.getTime() ?? 0) - (b.LastModified?.getTime() ?? 0));
  return out;
}

function makeClient(creds: S3Config): S3Client {
  return new S3Client({
    region: creds.region,
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
    },
    endpoint: creds.endpoint || undefined,
    forcePathStyle: !!creds.endpoint, // MinIO / R2 etc. usually need path-style
  });
}

async function saveState(flowId: string, state: TriggerState): Promise<void> {
  await db
    .update(schema.flows)
    .set({ triggerState: JSON.stringify(state) })
    .where(eq(schema.flows.id, flowId));
}

function safeParse(raw: string): TriggerState {
  try { return JSON.parse(raw) as TriggerState; } catch { return {}; }
}
