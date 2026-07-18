import { describe, expect, test } from "bun:test";

process.env.DATABASE_URL ||= "postgres://brickpilot:brickpilot@127.0.0.1:5432/brickpilot_test";
process.env.BETTER_AUTH_SECRET ||= "brickpilot-test-secret-at-least-32-characters";
process.env.BETTER_AUTH_URL ||= "http://localhost:3000";

const { DELETE } = await import("@/app/api/projects/[projectId]/route");

describe("DELETE /api/projects/[projectId]", () => {
  test("requires authentication before parsing destructive confirmation", async () => {
    const response = await DELETE(new Request("http://localhost/api/projects/project", {
      method: "DELETE",
      body: "not-json",
    }), { params: Promise.resolve({ projectId: "not-a-uuid" }) });
    expect(response.status).toBe(401);
  });
});
