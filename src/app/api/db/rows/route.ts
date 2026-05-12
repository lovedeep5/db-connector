import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import {
  deleteRow,
  fetchRows,
  insertRow,
  updateRow,
} from "@/server/services/db-access";

const FetchBody = z.object({
  connectionId: z.string(),
  schema: z.string(),
  name: z.string(),
  limit: z.number().int().min(1).max(10_000).optional(),
  offset: z.number().int().min(0).optional(),
});

const RowBody = z.object({
  connectionId: z.string(),
  schema: z.string(),
  name: z.string(),
  row: z.record(z.unknown()),
});

const UpdateBody = z.object({
  connectionId: z.string(),
  schema: z.string(),
  name: z.string(),
  where: z.record(z.unknown()),
  set: z.record(z.unknown()),
});

const DeleteBody = z.object({
  connectionId: z.string(),
  schema: z.string(),
  name: z.string(),
  where: z.record(z.unknown()),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const action = req.nextUrl.searchParams.get("action") ?? "fetch";
  try {
    const body = await req.json();
    switch (action) {
      case "fetch": {
        const p = FetchBody.parse(body);
        const data = await fetchRows({ userId: session.user.id }, p.connectionId, p.schema, p.name, {
          limit: p.limit, offset: p.offset,
        });
        return NextResponse.json({ data });
      }
      case "insert": {
        const p = RowBody.parse(body);
        const data = await insertRow({ userId: session.user.id }, p.connectionId, p.schema, p.name, p.row);
        return NextResponse.json({ data });
      }
      case "update": {
        const p = UpdateBody.parse(body);
        const data = await updateRow({ userId: session.user.id }, p.connectionId, p.schema, p.name, p.where, p.set);
        return NextResponse.json({ data });
      }
      case "delete": {
        const p = DeleteBody.parse(body);
        const data = await deleteRow({ userId: session.user.id }, p.connectionId, p.schema, p.name, p.where);
        return NextResponse.json({ data });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
