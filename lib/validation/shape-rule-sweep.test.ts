import { describe, expect, test } from "bun:test";

import { createRequirements, DEFAULT_INTAKE_DRAFT } from "@/components/guided-intake/model";
import { BUILDING_FIXTURES } from "@/lib/building/fixtures";
import { generateBuilding } from "@/lib/building/generate";
import {
  CAPTURED_DORMITORY_PATTERN_BUILDING,
  HAND_TILED_KNOWN_GOOD_BUILDING,
} from "@/lib/validation/shape-rule-fixtures";
import {
  SHAPE_RULE_CALIBRATION_VERSION,
  sweepShapeRuleThresholds,
} from "@/lib/validation/shape-rule-sweep";
import { shapeRuleFindings } from "@/lib/validation/shape-rules";

describe("T4 deterministic shape-rule threshold sweep", () => {
  test("commits sweep-derived production constants against fixtures x floors x seeds", () => {
    const seeds = [1, 17, 42, 99];
    const generatedBank = [1, 2, 3, 4].flatMap((floorCount) => seeds.map((seed) => (
      generateBuilding(createRequirements({
        ...DEFAULT_INTAKE_DRAFT,
        floorCount: floorCount as 1 | 2 | 3 | 4,
        seed,
      })).building
    )));
    const cannedBank = BUILDING_FIXTURES.flatMap((fixture) => seeds.map((seed) => {
      const requirements = structuredClone(fixture.requirements);
      requirements.seed = seed;
      return generateBuilding(requirements).building;
    }));
    const acceptedBank = [HAND_TILED_KNOWN_GOOD_BUILDING, ...generatedBank, ...cannedBank];
    const report = sweepShapeRuleThresholds(acceptedBank);
    const production = report.find((row) => row.profile === "production")!;
    const strict = report.find((row) => row.profile === "strict")!;

    expect(SHAPE_RULE_CALIBRATION_VERSION).toBe("villa-fixture-sweep-v1");
    expect(production.evaluatedBuildings).toBe(29);
    expect(production.rejectedBuildings).toBe(0);
    expect(production.findingsByRule).toEqual({});
    expect(strict.rejectedBuildings).toBeGreaterThan(0);
    expect(strict.findingsByRule).toEqual(expect.objectContaining({
      ROOM_PROPORTION: expect.any(Number),
      CIRCULATION_RATIO: expect.any(Number),
    }));

    expect(shapeRuleFindings(HAND_TILED_KNOWN_GOOD_BUILDING)).toEqual([]);
    expect(shapeRuleFindings(CAPTURED_DORMITORY_PATTERN_BUILDING).map((finding) => finding.ruleId)).toEqual(expect.arrayContaining([
      "ROOM_PROPORTION",
      "GALLERY_LENGTH",
    ]));
  });
});
