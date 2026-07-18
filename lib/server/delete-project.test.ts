import { describe, expect, test } from "bun:test";

process.env.DATABASE_URL ||= "postgres://brickpilot:brickpilot@127.0.0.1:5432/brickpilot_test";

const {
  buildExactDeletionManifest,
  candidateAssetKeysForRenderJob,
  confirmationDigest,
} = await import("@/lib/server/delete-project");

describe("durable project deletion helpers", () => {
  test("derives exact current and historical source/output keys without prefixes", () => {
    const job = {
      id: "job-1",
      layoutVersionId: "layout-1",
      requestPayload: {
        renderPurpose: "exterior_front",
        requestedOutputCount: 2,
        packageId: "package-1",
        geometryHash: "geometry/one",
        referenceRoles: ["plan_reference", "massing_front", "unexpected"],
      },
    };
    expect(candidateAssetKeysForRenderJob(job)).toEqual([
      "renders/layout-1/job-1/exterior_front-1.webp",
      "renders/layout-1/job-1/exterior_front-2.webp",
      "sources/layout-1/legacy-geometry-one/package-1/plan_reference.webp",
      "sources/layout-1/legacy-geometry-one/package-1/massing_front.webp",
      "sources/layout-1/legacy-geometry-one/package-1/massing_collage.webp",
      "sources/layout-1/legacy-geometry-one/package-1/massing_top.webp",
      "sources/layout-1/package-1/plan_reference.webp",
      "sources/layout-1/package-1/massing_front.webp",
      "sources/layout-1/package-1/massing_collage.webp",
      "sources/layout-1/package-1/massing_top.webp",
    ]);
  });

  test("unions authoritative rows and deterministic candidates idempotently", () => {
    const jobs = [{
      id: "job-1",
      layoutVersionId: "layout-1",
      requestPayload: { renderPurpose: "interior", requestedOutputCount: 1 },
    }];
    expect(buildExactDeletionManifest([
      "renders/layout-1/job-1/interior-1.webp",
      "sources/layout-1/scheme/package/plan_reference.webp",
    ], jobs)).toEqual([
      "renders/layout-1/job-1/interior-1.webp",
      "sources/layout-1/scheme/package/plan_reference.webp",
    ]);
  });

  test("binds confirmation evidence to project, owner and exact title", () => {
    expect(confirmationDigest("project-a", "owner-a", "Villa A")).toBe(
      confirmationDigest("project-a", "owner-a", "Villa A"),
    );
    expect(confirmationDigest("project-a", "owner-a", "Villa A")).not.toBe(
      confirmationDigest("project-a", "owner-a", "villa a"),
    );
  });
});
