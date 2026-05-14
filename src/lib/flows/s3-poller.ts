/**
 * Polls every S3-triggered flow at the per-trigger interval. With v2 multi-
 * trigger flows a single flow can have any number of S3 trigger nodes, each
 * pointing at a different bucket/prefix; we keep one timer per
 * (flowId, triggerNodeId).
 *
 * State per trigger lives in `flows.trigger_state` (JSON text), keyed by
 * trigger node id:
 *   {
 *     "<triggerNodeId>": {
 *       lastModifiedISO: "2026-05-13T18:00:00.000Z",
 *       recentKeys: ["uploads/a.csv", ...]   // ring buffer, max 200
 *     },
 *     ...
 *   }
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
import type { FlowNode } from "./types";
import { parseAndNormalize, triggerNodesOfType } from "./definition";
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
type AllTriggerState = Record<string, TriggerState>;

type S3TriggerConfig = {
  connectionId: string;
  bucket: string;
  prefix?: string;
  suffix?: string;
  pollIntervalSec: number;
  mode: "skipExisting" | "processAll";
  maxBatch: number;
};

const g = globalThis as unknown as {
  __dbcS3Pollers?: Map<string, Entry>;
  __dbcS3PollerInit?: boolean;
};
const registry: Map<string, Entry> = (g.__dbcS3Pollers ??= new Map());

const keyOf = (flowId: string, triggerNodeId: string) => `${flowId}::${triggerNodeId}`;

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
    if (!f.isActive) {
      unregisterTrigger(f.id);
      continue;
    }
    for (const key of registerS3Triggers(f.id, f.definition)) seen.add(key);
  }
  for (const key of [...registry.keys()]) if (!seen.has(key)) stopEntry(key);
}

export async function refreshOneS3Trigger(flowId: string): Promise<void> {
  const [row] = await db.select().from(schema.flows).where(eq(schema.flows.id, flowId));
  if (!row || !row.isActive) {
    unregisterTrigger(flowId);
    return;
  }
  const seen = registerS3Triggers(flowId, row.definition);
  for (const key of [...registry.keys()]) {
    if (key.startsWith(`${flowId}::`) && !seen.has(key)) stopEntry(key);
  }
}

export function unregisterTrigger(flowId: string): void {
  for (const key of [...registry.keys()]) {
    if (key.startsWith(`${flowId}::`)) stopEntry(key);
  }
}

function stopEntry(key: string) {
  const e = registry.get(key);
  if (!e) return;
  clearInterval(e.timer);
  registry.delete(key);
}

function registerS3Triggers(flowId: string, definitionRaw: string): Set<string> {
  const seen = new Set<string>();
  let def;
  try { def = parseAndNormalize(definitionRaw); } catch { return seen; }
  for (const tn of triggerNodesOfType(def, "s3.objectCreated")) {
    const cfg = tn.config as Partial<S3TriggerConfig>;
    if (!cfg.connectionId || !cfg.bucket) continue;
    const intervalSec = clampInterval(cfg.pollIntervalSec);
    const configHash = JSON.stringify({
      cid: cfg.connectionId,
      b: cfg.bucket,
      p: cfg.prefix ?? "",
      s: cfg.suffix ?? "",
      i: intervalSec,
      m: cfg.mode,
      mb: cfg.maxBatch,
    });
    const key = keyOf(flowId, tn.id);
    seen.add(key);
    const existing = registry.get(key);
    if (existing && existing.configHash === configHash) continue;
    if (existing) {
      clearInterval(existing.timer);
      registry.delete(key);
    }
    const timer = setInterval(() => {
      pollOnce(flowId, tn).catch((e) => {
        // eslint-disable-next-line no-console
        console.error(`[s3-trigger] poll error ${flowId}/${tn.id}:`, (e as Error).message);
      });
    }, intervalSec * 1000);
    timer.unref?.();
    registry.set(key, { timer, intervalSec, configHash });
  }
  return seen;
}

function clampInterval(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 60;
  return Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Math.floor(v)));
}

async function pollOnce(flowId: string, triggerNode: FlowNode): Promise<void> {
  const cfg = triggerNode.config as S3TriggerConfig;
  const [conn] = await db
    .select()
    .from(schema.connections)
    .where(eq(schema.connections.id, cfg.connectionId));
  if (!conn || conn.type !== "s3") return;
  const creds = decryptJSON<S3Config>(conn.encryptedConfig);

  const [row] = await db.select().from(schema.flows).where(eq(schema.flows.id, flowId));
  if (!row || !row.isActive) return;
  const allState: AllTriggerState = row.triggerState ? safeParse(row.triggerState) : {};
  const state: TriggerState = allState[triggerNode.id] ?? {};

  const client = makeClient(creds);
  if (!state.lastModifiedISO && cfg.mode === "skipExisting") {
    await saveState(flowId, allState, triggerNode.id, {
      lastModifiedISO: new Date().toISOString(),
      recentKeys: [],
    });
    return;
  }
  const watermark = state.lastModifiedISO ? new Date(state.lastModifiedISO) : null;
  const recent = new Set(state.recentKeys ?? []);

  const newObjects = await listNew(client, cfg.bucket, cfg.prefix, cfg.suffix, watermark);
  if (newObjects.length === 0) return;

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
        entryTriggerId: triggerNode.id,
      });
    } catch (e) {
      if (e instanceof FlowConcurrencyError) continue;
      // eslint-disable-next-line no-console
      console.error(`[s3-trigger] run failed ${flowId}/${triggerNode.id} key=${obj.Key}:`, (e as Error).message);
    }
    if (!newWatermark || obj.LastModified > newWatermark) newWatermark = obj.LastModified;
  }

  const merged = [...(state.recentKeys ?? []), ...seen];
  const trimmed = merged.length > RECENT_KEYS_MAX ? merged.slice(-RECENT_KEYS_MAX) : merged;
  await saveState(flowId, allState, triggerNode.id, {
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
  out.sort((a, b) => (a.LastModified?.getTime() ?? 0) - (b.LastModified?.getTime() ?? 0));
  return out;
}

function makeClient(creds: S3Config): S3Client {
  return new S3Client({
    region: creds.region,
    credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey },
    endpoint: creds.endpoint || undefined,
    forcePathStyle: !!creds.endpoint,
  });
}

async function saveState(
  flowId: string,
  allState: AllTriggerState,
  triggerNodeId: string,
  next: TriggerState
): Promise<void> {
  allState[triggerNodeId] = next;
  await db
    .update(schema.flows)
    .set({ triggerState: JSON.stringify(allState) })
    .where(eq(schema.flows.id, flowId));
}

function safeParse(raw: string): AllTriggerState {
  try {
    const v = JSON.parse(raw);
    // Legacy single-trigger shape: { lastModifiedISO, recentKeys }. With
    // multi-trigger we expect a map. Migrate by stuffing the legacy state
    // under the synthetic "__trigger__" id so it survives the migration.
    if (v && typeof v === "object" && ("lastModifiedISO" in v || "recentKeys" in v)) {
      return { __trigger__: v as TriggerState };
    }
    return v as AllTriggerState;
  } catch {
    return {};
  }
}
