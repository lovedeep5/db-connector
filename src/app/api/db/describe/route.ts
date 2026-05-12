import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { describeObject } from "@/server/services/db-access";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const connectionId = req.nextUrl.searchParams.get("connectionId");
  const schemaName = req.nextUrl.searchParams.get("schema");
  const name = req.nextUrl.searchParams.get("name");
  if (!connectionId || !schemaName || !name) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }
  try {
    const data = await describeObject({ userId: session.user.id }, connectionId, schemaName, name);
    return NextResponse.json({ data });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
