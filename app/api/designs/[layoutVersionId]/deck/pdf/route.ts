import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";

import { DeckDocument } from "@/components/deck/pdf/DeckDocument";
import { requireUser } from "@/lib/auth";
import { loadDeckPayload } from "@/lib/design/deck-loader";
import { readStoredAsset } from "@/lib/render/storage";

function storageKeyFromAssetUrl(url: string) {
  return decodeURIComponent(url.replace(/^\/api\/assets\//, ""));
}

async function assetToPngDataUri(bytes: Uint8Array, contentType: string): Promise<string> {
  if (contentType === "image/png") return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
  const converted = await new Bun.Image(bytes).png().toBuffer();
  return `data:image/png;base64,${Buffer.from(converted).toString("base64")}`;
}

export async function GET(request: Request, context: { params: Promise<{ layoutVersionId: string }> }) {
  const user = await requireUser(request);
  if (!user) return NextResponse.json({ error: "Authentication is required.", code: "AUTH_REQUIRED" }, { status: 401 });
  const { layoutVersionId } = await context.params;
  const result = await loadDeckPayload(layoutVersionId, user.id);
  if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: result.status });
  const { payload } = result;

  if (payload.renders.status !== "completed") {
    return NextResponse.json({ error: "Renders must finish before the deck can be exported.", code: "RENDERS_NOT_COMPLETED" }, { status: 409 });
  }

  const renderImages = new Map<string, string>();
  await Promise.all(payload.renders.assets.map(async (asset) => {
    try {
      const stored = await readStoredAsset(storageKeyFromAssetUrl(asset.url));
      const dataUri = await assetToPngDataUri(stored.bytes, stored.contentType);
      renderImages.set(asset.role, dataUri);
    } catch {
      // Missing/unavailable render asset: the PDF renders that tile without an image rather than failing the whole export.
    }
  }));

  const buffer = await renderToBuffer(DeckDocument({ payload, renderImages }));
  const filename = `${payload.title.replace(/[^a-zA-Z0-9-]+/g, "-").toLowerCase()}-deck.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
