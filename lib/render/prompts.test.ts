import { describe, expect, test } from "bun:test";

import { generateBuilding } from "@/lib/building/generate";
import { BUILDING_FIXTURES } from "@/lib/building/fixtures";
import { buildRenderSpecs, RENDER_CONTRACT_VERSION, RENDER_PURPOSES } from "@/lib/render/prompts";

describe("server-owned render prompts", () => {
  test("binds four one-image semantic jobs to exact sources", () => {
    const requirements = BUILDING_FIXTURES[0].requirements;
    const { building } = generateBuilding(requirements);
    const selected = building.floors[0].spaces.find((space) => space.type === "living")!;
    const specs = buildRenderSpecs({ building, requirements, selectedInteriorSpaceId: selected.id });

    expect(RENDER_CONTRACT_VERSION).toBe(2);
    expect(specs.map((spec) => spec.purpose)).toEqual([...RENDER_PURPOSES]);
    expect(specs.map((spec) => spec.sourceRole)).toEqual(["massing_front", "massing_collage", "massing_top", "plan_reference"]);
    expect(specs.every((spec) => spec.requestedOutputCount === 1)).toBe(true);
    for (const spec of specs.slice(0, 3)) {
      expect(spec.prompt).toContain("EDIT THE SUPPLIED ARCHITECTURAL SOURCE IMAGE");
      expect(spec.prompt).toContain("Preserve the exact building silhouette");
      expect(spec.prompt).toContain("Every opening is immutable");
      expect(spec.prompt).toContain(`exactly ${building.floors.length} storey`);
    }
    expect(specs[0].prompt).toContain("FRONT / ROAD · CAMERA LOCK");
    expect(specs[1].prompt).toContain("Preserve the exact 2-by-2 panel grid");
    expect(specs[2].prompt).toContain("HIGH 3/4 · FRONT + RIGHT");
    expect(specs[3].prompt).toContain(`Selected room: ${selected.name}`);
    expect(specs[3].prompt).toContain("plan-derived fallback");
    expect(specs[3].prompt).toContain("framed paintings");
  });

  test("rejects an interior room outside the canonical building", () => {
    const requirements = BUILDING_FIXTURES[0].requirements;
    const { building } = generateBuilding(requirements);
    expect(() => buildRenderSpecs({ building, requirements, selectedInteriorSpaceId: "forged" })).toThrow("INTERIOR_SPACE_NOT_FOUND");
  });
});
