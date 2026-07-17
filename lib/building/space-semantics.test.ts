import { describe, expect, test } from "bun:test";

import { candidateRoom } from "@/lib/building/candidates/types";
import { isCirculationBackboneSpace, spaceAccessSemantics } from "@/lib/building/circulation";
import { roomTypeSchema, type RoomRequirement } from "@/lib/building/requirements";
import { rectanglePolygon, type Space } from "@/lib/building/schema";
import { isCoveredSpace, VERANDAH_SEMANTICS } from "@/lib/building/space-semantics";
import {
  buildCanonicalWalls,
  isOpenToSkySpace,
  isPerimeterOpenSpace,
  isVerandahOpenEdgeWall,
} from "@/lib/building/topology";

function space(id: string, type: Space["type"], bounds: Space["bounds"], occupied: boolean): Space {
  return {
    id,
    floorId: "F0",
    name: id,
    type,
    planningCellPolygon: rectanglePolygon(bounds),
    bounds,
    areaMm2: bounds.width * bounds.depth,
    occupied,
    accessible: false,
  };
}

describe("verandah space semantics", () => {
  test("defines the complete persisted-type contract without treating a verandah as a sky void", () => {
    expect(VERANDAH_SEMANTICS).toEqual({
      covered: true,
      occupied: false,
      openToSky: false,
      perimeterOpen: true,
      pedestrian: true,
      circulationBackbone: true,
      costQuantityFactor: 0.5,
    });
    expect(roomTypeSchema.parse("verandah")).toBe("verandah");

    const verandah = space("verandah", "verandah", { x: 0, y: 0, width: 6_000, depth: 2_000 }, false);
    expect(isCoveredSpace(verandah)).toBe(true);
    expect(isOpenToSkySpace(verandah)).toBe(false);
    expect(isPerimeterOpenSpace(verandah)).toBe(true);
    expect(spaceAccessSemantics(verandah)).toEqual({ pedestrian: true, vehicleRoad: false });
    expect(isCirculationBackboneSpace(verandah)).toBe(true);
  });

  test("creates verandah candidates as unoccupied covered circulation", () => {
    const requirement: RoomRequirement = {
      id: "front-verandah",
      name: "Front verandah",
      type: "verandah",
      floorId: "F0",
      minAreaMm2: 6_000_000,
      targetAreaMm2: 12_000_000,
      privacy: "public",
      preferredZone: "north",
      mustBeExterior: true,
      accessible: false,
    };
    expect(candidateRoom(requirement, { x: 0, y: 0, width: 6_000, depth: 2_000 }).occupied).toBe(false);
  });

  test("keeps the room wall behind a verandah exterior while marking only its perimeter as open", () => {
    const spaces = [
      space("verandah", "verandah", { x: 0, y: 0, width: 6_000, depth: 2_000 }, false),
      space("living", "living", { x: 0, y: 2_000, width: 6_000, depth: 4_000 }, true),
    ];
    const walls = buildCanonicalWalls("F0", { x: 0, y: 0, width: 6_000, depth: 6_000 }, spaces);
    const facadeBehindVerandah = walls.find((wall) => (
      wall.adjacentSpaceIds.includes("verandah") && wall.adjacentSpaceIds.includes("living")
    ));
    const openEdges = walls.filter((wall) => isVerandahOpenEdgeWall(wall, spaces));

    expect(facadeBehindVerandah?.type).toBe("exterior");
    expect(openEdges.length).toBeGreaterThan(0);
    expect(openEdges.every((wall) => wall.type === "exterior")).toBe(true);
  });

  test("opens the generated entry recess only at ground level and closes its repeated upper facade bay", () => {
    const groundSpaces = [
      space("F0-entry-verandah", "verandah", { x: 0, y: 0, width: 6_000, depth: 1_200 }, false),
      space("living", "living", { x: 0, y: 1_200, width: 6_000, depth: 4_800 }, true),
    ];
    const groundOpenEdge = buildCanonicalWalls("F0", { x: 0, y: 0, width: 6_000, depth: 6_000 }, groundSpaces)
      .find((wall) => isVerandahOpenEdgeWall(wall, groundSpaces));
    const upperSpaces = groundSpaces.map((candidate) => candidate.id === "F0-entry-verandah"
      ? { ...candidate, perimeterOpen: false }
      : candidate);
    const upperOpenEdge = buildCanonicalWalls("F1", { x: 0, y: 0, width: 6_000, depth: 6_000 }, upperSpaces)
      .find((wall) => isVerandahOpenEdgeWall(wall, upperSpaces));

    expect(groundOpenEdge).toBeDefined();
    expect(upperOpenEdge).toBeUndefined();
    expect(isPerimeterOpenSpace(upperSpaces[0])).toBe(false);
  });
});
