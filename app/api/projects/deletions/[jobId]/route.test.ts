import { describe, expect, test } from "bun:test";

process.env.DATABASE_URL ||= "postgres://brickpilot:brickpilot@127.0.0.1:5432/brickpilot_test";
process.env.BETTER_AUTH_SECRET ||= "brickpilot-test-secret-at-least-32-characters";
process.env.BETTER_AUTH_URL ||= "http://localhost:3000";

const { GET, POST } = await import("@/app/api/projects/deletions/[jobId]/route");
const context = { params: Promise.resolve({ jobId: "00000000-0000-0000-0000-000000000000" }) };

describe("/api/projects/deletions/[jobId]", () => {
  test("does not enumerate deletion status without authentication", async () => {
    expect((await GET(new Request("http://localhost/api/projects/deletions/id"), context)).status).toBe(401);
  });

  test("does not retry deletion without authentication", async () => {
    expect((await POST(new Request("http://localhost/api/projects/deletions/id", { method: "POST" }), context)).status).toBe(401);
  });
});
