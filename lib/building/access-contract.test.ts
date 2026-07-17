import { describe, expect, test } from "bun:test";

import { accessSharedWallViolations, sharedWallLengthMm } from "@/lib/building/access-contract";
import { BUILDING_FIXTURES, VERANDAH_BUNGALOW_FIXTURE } from "@/lib/building/fixtures";
import { generateBuilding } from "@/lib/building/generate";

function cell(
  id: string,
  type: "circulation" | "bedroom" | "bathroom" | "store",
  bounds: { x: number; y: number; width: number; depth: number },
) {
  return { id, type, bounds, occupied: type !== "circulation" };
}

describe("parti access shared-wall contract", () => {
  test("measures only contiguous collinear shared boundaries", () => {
    const base = { x: 0, y: 0, width: 3_000, depth: 3_000 };
    expect(sharedWallLengthMm(base, { x: 3_000, y: 1_000, width: 2_000, depth: 1_000 })).toBe(1_000);
    expect(sharedWallLengthMm(base, { x: 3_001, y: 1_000, width: 2_000, depth: 1_000 })).toBe(0);
    expect(sharedWallLengthMm(base, { x: 1_000, y: 3_000, width: 1_000, depth: 2_000 })).toBe(1_000);
  });

  test("rejects a short access edge while allowing a door-capable two-edge route", () => {
    const cells = [
      { id: "spine", type: "circulation" as const, bounds: { x: 0, y: 0, width: 1_000, depth: 4_000 }, occupied: false },
      { id: "room", type: "bedroom" as const, bounds: { x: 1_000, y: 0, width: 3_000, depth: 2_000 }, occupied: true },
      { id: "service", type: "bathroom" as const, bounds: { x: 1_000, y: 2_000, width: 1_500, depth: 2_000 }, occupied: true },
      { id: "deep-service", type: "bathroom" as const, bounds: { x: 2_500, y: 2_000, width: 1_500, depth: 2_000 }, occupied: true },
      { id: "short", type: "study" as const, bounds: { x: -2_000, y: 0, width: 2_000, depth: 900 }, occupied: true },
    ];
    const violations = accessSharedWallViolations(cells, ["spine"]);
    expect(violations).toEqual([
      expect.objectContaining({ code: "ACCESS_EDGE_TOO_SHORT", cellIds: ["short"], measuredMm: 900 }),
    ]);
    expect(violations.some((violation) => violation.cellIds.includes("service"))).toBe(false);
    expect(violations.some((violation) => violation.cellIds.includes("deep-service"))).toBe(false);
  });

  test("caps occupied wings at two cells and reserves the inner cell for service", () => {
    const spine = cell("spine", "circulation", { x: 0, y: 0, width: 1_000, depth: 4_000 });
    const outer = cell("outer", "bedroom", { x: 1_000, y: 0, width: 2_000, depth: 4_000 });
    const validInner = cell("inner-service", "bathroom", { x: 3_000, y: 0, width: 1_500, depth: 4_000 });
    expect(accessSharedWallViolations([spine, outer, validInner], [spine.id])).toEqual([]);

    const invalidInner = { ...validInner, id: "inner-bedroom", type: "bedroom" as const };
    expect(accessSharedWallViolations([spine, outer, invalidInner], [spine.id]).map((item) => item.code)).toContain("INNER_CELL_NOT_SERVICE");

    const third = cell("third", "store", { x: 4_500, y: 0, width: 1_500, depth: 4_000 });
    expect(accessSharedWallViolations([spine, outer, validInner, third], [spine.id]).map((item) => item.code)).toContain("ACCESS_DEPTH_EXCEEDED");
  });

  test("holds across the deterministic fixture x seed bank", () => {
    const fixtures = [...BUILDING_FIXTURES, VERANDAH_BUNGALOW_FIXTURE];
    const seeds = [1, 4, 17, 26, 42, 84, 99, 0x9e3779b1];
    for (const fixture of fixtures) {
      for (const seed of seeds) {
        const requirements = structuredClone(fixture.requirements);
        requirements.seed = seed >>> 0;
        const generated = generateBuilding(requirements);
        for (const floor of generated.building.floors) {
          const requiredConnections = requirements.relationships
            .filter((relationship) => relationship.type === "must_connect")
            .filter((relationship) => floor.spaces.some((space) => space.id === relationship.fromRoomId)
              && floor.spaces.some((space) => space.id === relationship.toRoomId))
            .map((relationship) => [relationship.fromRoomId, relationship.toRoomId] as [string, string]);
          const accessSpineIds = floor.spaces
            .filter((space) => ["circulation", "stair", "verandah"].includes(space.type))
            .map((space) => space.id);
          expect(
            accessSharedWallViolations(floor.spaces, accessSpineIds, requiredConnections)
              .filter((item) => item.code === "ACCESS_EDGE_TOO_SHORT" || item.code === "REQUIRED_CONNECTION_TOO_SHORT"),
            `${fixture.id}/${seed}/${floor.id}`,
          ).toEqual([]);
        }
      }
    }
  }, 10_000);
});
