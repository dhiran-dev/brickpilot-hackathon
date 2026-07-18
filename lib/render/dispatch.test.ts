import { describe, expect, test } from "bun:test";

import { createCurrentRequirements, DEFAULT_INTAKE_DRAFT } from "@/components/guided-intake/model";
import { BUILDING_FIXTURES } from "@/lib/building/fixtures";
import { generateBuilding } from "@/lib/building/generate";
import { generateV3PhysicalStage } from "@/lib/building/generate-v3-physical";
import { dispatchRenderSpecs, renderEligibleInteriorSpace } from "@/lib/render/dispatch";
import { buildRenderSpecs } from "@/lib/render/prompts";

describe("versioned render dispatch", () => {
  test("preserves the frozen v2 compiler output exactly", () => {
    const requirements = BUILDING_FIXTURES[0].requirements;
    const building = generateBuilding(requirements).building;
    const selected = building.floors.flatMap((floor) => floor.spaces).find((space) => space.type === "living")!;
    const legacy = buildRenderSpecs({ building, requirements, selectedInteriorSpaceId: selected.id });
    const dispatched = dispatchRenderSpecs({ building, requirements, selectedInteriorSpaceId: selected.id });
    expect(dispatched).toMatchObject({ buildingSchemaVersion: 2, renderContractVersion: 2 });
    expect(dispatched.specs).toEqual(legacy);
  });

  test("dispatches schema v3 to semantic camera and geometry-lock prompts", () => {
    const requirements = createCurrentRequirements({ ...DEFAULT_INTAKE_DRAFT, roofCharacter: "sloped" }, {
      shadeStructures: [{ id: "parking-open-pergola", type: "open_pergola", location: "parking", targetAreaM2: 12, source: "user" }],
    });
    const building = generateV3PhysicalStage(requirements).schemes[0].building;
    const selected = building.floors.flatMap((floor) => floor.spaces).find((space) => space.type === "living")!;
    const dispatched = dispatchRenderSpecs({ building, requirements, selectedInteriorSpaceId: selected.id });
    expect(dispatched).toMatchObject({ buildingSchemaVersion: 3, renderContractVersion: 3 });
    expect(dispatched.specs[0]).toMatchObject({ semanticView: "primary_road_elevation", releaseEvalTarget: "gpt_image_2_designer_elevation" });
    expect(renderEligibleInteriorSpace(building, selected.id)?.id).toBe(selected.id);
    expect(renderEligibleInteriorSpace(building, building.floors.flatMap((floor) => floor.spaces).find((space) => space.type === "parking")!.id)).toBeNull();
  });

  test("rejects a cross-version requirements/building pair", () => {
    const legacyRequirements = BUILDING_FIXTURES[0].requirements;
    const currentRequirements = createCurrentRequirements(DEFAULT_INTAKE_DRAFT);
    const building = generateV3PhysicalStage(currentRequirements).schemes[0].building;
    expect(() => dispatchRenderSpecs({ building, requirements: legacyRequirements, selectedInteriorSpaceId: "living" })).toThrow();
  });
});
