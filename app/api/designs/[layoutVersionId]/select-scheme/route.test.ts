import { describe, expect, test } from "bun:test";

import { BUILDING_FIXTURES } from "@/lib/building/fixtures";
import { generateBuilding } from "@/lib/building/generate";
import { estimateBuildingCost } from "@/lib/cost";

process.env.DATABASE_URL ||= "postgres://brickpilot:brickpilot@127.0.0.1:5432/brickpilot_test";
process.env.BETTER_AUTH_SECRET ||= "brickpilot-test-secret-at-least-32-characters";
process.env.BETTER_AUTH_URL ||= "http://localhost:3000";

const { POST, buildCanonicalSchemeMirror, evaluateRenderSelection, hasFinalizedRenderConflict, resolveSchemeSelection } = await import("@/app/api/designs/[layoutVersionId]/select-scheme/route");
const context = { params: Promise.resolve({ layoutVersionId: "00000000-0000-0000-0000-000000000000" }) };

describe("POST /api/designs/[layoutVersionId]/select-scheme", () => {
  test("rejects unauthenticated selection before reading the payload", async () => {
    const response = await POST(new Request("http://localhost/api/designs/id/select-scheme", { method: "POST", body: "not-json" }), context);
    expect(response.status).toBe(401);
  });

  test("classifies invalid, missing, idempotent and changed selections", () => {
    const generated = generateBuilding(BUILDING_FIXTURES[0].requirements);
    const scheme = {
      schemeId: "scheme-a",
      partiId: generated.building.candidate.generatorId,
      name: "T Hub · Scheme A",
      rationale: "Short access hub.",
      building: generated.building,
      validation: generated.validation,
      evidence: [],
      ladderRung: 0,
    };
    expect(resolveSchemeSelection(null, null, "scheme-a").status).toBe("invalid-payload");
    expect(resolveSchemeSelection([scheme], null, "scheme-b").status).toBe("not-found");
    expect(resolveSchemeSelection([scheme], "scheme-a", "scheme-a").status).toBe("unchanged");
    expect(resolveSchemeSelection([scheme], null, "scheme-a").status).toBe("changed");
    expect(hasFinalizedRenderConflict(1, false)).toBe(true);
    expect(hasFinalizedRenderConflict(1, true)).toBe(false);
    const completedA = { status: "completed", requestPayload: { schemeId: "scheme-a" } };
    const previousA = { status: "completed", requestPayload: { schemeId: "scheme-a", schemeDisposition: "previous" } };
    const completedB = { status: "completed", requestPayload: { schemeId: "scheme-b" } };
    expect(evaluateRenderSelection([completedA], "scheme-a", false).decision).toBe("render-conflict");
    expect(evaluateRenderSelection([completedA], "scheme-a", true).decision).toBe("proceed");
    expect(evaluateRenderSelection([{ status: "processing", requestPayload: { schemeId: "scheme-a" } }], "scheme-a", true).decision).toBe("active-render-conflict");
    expect(evaluateRenderSelection([{ status: "finalizing", requestPayload: { schemeId: "scheme-a" } }], "scheme-a", true).decision).toBe("active-render-conflict");
    expect(evaluateRenderSelection([previousA, completedB], "scheme-b", false)).toMatchObject({ decision: "render-conflict", completed: [completedB] });
    expect(evaluateRenderSelection([previousA], "scheme-b", false)).toMatchObject({ decision: "proceed", completed: [] });
    const mirror = buildCanonicalSchemeMirror(
      scheme,
      estimateBuildingCost(generated.building, BUILDING_FIXTURES[0].requirements),
      { status: "unavailable", reason: "not_configured" },
      { existing: true },
    );
    expect(mirror).toMatchObject({
      selectedSchemeId: "scheme-a",
      layoutJson: { candidate: { geometryHash: generated.building.candidate.geometryHash } },
      validation: { valid: true },
      costEstimate: { estimateSchemaVersion: 1 },
      aiReview: { status: "unavailable" },
      intent: { existing: true, selectedSchemeId: "scheme-a" },
    });
    expect(mirror.intent.drawingCacheRevision).toContain(generated.building.candidate.geometryHash);
  });
});
