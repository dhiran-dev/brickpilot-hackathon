import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { generatedAssets, projects } from "@/lib/db/schema";
import { readStoredAsset } from "@/lib/render/storage";

export async function GET(request: Request, context: { params: Promise<{ key: string[] }> }) {
  const user = await requireUser(request);
  if (!user) return NextResponse.json({ error: "Authentication is required.", code: "AUTH_REQUIRED" }, { status: 401 });
  const { key } = await context.params;
  const storageKey = key.join("/");
  const [asset] = await db.select({ id: generatedAssets.id })
    .from(generatedAssets)
    .innerJoin(projects, eq(generatedAssets.projectId, projects.id))
    .where(and(
      eq(generatedAssets.storageKey, storageKey),
      eq(generatedAssets.status, "completed"),
      eq(projects.ownerId, user.id),
    ))
    .limit(1);
  if (!asset) return NextResponse.json({ error: "Asset not found.", code: "ASSET_NOT_FOUND" }, { status: 404 });
  try {
    const stored = await readStoredAsset(storageKey);
    return new Response(stored.bytes, {
      headers: {
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Type": stored.contentType,
        ...(stored.etag ? { ETag: stored.etag } : {}),
      },
    });
  } catch (error) {
    console.error("Stored asset read failed", error);
    return NextResponse.json({ error: "Asset storage is unavailable.", code: "ASSET_STORAGE_UNAVAILABLE" }, { status: 502 });
  }
}
