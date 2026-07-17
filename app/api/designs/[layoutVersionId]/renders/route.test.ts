import { describe, expect, test } from "bun:test";

process.env.DATABASE_URL ||= "postgres://brickpilot:brickpilot@127.0.0.1:5432/brickpilot_test";
process.env.BETTER_AUTH_SECRET ||= "brickpilot-test-secret-at-least-32-characters";
process.env.BETTER_AUTH_URL ||= "http://localhost:3000";

const { GET, POST, canonicalizeRenderReferences, renderJobBelongsToScheme, renderSourceStoragePrefix } = await import("@/app/api/designs/[layoutVersionId]/renders/route");
const context = { params: Promise.resolve({ layoutVersionId: "00000000-0000-0000-0000-000000000000" }) };

describe("/api/designs/[layoutVersionId]/renders", () => {
  test("canonicalizes shuffled semantic references before provider use", () => {
    const references = ["massing_top", "plan_reference", "massing_collage", "massing_front"].map((role) => ({
      role: role as "plan_reference" | "massing_front" | "massing_collage" | "massing_top",
      dataUri: `data:image/webp;base64,${role}`,
    }));
    expect(canonicalizeRenderReferences(references).map((reference) => reference.role)).toEqual([
      "plan_reference",
      "massing_front",
      "massing_collage",
      "massing_top",
    ]);
  });

  test("keeps current, previous, other-scheme, and legacy render provenance separate", () => {
    expect(renderJobBelongsToScheme({ schemeId: "scheme-b", geometryHash: "b" }, "scheme-b", "b")).toBe(true);
    expect(renderJobBelongsToScheme({ schemeId: "scheme-b", geometryHash: "stale" }, "scheme-b", "b")).toBe(false);
    expect(renderJobBelongsToScheme({ schemeId: "scheme-a", geometryHash: "a", schemeDisposition: "previous" }, "scheme-b", "b")).toBe(false);
    expect(renderJobBelongsToScheme({ schemeId: "scheme-a", geometryHash: "a" }, "scheme-b", "b")).toBe(false);
    expect(renderJobBelongsToScheme({ geometryHash: "legacy-hash" }, null, "legacy-hash")).toBe(true);
    expect(renderJobBelongsToScheme({ geometryHash: "old-hash" }, null, "legacy-hash")).toBe(false);
  });

  test("binds stored reference paths to both scheme and package", () => {
    expect(renderSourceStoragePrefix("layout-1", { schemeId: "scheme-a", geometryHash: "hash-a", packageId: "package-1" }))
      .toBe("sources/layout-1/scheme-a/package-1/");
    expect(renderSourceStoragePrefix("layout-1", { geometryHash: "legacy/hash", packageId: "package-2" }))
      .toBe("sources/layout-1/legacy-legacy-hash/package-2/");
  });

  test("rejects unauthenticated status reads", async () => {
    const response = await GET(new Request("http://localhost/api/designs/id/renders"), context);
    expect(response.status).toBe(401);
  });

  test("rejects unauthenticated render confirmations before parsing references", async () => {
    const response = await POST(new Request("http://localhost/api/designs/id/renders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ forged: true }),
    }), context);
    expect(response.status).toBe(401);
  });
});
