import { describe, expect, test } from "bun:test";

process.env.DATABASE_URL ||= "postgres://brickpilot:brickpilot@127.0.0.1:5432/brickpilot_test";
process.env.BETTER_AUTH_SECRET ||= "brickpilot-test-secret-at-least-32-characters";
process.env.BETTER_AUTH_URL ||= "http://localhost:3000";

const { POST } = await import("@/app/api/designs/[layoutVersionId]/apply-suggestion/route");

function request() {
  return new Request("http://localhost/api/designs/00000000-0000-0000-0000-000000000000/apply-suggestion", {
    method: "POST",
    body: JSON.stringify({ deltaIndex: 0 }),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/designs/[layoutVersionId]/apply-suggestion", () => {
  test("rejects unauthenticated requests", async () => {
    const response = await POST(request(), { params: Promise.resolve({ layoutVersionId: "00000000-0000-0000-0000-000000000000" }) });
    expect(response.status).toBe(401);
  });
});
