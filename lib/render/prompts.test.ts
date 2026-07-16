import { describe, expect, test } from "bun:test";

import { generateBuilding } from "@/lib/building/generate";
import { BUILDING_FIXTURES } from "@/lib/building/fixtures";
import { buildRenderSpecs } from "@/lib/render/prompts";

describe("server-owned render prompts", () => {
  test("locks reference roles, building facts and output counts", () => {
    const requirements = BUILDING_FIXTURES[0].requirements;
    const { building } = generateBuilding(requirements);
    const selected = building.floors[0].spaces.find((space) => space.type === "living")!;
    const specs = buildRenderSpecs({ building, requirements, selectedInteriorSpaceId: selected.id, referenceCount: 4 });
    expect(specs.exterior.requestedOutputCount).toBe(3);
    expect(specs.interior.requestedOutputCount).toBe(1);
    expect(specs.exterior.prompt).toContain("Image 1 is the marked canonical plan board");
    expect(specs.exterior.prompt).toContain("Image 4 is the isometric clay massing");
    expect(specs.exterior.prompt).toContain(`exactly ${building.floors.length} storey`);
    expect(specs.exterior.prompt).toContain("exactly ONE continuous, full-bleed");
    expect(specs.exterior.prompt).toContain("Avoid contact sheets, collages");
    expect(specs.interior.prompt).toContain(`Selected room: ${selected.name}`);
    expect(specs.interior.prompt).toContain("framed paintings or wall artworks");
  });

  test("rejects an interior room outside the canonical building", () => {
    const requirements = BUILDING_FIXTURES[0].requirements;
    const { building } = generateBuilding(requirements);
    expect(() => buildRenderSpecs({ building, requirements, selectedInteriorSpaceId: "forged", referenceCount: 4 })).toThrow("INTERIOR_SPACE_NOT_FOUND");
  });
});
