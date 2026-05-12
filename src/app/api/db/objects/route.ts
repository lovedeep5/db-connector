import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { listObjects } from "@/server/services/db-access";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const connectionId = req.nextUrl.searchParams.get("connectionId");
  const schemaName = req.nextUrl.searchParams.get("schema");
  if (!connectionId || !schemaName) {
    return NextResponse.json({ error: "connectionId and schema required" }, { status: 400 });
  }
  try {
    const data = await listObjects({ userId: session.user.id }, connectionId, schemaName);
    return NextResponse.json({ data });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
