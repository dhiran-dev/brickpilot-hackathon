import { describe, expect, test } from "bun:test";

import { generateBuilding } from "@/lib/building/generate";
import { BUILDING_FIXTURES } from "@/lib/building/fixtures";
import { buildReferencePlanSvg } from "@/lib/render/reference-plan";

describe("marked plan reference", () => {
  test("contains canonical evidence and escapes user-facing labels", () => {
    const result = generateBuilding(BUILDING_FIXTURES[0].requirements);
    const selected = result.building.floors[0].spaces.find((space) => space.type === "living")!;
    const svg = buildReferencePlanSvg(result.building, { projectName: "A&B <House>", selectedSpaceId: selected.id });
    expect(svg).toContain("A&amp;B &lt;House&gt;");
    expect(svg).toContain(result.building.candidate.geometryHash);
    expect(svg).toContain("INTERIOR SOURCE");
    expect(svg.match(/INTERIOR SOURCE/g)).toHaveLength(1);
    for (const floor of result.building.floors) expect(svg).toContain(floor.label.toUpperCase());
    for (const room of result.building.floors[0].spaces) expect(svg).toContain(room.name);
  });
});
