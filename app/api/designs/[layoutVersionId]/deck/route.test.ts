import { describe, expect, test } from "bun:test";

process.env.DATABASE_URL ||= "postgres://brickpilot:brickpilot@127.0.0.1:5432/brickpilot_test";
process.env.BETTER_AUTH_SECRET ||= "brickpilot-test-secret-at-least-32-characters";
process.env.BETTER_AUTH_URL ||= "http://localhost:3000";

const { GET } = await import("@/app/api/designs/[layoutVersionId]/deck/route");
const context = { params: Promise.resolve({ layoutVersionId: "00000000-0000-0000-0000-000000000000" }) };

describe("GET /api/designs/[layoutVersionId]/deck", () => {
  test("rejects unauthenticated requests", async () => {
    const response = await GET(new Request("http://localhost/api/designs/id/deck"), context);
    expect(response.status).toBe(401);
  });
});
