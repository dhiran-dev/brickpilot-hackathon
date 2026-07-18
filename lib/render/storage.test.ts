import { describe, expect, test } from "bun:test";

import { decodeReferenceDataUri, deleteStoredAssetsExact, settleAssetWrites, storeRemoteRender } from "@/lib/render/storage";

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

  test("accounts for every successful write before compensating a partial batch", async () => {
    const writes = await settleAssetWrites([
      async () => ({ storageKey: "sources/layout/package/plan.webp" }),
      async () => { throw new Error("upload interrupted"); },
      async () => ({ storageKey: "sources/layout/package/top.webp" }),
    ]);
    expect(writes.stored).toEqual([
      { index: 0, value: { storageKey: "sources/layout/package/plan.webp" } },
      { index: 2, value: { storageKey: "sources/layout/package/top.webp" } },
    ]);
    expect(writes.failures).toHaveLength(1);
  });

  test("deletes only explicit deduplicated keys and reports retryable failures", async () => {
    const attempts: string[] = [];
    const result = await deleteStoredAssetsExact([
      "renders/layout/job/exterior-1.webp",
      "renders/layout/job/exterior-1.webp",
      "renders/layout/job/exterior-2.webp",
    ], async (key) => {
      attempts.push(key);
      if (key.endsWith("-2.webp")) throw new Error("temporary R2 failure");
    });
    expect(attempts).toEqual([
      "renders/layout/job/exterior-1.webp",
      "renders/layout/job/exterior-2.webp",
    ]);
    expect(result).toEqual({
      deleted: ["renders/layout/job/exterior-1.webp"],
      failed: [{ storageKey: "renders/layout/job/exterior-2.webp", reason: "temporary R2 failure" }],
    });
  });

  test("rejects unresolved prefixes as deletion targets", async () => {
    const result = await deleteStoredAssetsExact(["renders/project/"], async () => undefined);
    expect(result.deleted).toEqual([]);
    expect(result.failed[0]?.reason).toBe("Invalid asset storage key");
  });
});
