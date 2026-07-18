import { describe, expect, test } from "bun:test";

process.env.DATABASE_URL ||= "postgres://brickpilot:brickpilot@127.0.0.1:5432/brickpilot_test";
process.env.BETTER_AUTH_SECRET ||= "brickpilot-test-secret-at-least-32-characters";
process.env.BETTER_AUTH_URL ||= "http://localhost:3000";

const { GET, PATCH, PUT, ownerDispositionSchema, releaseEvalOwnerScope, trustedEvaluatorTokenMatches } = await import("@/app/api/designs/[layoutVersionId]/render-eval/route");
const context = { params: Promise.resolve({ layoutVersionId: "00000000-0000-0000-0000-000000000000" }) };

describe("render release-evaluation API boundary", () => {
  test("fails closed for another project owner", () => {
    expect(releaseEvalOwnerScope("owner-a", "owner-a")).toBe(true);
    expect(releaseEvalOwnerScope("owner-a", "owner-b")).toBe(false);
  });

  test("rejects unauthenticated status and disposition requests", async () => {
    expect((await GET(new Request("http://localhost/api/designs/id/render-eval"), context)).status).toBe(401);
    expect((await PATCH(new Request("http://localhost/api/designs/id/render-eval", { method: "PATCH", body: "not-json" }), context)).status).toBe(401);
  });

  test("keeps owner disposition payloads separate from evaluator identity and rubric results", () => {
    expect(ownerDispositionSchema.safeParse({
      sampleId: "00000000-0000-0000-0000-000000000001",
      disposition: "approved",
      evaluator: { kind: "approved_vision_evaluator", id: "forged" },
      structural: {},
      aesthetic: {},
    }).success).toBe(false);
  });

  test("fails closed at the trusted evaluator service boundary", async () => {
    expect(trustedEvaluatorTokenMatches("Bearer service-token", "service-token")).toBe(true);
    expect(trustedEvaluatorTokenMatches("Bearer forged-token", "service-token")).toBe(false);
    expect(trustedEvaluatorTokenMatches("Bearer service-token", undefined)).toBe(false);
    const response = await PUT(new Request("http://localhost/api/designs/id/render-eval", {
      method: "PUT",
      headers: { authorization: "Bearer forged-token" },
      body: JSON.stringify({}),
    }), context);
    expect(response.status).toBe(401);
  });
});
