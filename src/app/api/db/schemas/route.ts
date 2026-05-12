import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { listSchemas } from "@/server/services/db-access";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const connectionId = req.nextUrl.searchParams.get("connectionId");
  if (!connectionId) return NextResponse.json({ error: "connectionId required" }, { status: 400 });
  try {
    const data = await listSchemas({ userId: session.user.id }, connectionId);
    return NextResponse.json({ data });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
