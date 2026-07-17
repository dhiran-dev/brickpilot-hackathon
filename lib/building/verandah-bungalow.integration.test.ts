import { describe, expect, test } from "bun:test";

import { buildReachabilityGraph, isCirculationBackboneSpace, reachableFrom, spaceAccessSemantics } from "@/lib/building/circulation";
import { VERANDAH_BUNGALOW_FIXTURE } from "@/lib/building/fixtures";
import { generateBuilding } from "@/lib/building/generate";
import { isCoveredSpace } from "@/lib/building/space-semantics";
import { isPerimeterOpenSpace } from "@/lib/building/topology";

describe("verandah bungalow generation integration", () => {
  test("selects the named parti and routes the entrance through its covered open verandah", () => {
    const generated = generateBuilding(VERANDAH_BUNGALOW_FIXTURE.requirements);
    const ground = generated.building.floors.find((floor) => floor.level === 0)!;
    const verandah = ground.spaces.find((space) => (
      space.type === "verandah" && space.id.endsWith("-entry-verandah")
    ));

    expect(generated.building.candidate.generatorId).toBe("verandah_bungalow");
    expect(generated.validation.valid).toBe(true);
    expect(verandah).toBeDefined();
    if (!verandah) throw new Error("Expected a generated entry verandah");
    expect(verandah.occupied).toBe(false);
    expect(isCoveredSpace(verandah)).toBe(true);
    expect(isPerimeterOpenSpace(verandah)).toBe(true);
    expect(spaceAccessSemantics(verandah)).toEqual({ pedestrian: true, vehicleRoad: false });
    expect(verandah && isCirculationBackboneSpace(verandah)).toBe(true);

    const entrance = ground.openings.find((opening) => opening.id === `${ground.id}-entrance`);
    expect(entrance).toEqual(expect.objectContaining({
      kind: "open_connection",
      connects: ["EXTERIOR", verandah.id],
    }));

    const reached = reachableFrom(buildReachabilityGraph(generated.building.floors));
    expect(reached.has(verandah!.id)).toBe(true);
    expect(reached.has("living")).toBe(true);
  });
});
