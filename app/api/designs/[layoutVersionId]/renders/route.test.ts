import { describe, expect, test } from "bun:test";

process.env.DATABASE_URL ||= "postgres://brickpilot:brickpilot@127.0.0.1:5432/brickpilot_test";
process.env.BETTER_AUTH_SECRET ||= "brickpilot-test-secret-at-least-32-characters";
process.env.BETTER_AUTH_URL ||= "http://localhost:3000";

const { GET, POST } = await import("@/app/api/designs/[layoutVersionId]/renders/route");
const context = { params: Promise.resolve({ layoutVersionId: "00000000-0000-0000-0000-000000000000" }) };

describe("/api/designs/[layoutVersionId]/renders", () => {
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
