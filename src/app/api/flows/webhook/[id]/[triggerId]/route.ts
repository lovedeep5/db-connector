import type { NextRequest } from "next/server";
import { handle } from "../route";

export const runtime = "nodejs";

/**
 * Per-trigger webhook entrypoint:
 *   /api/flows/webhook/<flowId>/<triggerNodeId>
 *
 * Delegates to the same handler as the legacy path but with the explicit
 * trigger id, so multi-webhook flows can publish distinct URLs (and
 * distinct secrets) per integration.
 */
type Ctx = { params: Promise<{ id: string; triggerId: string }> };
const make = (req: NextRequest, ctx: Ctx) =>
  ctx.params.then(({ id, triggerId }) => handle(req, id, triggerId));

export const POST = make;
export const GET = make;
export const PUT = make;
export const PATCH = make;
export const DELETE = make;
