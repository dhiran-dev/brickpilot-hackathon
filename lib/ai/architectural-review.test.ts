import { describe, expect, test } from "bun:test";

import { reviewBuilding } from "@/lib/ai/architectural-review";
import { AiProviderError } from "@/lib/ai/client";
import { BUILDING_FIXTURES } from "@/lib/building/fixtures";
import { V3_OUTPUT_CONSUMER_BUILDING } from "@/lib/building/fixtures/v3-output-consumer";
import { generateBuilding } from "@/lib/building/generate";
import { createCurrentRequirements, DEFAULT_INTAKE_DRAFT } from "@/components/guided-intake/model";

const fixture = BUILDING_FIXTURES[0];
const generated = generateBuilding(fixture.requirements);

describe("reviewBuilding", () => {
  test("returns a reviewed result when every concern is grounded to real topology", async () => {
    const roomId = generated.building.floors[0].spaces[0].id;
    const result = await reviewBuilding(
      { requirements: fixture.requirements, building: generated.building, validation: generated.validation },
      { complete: async () => ({
        concurs: true,
        confidence: "high",
        citedConcerns: [{ objectIds: [roomId], evidenceIds: [`room:${roomId}`], topic: "daylight", whyItMatters: "This room relies on limited exterior access.", recommendation: "Review its exterior opening during professional design.", whatItSaves: "Reduces the chance of redesigning the room's daylight strategy later." }],
        requirementDeltas: [],
      }) },
    );
    expect(result.status).toBe("reviewed");
  });

  test("rejects hallucinated object and room references", async () => {
    const result = await reviewBuilding(
      { requirements: fixture.requirements, building: generated.building, validation: generated.validation },
      { complete: async () => ({
        concurs: false,
        confidence: "medium",
        citedConcerns: [{ objectIds: ["invented-room"], evidenceIds: ["room:invented-room"], topic: "adjacency", whyItMatters: "Invented concern.", recommendation: "Invented fix.", whatItSaves: "Nothing." }],
        requirementDeltas: [{ op: "remove_room", roomId: "invented-room", summary: "Remove it" }],
      }) },
    );
    expect(result).toEqual({ status: "unavailable", reason: "invalid_output" });
  });

  test("sends condensed evidence without coordinates", async () => {
    let serialized = "";
    await reviewBuilding(
      { requirements: fixture.requirements, building: generated.building, validation: generated.validation },
      { complete: async (request) => {
        serialized = JSON.stringify(request.userPayload);
        return { concurs: true, confidence: "high", citedConcerns: [], requirementDeltas: [] };
      } },
    );
    expect(serialized).not.toContain('"bounds"');
    expect(serialized).not.toContain('"x"');
    expect(serialized).toContain('"topology"');
    expect(serialized).toContain('"drawingSummary"');
    expect(serialized).toContain('"evidenceId"');
  });

  test("rejects a non-concurrence response without cited concerns", async () => {
    const result = await reviewBuilding(
      { requirements: fixture.requirements, building: generated.building, validation: generated.validation },
      { complete: async () => ({ concurs: false, confidence: "low", citedConcerns: [], requirementDeltas: [] }) },
    );
    expect(result).toEqual({ status: "unavailable", reason: "invalid_output" });
  });

  test("rejects evidence that exists but does not support the cited object", async () => {
    const [firstRoom, secondRoom] = generated.building.floors[0].spaces;
    const result = await reviewBuilding(
      { requirements: fixture.requirements, building: generated.building, validation: generated.validation },
      { complete: async () => ({
        concurs: false,
        confidence: "medium",
        citedConcerns: [{ objectIds: [firstRoom.id], evidenceIds: [`room:${secondRoom.id}`], topic: "adjacency", whyItMatters: "The evidence points elsewhere.", recommendation: "Review adjacency.", whatItSaves: "Avoids acting on an ungrounded suggestion." }],
        requirementDeltas: [],
      }) },
    );
    expect(result).toEqual({ status: "unavailable", reason: "invalid_output" });
  });

  test("returns unavailable for invalid schema output and provider timeout", async () => {
    const invalid = await reviewBuilding(
      { requirements: fixture.requirements, building: generated.building, validation: generated.validation },
      { complete: async () => ({ concurs: "yes" }) },
    );
    expect(invalid).toEqual({ status: "unavailable", reason: "invalid_output" });

    const timeout = await reviewBuilding(
      { requirements: fixture.requirements, building: generated.building, validation: generated.validation },
      { complete: async () => { throw new AiProviderError("timeout", "timed out"); } },
    );
    expect(timeout).toEqual({ status: "unavailable", reason: "timeout" });
  });

  test("re-asks once after malformed output and accepts a corrected response", async () => {
    let calls = 0;
    const result = await reviewBuilding(
      { requirements: fixture.requirements, building: generated.building, validation: generated.validation },
      { complete: async () => {
        calls += 1;
        return calls === 1 ? { concurs: "yes" } : { concurs: true, confidence: "high", citedConcerns: [], requirementDeltas: [] };
      } },
    );
    expect(calls).toBe(2);
    expect(result.status).toBe("reviewed");
  });

  test("grounds v3 physical-system concerns to canonical evidence without adapting geometry", async () => {
    let serialized = "";
    const result = await reviewBuilding({
      requirements: createCurrentRequirements({ ...DEFAULT_INTAKE_DRAFT, roofCharacter: "sloped" }),
      building: V3_OUTPUT_CONSUMER_BUILDING,
      validation: {
        schemaVersion: "validation-report-v3",
        rulePackVersion: "rules-v3-fixture",
        valid: true,
        score: 100,
        counts: { error: 0, warning: 0, info: 0 },
        findings: [],
      },
    }, {
      complete: async (request) => {
        serialized = JSON.stringify(request.userPayload);
        return {
          concurs: true,
          confidence: "high",
          citedConcerns: [{ objectIds: ["roof-main"], evidenceIds: ["roof:roof-main"], topic: "other", whyItMatters: "The pitched roof is a defining physical-system choice.", recommendation: "Retain the canonical roof geometry through design development.", whatItSaves: "Avoids losing the selected roof intent." }],
          requirementDeltas: [],
        };
      },
    });
    expect(result.status).toBe("reviewed");
    expect(serialized).toContain('"evidenceId":"roof:roof-main"');
    expect(serialized).not.toContain('"vertices"');
  });
});
