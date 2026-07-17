import { describe, expect, test } from "bun:test";

import { buildReachabilityGraph, reachableFrom } from "@/lib/building/circulation";
import { MAIN_ENTRY_CLEAR_WIDTH_MM, placeFloorOpenings } from "@/lib/building/openings";
import { normalizeFloorTopology } from "@/lib/building/topology";

describe("opening synthesis access spine", () => {
  test("routes an entrance through explicitly registered parti hubs", () => {
    const floor = normalizeFloorTopology({
      floor: { id: "F0", label: "Ground floor", level: 0, floorHeightMm: 3_100 },
      cells: [{
        id: "entry-hub",
        name: "Entry hub",
        type: "study",
        floorId: "F0",
        minAreaMm2: 12_000_000,
        targetAreaMm2: 12_000_000,
        accessible: false,
        occupied: true,
        bounds: { x: 0, y: 0, width: 6_000, depth: 2_000 },
      }, {
        id: "inner-hub",
        name: "Inner hub",
        type: "kitchen",
        floorId: "F0",
        minAreaMm2: 12_000_000,
        targetAreaMm2: 12_000_000,
        accessible: false,
        occupied: true,
        bounds: { x: 0, y: 2_000, width: 6_000, depth: 2_000 },
      }, {
        id: "bedroom",
        name: "Bedroom",
        type: "bedroom",
        floorId: "F0",
        minAreaMm2: 12_000_000,
        targetAreaMm2: 12_000_000,
        accessible: false,
        occupied: true,
        bounds: { x: 0, y: 4_000, width: 6_000, depth: 2_000 },
      }],
    }, { x: 0, y: 0, width: 6_000, depth: 6_000 }, 0);

    const withOnlyEntryRegistered = placeFloorOpenings(floor, {
      entranceSide: "north",
      isGroundFloor: true,
      accessSpineSpaceIds: ["entry-hub"],
    });
    expect(withOnlyEntryRegistered.openings.some((opening) => (
      opening.kind !== "window" && opening.connects.includes("bedroom")
    ))).toBe(false);

    const withOpenings = placeFloorOpenings(floor, {
      entranceSide: "north",
      isGroundFloor: true,
      accessSpineSpaceIds: ["entry-hub", "inner-hub"],
    });

    expect(withOpenings.openings.filter((opening) => opening.kind === "door").map((opening) => opening.connects)).toEqual([
      ["EXTERIOR", "entry-hub"],
      ["entry-hub", "inner-hub"],
      ["inner-hub", "bedroom"],
    ]);
  });

  test("enters an open verandah and reaches rooms through it as a circulation backbone", () => {
    const floor = normalizeFloorTopology({
      floor: { id: "F0", label: "Ground floor", level: 0, floorHeightMm: 3_100 },
      cells: [{
        id: "front-verandah",
        name: "Front verandah",
        type: "verandah",
        floorId: "F0",
        minAreaMm2: 12_000_000,
        targetAreaMm2: 12_000_000,
        accessible: false,
        occupied: false,
        bounds: { x: 0, y: 0, width: 6_000, depth: 2_000 },
      }, {
        id: "living",
        name: "Living",
        type: "living",
        floorId: "F0",
        minAreaMm2: 24_000_000,
        targetAreaMm2: 24_000_000,
        accessible: false,
        occupied: true,
        bounds: { x: 0, y: 2_000, width: 6_000, depth: 4_000 },
      }],
    }, { x: 0, y: 0, width: 6_000, depth: 6_000 }, 0);

    const withOpenings = placeFloorOpenings(floor, { entranceSide: "north", isGroundFloor: true });

    expect(withOpenings.openings.find((opening) => opening.id === "F0-entrance")).toEqual(expect.objectContaining({
      kind: "open_connection",
      usage: "pedestrian",
      connects: ["EXTERIOR", "front-verandah"],
      widthMm: MAIN_ENTRY_CLEAR_WIDTH_MM,
    }));
    expect(withOpenings.openings.some((opening) => (
      opening.kind === "door" && opening.connects.includes("front-verandah") && opening.connects.includes("living")
    ))).toBe(true);
    const reached = reachableFrom(buildReachabilityGraph([withOpenings]));
    expect(reached.has("front-verandah")).toBe(true);
    expect(reached.has("living")).toBe(true);
  });
});
