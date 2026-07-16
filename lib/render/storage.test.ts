import { describe, expect, test } from "bun:test";

import { decodeReferenceDataUri, storeRemoteRender } from "@/lib/render/storage";

describe("reference image boundary", () => {
  test("accepts bounded image data URIs", () => {
    const decoded = decodeReferenceDataUri(`data:image/webp;base64,${Buffer.from("fixture").toString("base64")}`);
    expect(decoded.contentType).toBe("image/webp");
    expect(Buffer.from(decoded.bytes).toString()).toBe("fixture");
  });

  test("rejects unsupported, empty and oversized references", () => {
    expect(() => decodeReferenceDataUri("data:image/svg+xml;base64,PHN2Zy8+")).toThrow();
    expect(() => decodeReferenceDataUri("data:image/webp;base64,")).toThrow();
    expect(() => decodeReferenceDataUri(`data:image/webp;base64,${Buffer.alloc(1_000_001).toString("base64")}`)).toThrow();
  });

  test("rejects lookalike Replicate delivery hosts before downloading", async () => {
    await expect(storeRemoteRender("https://evilreplicate.delivery/output.webp", "renders/test/output.webp"))
      .rejects.toThrow("Unexpected Replicate output host");
  });
});
