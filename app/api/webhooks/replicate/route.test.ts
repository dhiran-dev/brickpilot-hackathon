import { describe, expect, test } from "bun:test";

process.env.DATABASE_URL ||= "postgres://brickpilot:brickpilot@127.0.0.1:5432/brickpilot_test";

const { webhookEventNeedsProcessing } = await import("@/app/api/webhooks/replicate/route");

describe("Replicate webhook durable processing", () => {
  test("retries a durably received event until attachment/finalization marks it processed", () => {
    expect(webhookEventNeedsProcessing(null)).toBe(true);
    expect(webhookEventNeedsProcessing({ processedAt: null })).toBe(true);
    expect(webhookEventNeedsProcessing({ processedAt: new Date("2026-07-18T00:00:00Z") })).toBe(false);
  });
});
