import { describe, expect, test } from "bun:test";

process.env.DATABASE_URL ||= "postgres://brickpilot:brickpilot@127.0.0.1:5432/brickpilot_test";
process.env.BETTER_AUTH_SECRET ||= "brickpilot-test-secret-at-least-32-characters";
process.env.BETTER_AUTH_URL ||= "http://localhost:3000";

const { GET } = await import("@/app/api/assets/[...key]/route");

describe("GET /api/assets/[...key]", () => {
  test("rejects unauthenticated private asset reads", async () => {
    const response = await GET(new Request("http://localhost/api/assets/renders/example.webp"), { params: Promise.resolve({ key: ["renders", "example.webp"] }) });
    expect(response.status).toBe(401);
  });
});
