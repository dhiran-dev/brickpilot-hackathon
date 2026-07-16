import { describe, expect, test } from "bun:test";

import { AiProviderError } from "@/lib/ai/client";
import { BUILDING_FIXTURES } from "@/lib/building/fixtures";
import { runDesignPipeline } from "@/lib/server/design-pipeline";

const requirements = BUILDING_FIXTURES[0].requirements;

describe("runDesignPipeline", () => {
  test("returns deterministic evidence, cost and a reviewed result", async () => {
    const result = await runDesignPipeline(requirements, {
      reviewComplete: async () => ({ concurs: true, confidence: "high", citedConcerns: [], requirementDeltas: [] }),
    });
    expect(result.status).toBe("generated");
    if (result.status !== "generated") throw new Error("expected generated");
    expect(result.validation.valid).toBe(true);
    expect(result.aiReview.status).toBe("reviewed");
  });

  test("fails open when the advisory provider times out", async () => {
    const result = await runDesignPipeline(requirements, {
      reviewComplete: async () => { throw new AiProviderError("timeout", "timed out"); },
    });
    expect(result.status).toBe("generated");
    if (result.status !== "generated") throw new Error("expected generated");
    expect(result.aiReview).toEqual({ status: "unavailable", reason: "timeout" });
  });

  test("does not call the reviewer when deterministic generation fails", async () => {
    const impossible = {
      ...requirements,
      rooms: requirements.rooms.map((room) => ({ ...room, minAreaMm2: room.minAreaMm2 * 50, targetAreaMm2: room.targetAreaMm2 * 50 })),
    };
    let reviewCalled = false;
    const result = await runDesignPipeline(impossible, {
      reviewComplete: async () => {
        reviewCalled = true;
        return { concurs: true, confidence: "high", citedConcerns: [], requirementDeltas: [] };
      },
    });
    expect(result.status).toBe("failed");
    expect(reviewCalled).toBe(false);
  });
});
