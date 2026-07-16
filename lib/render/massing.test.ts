import { describe, expect, test } from "bun:test";

import { buildingSchema, rectanglePolygon, type Building } from "@/lib/building/schema";
import { buildMassingModel, massingMetrics, wallPanels } from "@/lib/render/massing";

const building: Building = buildingSchema.parse({
  buildingSchemaVersion: 2,
  algorithmVersion: "test-v1",
  rulePackVersion: "rules-v1",
  rendererVersion: "cad-svg-v2",
  seed: 42,
  candidate: { generatorId: "fixture", index: 0, score: 1, geometryHash: "render-fixture-hash" },
  site: { widthMm: 12_000, depthMm: 18_000, facing: "south", roadEdges: ["south"], buildableEnvelope: { x: 1000, y: 1000, width: 10_000, depth: 16_000 } },
  floors: [0, 1].map((level) => ({
    id: `F${level}`,
    label: level === 0 ? "Ground floor" : "First floor",
    level,
    elevationMm: level * 3100,
    floorHeightMm: 3100,
    envelope: { x: 1000, y: 1000, width: 10_000, depth: 16_000 },
    spaces: [
      { id: `living-${level}`, floorId: `F${level}`, name: "Living", type: "living", planningCellPolygon: rectanglePolygon({ x: 1000, y: 1000, width: 10_000, depth: 8000 }), bounds: { x: 1000, y: 1000, width: 10_000, depth: 8000 }, areaMm2: 80_000_000, occupied: true, accessible: level === 0 },
      { id: `stair-${level}`, floorId: `F${level}`, name: "Stair", type: "stair", planningCellPolygon: rectanglePolygon({ x: 1000, y: 9000, width: 2200, depth: 3200 }), bounds: { x: 1000, y: 9000, width: 2200, depth: 3200 }, areaMm2: 7_040_000, occupied: true, accessible: false },
    ],
    walls: [
      { id: `south-${level}`, floorId: `F${level}`, start: { x: 1000, y: 9000 }, end: { x: 11_000, y: 9000 }, thicknessMm: 230, type: "exterior", adjacentSpaceIds: [`living-${level}`] },
      { id: `internal-${level}`, floorId: `F${level}`, start: { x: 4000, y: 1000 }, end: { x: 4000, y: 9000 }, thicknessMm: 115, type: "interior", adjacentSpaceIds: [`living-${level}`, `stair-${level}`] },
    ],
    openings: [
      { id: `door-${level}`, floorId: `F${level}`, wallId: `south-${level}`, kind: "door", offsetMm: 1000, widthMm: 900, heightMm: 2100, sillHeightMm: 0, connects: ["EXTERIOR", `living-${level}`], hinge: "start", swing: "clockwise" },
      { id: `window-${level}`, floorId: `F${level}`, wallId: `south-${level}`, kind: "window", offsetMm: 4000, widthMm: 1800, heightMm: 1200, sillHeightMm: 900, connects: [`living-${level}`, "EXTERIOR"], hinge: "none", swing: "none" },
    ],
  })),
  verticalConnectors: [{
    id: "main-stair", kind: "dog_leg_stair", servedFloorIds: ["F0", "F1"],
    boundsByFloor: { F0: { x: 1000, y: 9000, width: 2200, depth: 3200 }, F1: { x: 1000, y: 9000, width: 2200, depth: 3200 } },
    widthMm: 1000, riseMm: 172, runMm: 280, direction: "south",
  }],
});

describe("deterministic massing model", () => {
  test("splits a wall around doors and windows without filling the openings", () => {
    const floor = building.floors[0];
    const wall = floor.walls[0];
    const panels = wallPanels(wall, floor.openings, floor.floorHeightMm);
    expect(panels).toContainEqual({ fromMm: 1000, toMm: 1900, bottomMm: 2100, topMm: 3100 });
    expect(panels).not.toContainEqual(expect.objectContaining({ fromMm: 1000, toMm: 1900, bottomMm: 0 }));
    expect(panels).toContainEqual({ fromMm: 4000, toMm: 5800, bottomMm: 0, topMm: 900 });
    expect(panels).toContainEqual({ fromMm: 4000, toMm: 5800, bottomMm: 2100, topMm: 3100 });
  });

  test("uses canonical elevations and keeps exploded floors aligned", () => {
    const model = buildMassingModel(building, { explodeM: 1.2 });
    const groundWall = model.primitives.find((primitive) => primitive.sourceId === "internal-0")!;
    const firstWall = model.primitives.find((primitive) => primitive.sourceId === "internal-1")!;
    expect(firstWall.center[0]).toBe(groundWall.center[0]);
    expect(firstWall.center[2]).toBe(groundWall.center[2]);
    expect(firstWall.center[1] - groundWall.center[1]).toBeCloseTo(4.3, 6);
    expect(model.primitives.filter((primitive) => primitive.kind === "stair").length).toBeGreaterThan(8);
  });

  test("supports floor isolation and optional analysis layers", () => {
    const model = buildMassingModel(building, { visibleFloorIds: ["F1"], includeInteriorWalls: false, includeSlabs: false, includeSite: false });
    expect(model.primitives.every((primitive) => primitive.floorId === "F1")).toBe(true);
    expect(model.primitives.some((primitive) => primitive.kind === "interior_wall")).toBe(false);
    expect(model.primitives.some((primitive) => primitive.kind === "slab" || primitive.kind === "site")).toBe(false);
  });

  test("can reveal the top-floor partitions without removing its floor slab", () => {
    const model = buildMassingModel(building, { visibleFloorIds: ["F1"], includeRoof: false });
    expect(model.primitives.some((primitive) => primitive.kind === "roof")).toBe(false);
    expect(model.primitives.some((primitive) => primitive.kind === "slab" && primitive.floorId === "F1")).toBe(true);
    expect(model.primitives.some((primitive) => primitive.kind === "interior_wall" && primitive.floorId === "F1")).toBe(true);
  });

  test("reports exact building-wide evidence", () => {
    expect(massingMetrics(building)).toEqual({ storeys: 2, heightM: 6.2, builtAreaM2: 320, openingCount: 4, stairAligned: true });
  });
});
