import { describe, expect, test } from "bun:test";

process.env.FIREWORKS_API_KEY ||= "test-key";
process.env.AI_MODEL ||= "test-model";
process.env.DATABASE_URL ||= "postgres://brickpilot:brickpilot@127.0.0.1:5432/brickpilot_test";
process.env.BETTER_AUTH_SECRET ||= "brickpilot-test-secret-at-least-32-characters";
process.env.BETTER_AUTH_URL ||= "http://localhost:3000";

const { POST } = await import("@/app/api/intake/parse/route");

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/intake/parse", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", ...headers } });
}

describe("POST /api/intake/parse", () => {
  test("rejects unauthenticated requests", async () => {
    const response = await POST(request({ sentence: "3BHK home" }));
    expect(response.status).toBe(401);
  });
});
