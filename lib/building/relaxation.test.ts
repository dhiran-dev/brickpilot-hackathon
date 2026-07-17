import { describe, expect, test } from "bun:test";

import { BUILDING_FIXTURES } from "@/lib/building/fixtures";
import { generateBuilding } from "@/lib/building/generate";
import { buildRelaxationLadder, PRESERVED_HARD_SHAPE_RULES } from "@/lib/building/relaxation";
import { buildingSchema } from "@/lib/building/schema";
import { CAPTURED_DORMITORY_PATTERN_BUILDING } from "@/lib/validation/shape-rule-fixtures";
import { shapeRuleFindings } from "@/lib/validation/shape-rules";

describe("bounded generation relaxation ladder", () => {
  test("keeps the five hard shape rules at every preference rung", () => {
    const ladder = buildRelaxationLadder(["courtyard", "l_court", "t_hub", "compact"]);
    expect(ladder.map((attempt) => attempt.rung)).toEqual([0, 1, 1, 2, 3]);
    for (const attempt of ladder) expect(attempt.preservedHardRules).toEqual(PRESERVED_HARD_SHAPE_RULES);
    expect(ladder.find((attempt) => attempt.rung === 2)).toMatchObject({ id: "simplified_court", partiId: "t_hub", simplifiedCourt: true });
  });

  test("persists the selected rung on the generated study building", () => {
    const generated = generateBuilding(BUILDING_FIXTURES[1].requirements).building;
    expect(generated.candidate.relaxation).toEqual({ rung: 0, id: "preferred_parti", simplifiedCourt: false });
    const roundTripped = buildingSchema.parse(JSON.parse(JSON.stringify(generated)));
    expect(roundTripped.candidate.relaxation).toEqual(generated.candidate.relaxation);
  });

  test("still rejects the captured dormitory at the final compact rung", () => {
    const rungThreeDormitory = structuredClone(CAPTURED_DORMITORY_PATTERN_BUILDING);
    rungThreeDormitory.candidate.relaxation = { rung: 3, id: "compact_fallback", simplifiedCourt: false };
    const hardFindings = shapeRuleFindings(rungThreeDormitory)
      .filter((finding) => PRESERVED_HARD_SHAPE_RULES.includes(finding.ruleId as (typeof PRESERVED_HARD_SHAPE_RULES)[number]));
    expect(hardFindings).toContainEqual(expect.objectContaining({ ruleId: "GALLERY_LENGTH", severity: "error" }));
    expect(hardFindings).toContainEqual(expect.objectContaining({ ruleId: "ROOM_PROPORTION", severity: "error" }));
  });
});
