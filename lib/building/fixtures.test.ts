import { describe, expect, test } from "bun:test";

import { generateBuilding } from "@/lib/building/generate";
import { BUILDING_FIXTURES } from "@/lib/building/fixtures";
import { buildingRequirementsSchema } from "@/lib/building/requirements";
import { validateBuilding } from "@/lib/validation";

describe("canned demo fixtures", () => {
  test("ships exactly three fixtures with unique ids", () => {
    expect(BUILDING_FIXTURES.length).toBe(3);
    expect(new Set(BUILDING_FIXTURES.map((fixture) => fixture.id)).size).toBe(3);
  });

  test("every fixture is schema-valid and produces a valid deterministic building", () => {
    for (const fixture of BUILDING_FIXTURES) {
      expect(buildingRequirementsSchema.safeParse(fixture.requirements).success).toBe(true);
      const generated = generateBuilding(fixture.requirements);
      const validation = validateBuilding(generated.building, fixture.requirements);
      expect(validation.valid).toBe(true);
    }
  });

  test("keeps the compact fixture entrance on a north road", () => {
    const compact = structuredClone(BUILDING_FIXTURES.find((fixture) => fixture.id === "compact-2bhk-20x30")!.requirements);
    compact.site.facing = "north";
    compact.site.roadEdges = ["north"];
    const generated = generateBuilding(compact);
    const floor = generated.building.floors[0];
    const entrance = floor.openings.find((opening) => opening.id === "F0-entrance");
    const wall = floor.walls.find((candidate) => candidate.id === entrance?.wallId);
    expect(generated.validation.valid).toBe(true);
    expect(wall?.start.y).toBe(floor.envelope.y);
  });
});
