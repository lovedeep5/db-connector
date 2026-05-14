import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { db, schema } from "@/lib/db/client";
import { runFlow, FlowConcurrencyError } from "@/server/services/flow-runner";
import { parseAndNormalize, triggerNodesOfType } from "@/lib/flows/definition";

export const runtime = "nodejs";

/**
 * Webhook entry point.
 *
 *   POST/GET/PUT/PATCH/DELETE /api/flows/webhook/:id
 *
 * The legacy single-trigger route. Finds the (single) webhook trigger node
 * in the flow's definition and fires it. For multi-trigger flows where the
 * trigger node id is known (e.g. copied from the editor), the client should
 * use the explicit path `/api/flows/webhook/:id/:triggerId` instead — handled
 * by the sibling `[triggerId]/route.ts`.
 *
 * Auth: when the trigger's `secret` is configured, requests MUST send it
 * in the `X-Webhook-Secret` header (timing-safe compared). With no secret,
 * the endpoint is open — useful for quick demos, but anyone with the URL
 * can fire the flow.
 */
async function handle(
  req: NextRequest,
  flowId: string,
  triggerNodeId?: string
) {
  const [row] = await db.select().from(schema.flows).where(eq(schema.flows.id, flowId));
  if (!row || !row.isActive) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const def = parseAndNormalize(row.definition);
  const webhookTriggers = triggerNodesOfType(def, "webhook");
  if (webhookTriggers.length === 0) {
    return NextResponse.json({ error: "Webhook trigger not configured" }, { status: 400 });
  }

  // Pick the trigger: explicit id wins; otherwise fall back to the only one
  // (or 400 if ambiguous and the URL didn't disambiguate).
  let trigger;
  if (triggerNodeId) {
    trigger = webhookTriggers.find((t) => t.id === triggerNodeId);
    if (!trigger) {
      return NextResponse.json({ error: "Trigger node not found" }, { status: 404 });
    }
  } else if (webhookTriggers.length === 1) {
    trigger = webhookTriggers[0];
  } else {
    return NextResponse.json({
      error: "Flow has multiple webhook triggers. Use /api/flows/webhook/<flowId>/<triggerNodeId> to pick one.",
    }, { status: 400 });
  }

  const cfg = trigger.config as { method?: string; secret?: string };

  // Method gate. Default to POST when unspecified.
  const allowedMethod = (cfg.method ?? "POST").toUpperCase();
  if (req.method.toUpperCase() !== allowedMethod) {
    return NextResponse.json({ error: `Use ${allowedMethod}` }, { status: 405 });
  }

  // Header auth when a secret is configured. No query-string fallback —
  // query strings end up in server logs.
  if (cfg.secret) {
    const provided = req.headers.get("x-webhook-secret") ?? "";
    if (!safeEq(provided, cfg.secret)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const url = req.nextUrl;
  const queryParams: Record<string, string> = {};
  url.searchParams.forEach((v, k) => (queryParams[k] = v));
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => (headers[k] = v));

  const rawBody = await req.text();
  let body: unknown = null;
  if (rawBody) {
    const ct = (headers["content-type"] ?? "").toLowerCase();
    if (ct.includes("application/json")) {
      try { body = JSON.parse(rawBody); } catch { body = rawBody; }
    } else {
      body = rawBody;
    }
  }

  try {
    const run = await runFlow({
      flowId,
      trigger: { kind: "webhook", body, headers, query: queryParams },
      entryTriggerId: trigger.id,
    });
    return NextResponse.json({ ok: true, runId: run.runId, status: run.status });
  } catch (e) {
    if (e instanceof FlowConcurrencyError) {
      return NextResponse.json({ ok: false, skipped: true, reason: e.message }, { status: 429 });
    }
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

type Ctx = { params: Promise<{ id: string }> };
const make = (h: (req: NextRequest, id: string) => Promise<Response>) =>
  async function (req: NextRequest, ctx: Ctx) {
    const { id } = await ctx.params;
    return h(req, id);
  };

export const POST = make((req, id) => handle(req, id));
export const GET = make((req, id) => handle(req, id));
export const PUT = make((req, id) => handle(req, id));
export const PATCH = make((req, id) => handle(req, id));
export const DELETE = make((req, id) => handle(req, id));

/** Re-export so the per-trigger handler at `[triggerId]/route.ts` can delegate. */
export { handle };
