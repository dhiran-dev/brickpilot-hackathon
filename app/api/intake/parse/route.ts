import { NextResponse } from "next/server";

import { parseNaturalLanguageIntake } from "@/lib/ai/intake";
import { BUILDING_FIXTURES } from "@/lib/building/fixtures";
import { requireUser } from "@/lib/auth";

export async function POST(request: Request) {
  const user = await requireUser(request);
  if (!user) return NextResponse.json({ error: "Authentication is required.", code: "AUTH_REQUIRED" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON.", code: "INVALID_JSON" }, { status: 400 });
  }

  const sentence = body && typeof body === "object" && "sentence" in body ? (body as { sentence: unknown }).sentence : undefined;
  if (typeof sentence !== "string" || sentence.trim().length < 8) {
    return NextResponse.json({ error: "Describe the home in a sentence of at least a few words.", code: "SENTENCE_TOO_SHORT" }, { status: 400 });
  }
  if (sentence.length > 1_000) {
    return NextResponse.json({ error: "Keep the home description under 1,000 characters.", code: "SENTENCE_TOO_LONG" }, { status: 400 });
  }

  const result = await parseNaturalLanguageIntake(sentence.trim());
  if (result.status === "parsed") return NextResponse.json({ requirements: result.requirements, assumptions: result.assumptions }, { status: 201 });

  return NextResponse.json(
    { error: result.message, code: "NL_PARSE_FAILED", fixtures: BUILDING_FIXTURES },
    { status: 422 },
  );
}
