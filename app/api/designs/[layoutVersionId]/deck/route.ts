import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { loadDeckPayload } from "@/lib/design/deck-loader";

export async function GET(request: Request, context: { params: Promise<{ layoutVersionId: string }> }) {
  const user = await requireUser(request);
  if (!user) return NextResponse.json({ error: "Authentication is required.", code: "AUTH_REQUIRED" }, { status: 401 });
  const { layoutVersionId } = await context.params;
  const result = await loadDeckPayload(layoutVersionId, user.id);
  if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: result.status });
  return NextResponse.json(result.payload);
}
