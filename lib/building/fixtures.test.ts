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
});
