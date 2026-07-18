import { describe, expect, test } from "bun:test";

import { createCurrentRequirements, DEFAULT_INTAKE_DRAFT } from "@/components/guided-intake/model";
import { BUILDING_FIXTURES } from "@/lib/building/fixtures";
import {
  AiSuggestionContractError,
  createAiSuggestionRevision,
  parseAiSuggestionSource,
} from "@/lib/server/ai-suggestion-contract";

const current = createCurrentRequirements({
  ...DEFAULT_INTAKE_DRAFT,
  roofCharacter: "sloped",
  shadeStructures: [
    { id: "front-open-pergola", type: "open_pergola", location: "front_entry", targetAreaM2: 10, source: "user" },
  ],
  aboveParkingUse: { value: "occupied_rooms", source: "user" },
  maxExteriorPedestrianEntryCount: 1,
});

describe("AI suggestion contract dispatch", () => {
  test("parses schema v3 only for an exactly matched current-v3 project", () => {
    const source = parseAiSuggestionSource({
      capabilityProfile: "current_v3",
      generatorContractVersion: 3,
      requirements: current,
    });
    expect(source.contract).toBe("v3");
    expect(source.requirements.requirementSchemaVersion).toBe(3);
  });

  test("rejects profile/version and requirements contract mismatches", () => {
    expect(() => parseAiSuggestionSource({
      capabilityProfile: "current_v3",
      generatorContractVersion: 2,
      requirements: current,
    })).toThrow(AiSuggestionContractError);
    expect(() => parseAiSuggestionSource({
      capabilityProfile: "current_v3",
      generatorContractVersion: 3,
      requirements: BUILDING_FIXTURES[1].requirements,
    })).toThrow(AiSuggestionContractError);
    expect(() => parseAiSuggestionSource({
      capabilityProfile: "legacy_view_only",
      generatorContractVersion: 2,
      requirements: BUILDING_FIXTURES[1].requirements,
    })).toThrow(AiSuggestionContractError);
  });

  test("propagates a v3 hard-validation failure without falling back to v2", async () => {
    let v2Called = false;
    const kitchen = current.rooms.find((room) => room.type === "kitchen")!;
    const revision = await createAiSuggestionRevision(
      { contract: "v3", requirements: current },
      { op: "resize_room", roomId: kitchen.id, resizeDirection: "increase", summary: "Increase kitchen" },
      1234,
      {
        v2: async () => {
          v2Called = true;
          throw new Error("v2 must not run");
        },
        v3: async () => ({
          status: "failed",
          code: "V3_HARD_VALIDATION_FAILED",
          message: "Authoritative physical validation rejected every scheme.",
          conflicts: [],
        }),
      },
    );

    expect(revision.contract).toBe("v3");
    expect(revision.requirements.requirementSchemaVersion).toBe(3);
    expect(revision.requirements.seed).toBe(1234);
    expect(revision.pipelineResult).toMatchObject({ status: "failed", code: "V3_HARD_VALIDATION_FAILED" });
    expect(v2Called).toBe(false);
  });
});
