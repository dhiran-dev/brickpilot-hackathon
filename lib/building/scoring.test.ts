import { describe, expect, test } from "bun:test";

import { createRequirements, DEFAULT_INTAKE_DRAFT } from "@/components/guided-intake/model";
import { generateBuilding } from "@/lib/building/generate";
import { climateOrientationEvidence } from "@/lib/building/scoring";
import { buildingSchema } from "@/lib/building/schema";

describe("climate and orientation scoring evidence", () => {
  test("returns deterministic evidence for every supported climate class", () => {
    const baseRequirements = createRequirements({ ...DEFAULT_INTAKE_DRAFT, floorCount: 2 });
    const building = generateBuilding(baseRequirements).building;
    expect(building.candidate.evidence).toEqual(climateOrientationEvidence(building, baseRequirements).evidence);
    expect(buildingSchema.parse(JSON.parse(JSON.stringify(building))).candidate.evidence).toEqual(building.candidate.evidence);
    const regions = [
      { countryCode: "IN", adminArea: "Kerala", expected: "hot_humid" },
      { countryCode: "AE", adminArea: "Dubai", expected: "hot_dry" },
      { countryCode: "GB", adminArea: "England", expected: "temperate" },
      { countryCode: "CA", adminArea: "Ontario", expected: "cold_continental" },
      { countryCode: "IT", adminArea: "Sicily", expected: "mediterranean" },
    ] as const;

    for (const region of regions) {
      const requirements = structuredClone(baseRequirements);
      requirements.region = { ...requirements.region, countryCode: region.countryCode, adminArea: region.adminArea };
      const first = climateOrientationEvidence(building, requirements);
      const second = climateOrientationEvidence(building, requirements);
      expect(first).toEqual(second);
      expect(first.climateClass).toBe(region.expected);
      expect(first.scoreAdjustment).toBeFinite();
      expect(first.evidence).toHaveLength(2);
      expect(first.evidence.every((line) => line.length > 30)).toBe(true);
      expect(first.evidence.some((line) => line.includes(building.site.facing))).toBe(true);
    }
  });
});
