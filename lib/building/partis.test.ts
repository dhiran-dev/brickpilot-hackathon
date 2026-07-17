import { describe, expect, test } from "bun:test";

import { generatePartiCandidate } from "@/lib/building/candidates/parti-tiler";
import { partiStairAnchor, selectEligiblePartis, shouldQuarterTurnParti } from "@/lib/building/partis";
import type { RoomRequirement } from "@/lib/building/requirements";
import { stairCandidateRoom } from "@/lib/building/vertical";

function rooms(count: number): RoomRequirement[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `bed-${index}`,
    name: `Bedroom ${index}`,
    type: "bedroom" as const,
    floorId: "F0",
    minAreaMm2: 9_000_000,
    targetAreaMm2: 12_000_000,
    privacy: "private" as const,
    preferredZone: "any" as const,
    mustBeExterior: true,
    accessible: false,
  }));
}

describe("villa parti eligibility", () => {
  test("keeps eligibility independent of seed and always appends compact", () => {
    const input = {
      formStrategy: "articulated_wings" as const,
      climateClass: "hot_humid" as const,
      envelope: { x: 0, y: 0, width: 12_000, depth: 15_000 },
      floorCount: 2,
      rooms: rooms(9),
    };
    const first = selectEligiblePartis({ ...input, seed: 1 });
    const second = selectEligiblePartis({ ...input, seed: 999 });
    expect(new Set(first)).toEqual(new Set(second));
    expect(first.at(-1)).toBe("compact");
  });

  test("filters plot and floor constrained partis without filtering compact", () => {
    expect(selectEligiblePartis({
      formStrategy: "stepped_terraces",
      climateClass: "hot_humid",
      envelope: { x: 0, y: 0, width: 7_500, depth: 10_000 },
      floorCount: 3,
      rooms: rooms(4),
      seed: 42,
    })).toEqual(["t_hub", "compact"]);
  });

  test("promotes climate-appropriate partis without changing eligibility", () => {
    const common = {
      formStrategy: "courtyard" as const,
      envelope: { x: 0, y: 0, width: 12_000, depth: 15_000 },
      floorCount: 2,
      rooms: rooms(9),
      seed: 42,
    };
    expect(selectEligiblePartis({ ...common, climateClass: "hot_dry" })[0]).toBe("courtyard");
    expect(selectEligiblePartis({ ...common, climateClass: "mediterranean" })[0]).toBe("l_court");
  });

  test("quarter-turns the stair reservation only when the aligned gallery would exceed its cap", () => {
    const portrait = { x: 1_000, y: 1_500, width: 9_600, depth: 14_000 };
    const landscape = { x: 1_200, y: 1_500, width: 17_600, depth: 14_000 };
    const requirements = {
      vertical: { stairFamily: "dog_leg" as const, stairWidthMm: 1_000, liftProvision: false },
      site: { facing: "east" as const, roadEdges: ["east" as const] },
    };

    expect(shouldQuarterTurnParti(portrait)).toBe(false);
    expect(partiStairAnchor("t_hub", requirements, portrait)).toEqual({
      x: 1_000,
      y: 1_500,
      width: 2_230,
      depth: 3_200,
    });
    expect(shouldQuarterTurnParti(landscape)).toBe(true);
    expect(partiStairAnchor("l_court", requirements, landscape)).toEqual({
      x: 1_200,
      y: 13_270,
      width: 3_200,
      depth: 2_230,
    });
  });

  test("anchors the wide stair at the exact inverse-mirrored corner for every access edge", () => {
    const envelope = { x: 1_200, y: 1_500, width: 17_600, depth: 14_000 };
    const vertical = { stairFamily: "dog_leg" as const, stairWidthMm: 1_000, liftProvision: false };
    const expected = {
      north: { x: 1_200, y: 13_270, width: 3_200, depth: 2_230 },
      east: { x: 1_200, y: 13_270, width: 3_200, depth: 2_230 },
      south: { x: 1_200, y: 1_500, width: 3_200, depth: 2_230 },
      west: { x: 15_600, y: 13_270, width: 3_200, depth: 2_230 },
    };

    for (const facing of ["north", "east", "south", "west"] as const) {
      expect(partiStairAnchor("l_court", {
        vertical,
        site: { facing, roadEdges: [facing] },
      }, envelope)).toEqual(expected[facing]);
    }
  });

  test("rejects a programmed gallery that cannot fit below the hard world-space cap", () => {
    const circulation: RoomRequirement = {
      ...rooms(1)[0],
      id: "circulation-f0",
      name: "Circulation",
      type: "circulation",
      minAreaMm2: 50_000_000,
      targetAreaMm2: 50_000_000,
      mustBeExterior: false,
    };

    for (const envelope of [
      { x: 1_200, y: 1_500, width: 17_600, depth: 14_000 },
      { x: 1_200, y: 1_500, width: 9_600, depth: 14_000 },
    ]) {
      expect(() => generatePartiCandidate({
        envelope,
        rooms: [circulation],
        floor: { id: "F0", label: "Ground floor", level: 0, floorHeightMm: 3_100 },
        seed: 42,
        variant: 0,
        partiId: "t_hub",
        entranceSide: "east",
        roadEdges: ["east"],
      })).toThrow("PARTI_CIRCULATION_GALLERY_EXCEEDS_CAP");
    }
  });

  test("returns the exact caller-owned stair cell and applied reservation on every floor and road edge", () => {
    const envelope = { x: 1_200, y: 1_500, width: 17_600, depth: 14_000 };
    const vertical = { stairFamily: "dog_leg" as const, stairWidthMm: 1_000, liftProvision: false };

    for (const facing of ["north", "east", "south", "west"] as const) {
      const requirements = { vertical, site: { facing, roadEdges: [facing] } };
      const bounds = partiStairAnchor("t_hub", requirements, envelope);
      for (const level of [0, 1]) {
        const floor = { id: `F${level}`, label: level === 0 ? "Ground floor" : `Floor ${level}`, level, floorHeightMm: 3_100 };
        const floorRooms = rooms(8).map((room, index) => ({
          ...room,
          id: `bed-${level}-${index}`,
          floorId: floor.id,
        }));
        const stairCore = stairCandidateRoom(floor, bounds);
        const reservation = {
          id: "main-stair-reservation",
          bounds,
          sourceFloorId: "F0",
          kind: "stair_core" as const,
          buildability: "blocked" as const,
        };
        const candidate = generatePartiCandidate({
          envelope,
          rooms: floorRooms,
          floor,
          seed: 42,
          variant: 0,
          partiId: "t_hub",
          stairCore,
          reservedRegions: [reservation],
          entranceSide: facing,
          roadEdges: [facing],
        });

        expect(candidate.cells.find((cell) => cell.type === "stair")?.bounds).toEqual(bounds);
        expect(candidate.appliedReservedRegions?.find((region) => region.kind === "stair_core")?.bounds).toEqual(bounds);
      }
    }
  });
});
