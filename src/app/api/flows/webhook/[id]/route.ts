import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db, schema } from "@/lib/db/client";
import { runFlow, FlowConcurrencyError } from "@/server/services/flow-runner";

export const runtime = "nodejs";

/**
 * POST/GET /api/flows/webhook/:id
 *
 * Optional HMAC verification: send an `X-DBConnector-Signature` header with
 * `sha256=<hex>` where the hex is HMAC-SHA256(rawBody, flow.webhookSecret).
 * If the header is absent we still require the URL secret match — that is,
 * the path id is the public flow id but we expect the secret in a query
 * parameter `?secret=<webhookSecret>`. Easy first-class auth; for stronger
 * trust use the HMAC header.
 */
async function handle(req: NextRequest, id: string) {
  const [row] = await db.select().from(schema.flows).where(eq(schema.flows.id, id));
  if (!row || !row.isActive) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!row.webhookSecret) return NextResponse.json({ error: "Webhook not enabled" }, { status: 400 });

  const url = req.nextUrl;
  const queryParams: Record<string, string> = {};
  url.searchParams.forEach((v, k) => (queryParams[k] = v));

  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => (headers[k] = v));

  const rawBody = await req.text();
  const signature = req.headers.get("x-dbconnector-signature");
  const querySecret = queryParams.secret;
  if (!verifyAuth(row.webhookSecret, signature, querySecret, rawBody)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
      flowId: id,
      trigger: { kind: "webhook", body, headers, query: queryParams },
    });
    return NextResponse.json({ ok: true, runId: run.runId, status: run.status });
  } catch (e) {
    if (e instanceof FlowConcurrencyError) {
      return NextResponse.json({ ok: false, skipped: true, reason: e.message }, { status: 429 });
    }
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

function verifyAuth(
  secret: string,
  signatureHeader: string | null,
  querySecret: string | undefined,
  rawBody: string
): boolean {
  if (querySecret && safeEq(querySecret, secret)) return true;
  if (signatureHeader && signatureHeader.startsWith("sha256=")) {
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    return safeEq(signatureHeader.slice("sha256=".length), expected);
  }
  return false;
}

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(req, id);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(req, id);
}
