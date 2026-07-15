import { describe, expect, test } from "bun:test";

import { buildingSchema, rectanglePolygon, type Building } from "@/lib/building/schema";
import { placeFloorOpenings } from "@/lib/building/openings";
import { buildDrawing } from "@/lib/drawing/build-drawing";
import { DRAWING_LAYER_DEFINITIONS, visibilityForPreset } from "@/lib/drawing/schema";

const building: Building = buildingSchema.parse({
  buildingSchemaVersion: 2,
  algorithmVersion: "test-v1",
  rulePackVersion: "rules-v1",
  rendererVersion: "cad-svg-v2",
  seed: 42,
  candidate: { generatorId: "fixture", index: 0, score: 1, geometryHash: "fixture-hash" },
  site: { widthMm: 12_000, depthMm: 18_000, facing: "south", roadEdges: ["south"], buildableEnvelope: { x: 1000, y: 1000, width: 10_000, depth: 16_000 } },
  floors: [{
    id: "F0",
    label: "Ground floor",
    level: 0,
    elevationMm: 0,
    floorHeightMm: 3100,
    envelope: { x: 1000, y: 1000, width: 10_000, depth: 16_000 },
    spaces: [
      { id: "living", floorId: "F0", name: "Living", type: "living", planningCellPolygon: rectanglePolygon({ x: 1000, y: 1000, width: 6000, depth: 8000 }), bounds: { x: 1000, y: 1000, width: 6000, depth: 8000 }, areaMm2: 48_000_000, occupied: true, accessible: true },
      { id: "bedroom", floorId: "F0", name: "Bedroom", type: "bedroom", planningCellPolygon: rectanglePolygon({ x: 7000, y: 1000, width: 4000, depth: 8000 }), bounds: { x: 7000, y: 1000, width: 4000, depth: 8000 }, areaMm2: 32_000_000, occupied: true, accessible: false },
    ],
    walls: [
      { id: "shared", floorId: "F0", start: { x: 7000, y: 1000 }, end: { x: 7000, y: 9000 }, thicknessMm: 150, type: "interior", adjacentSpaceIds: ["living", "bedroom"] },
      { id: "south-wall", floorId: "F0", start: { x: 1000, y: 9000 }, end: { x: 11_000, y: 9000 }, thicknessMm: 230, type: "exterior", adjacentSpaceIds: ["living"] },
    ],
    openings: [
      { id: "door-living-bedroom", floorId: "F0", wallId: "shared", kind: "door", offsetMm: 1200, widthMm: 900, heightMm: 2100, sillHeightMm: 0, connects: ["living", "bedroom"], hinge: "start", swing: "clockwise" },
      { id: "living-window", floorId: "F0", wallId: "south-wall", kind: "window", offsetMm: 1200, widthMm: 1800, heightMm: 1200, sillHeightMm: 900, connects: ["living", "EXTERIOR"], hinge: "none", swing: "none" },
    ],
  }],
  verticalConnectors: [],
});

describe("drawing artifact", () => {
  test("derives stable primitives from the canonical building", () => {
    const first = buildDrawing(building);
    const second = buildDrawing(building);
    expect(first).toEqual(second);
    expect(first.floors[0].rooms).toHaveLength(2);
    expect(first.floors[0].walls).toHaveLength(2);
    expect(first.floors[0].openings.map((opening) => opening.kind)).toEqual(["door", "window"]);
    expect(first.floors[0].dimensions.overall).toHaveLength(4);
    expect(first.floors[0].metadata.seed).toBe(42);
    expect(first.floors[0].roadEdges).toEqual(["south"]);
  });

  test("provides a complete independent layer state for every preset", () => {
    for (const preset of ["presentation", "architectural", "validation", "print"] as const) {
      const visibility = visibilityForPreset(preset);
      expect(Object.keys(visibility).sort()).toEqual(DRAWING_LAYER_DEFINITIONS.map((layer) => layer.id).sort());
    }
    expect(visibilityForPreset("presentation").zoning).toBe(true);
    expect(visibilityForPreset("print").zoning).toBe(false);
    expect(visibilityForPreset("architectural")["dimensions-internal"]).toBe(false);
  });

  test("reserves a separate south-road corridor before annotation bands", () => {
    const floor = buildDrawing(building).floors[0];
    const road = floor.roadCorridors.find((candidate) => candidate.edge === "south");
    expect(road).toBeDefined();
    const siteBottom = floor.siteBounds.y + floor.siteBounds.depth;
    const roadBottom = road!.bounds.y + road!.bounds.depth;
    expect(road!.bounds.y).toBeGreaterThan(siteBottom + 1100);
    expect(floor.annotationLayout.scaleOrigin.y).toBeGreaterThanOrEqual(roadBottom + 700);
    expect(floor.annotationLayout.legendOrigin.y).toBeGreaterThan(floor.annotationLayout.scaleOrigin.y + 480);
    expect(floor.annotationLayout.titleY).toBeGreaterThan(floor.annotationLayout.legendOrigin.y + 860);
    expect(floor.viewBox.y + floor.viewBox.depth).toBeGreaterThan(floor.annotationLayout.titleY + floor.annotationLayout.titleHeight);
  });

  test("keeps every configured road corridor inside the padded sheet viewBox", () => {
    const multiRoadBuilding = structuredClone(building);
    multiRoadBuilding.site.roadEdges = ["north", "east", "south", "west"];
    const floor = buildDrawing(multiRoadBuilding).floors[0];
    const viewRight = floor.viewBox.x + floor.viewBox.width;
    const viewBottom = floor.viewBox.y + floor.viewBox.depth;
    for (const road of floor.roadCorridors) {
      expect(road.bounds.x).toBeGreaterThanOrEqual(floor.viewBox.x + 200);
      expect(road.bounds.y).toBeGreaterThanOrEqual(floor.viewBox.y + 200);
      expect(road.bounds.x + road.bounds.width).toBeLessThanOrEqual(viewRight - 200);
      expect(road.bounds.y + road.bounds.depth).toBeLessThanOrEqual(viewBottom - 200);
    }
  });

  test("maps structured validation findings to exact objects", () => {
    const drawing = buildDrawing(building, { findings: [{ ruleId: "ROOM_MIN_AREA", severity: "warning", message: "Bedroom is below target.", floorId: "F0", objectIds: ["bedroom"] }] });
    expect(drawing.floors[0].findings[0].point).toEqual({ x: 9000, y: 5000 });
  });

  test("normalizes stale door swings and does not draw a route to every occupied room", () => {
    const floor = buildDrawing(building).floors[0];
    const door = floor.openings.find((opening) => opening.kind === "door");
    expect(door?.hingePoint).toEqual({ x: 7000, y: 2200 });
    expect(door?.swing).toBe("counterclockwise");
    expect(door?.leafPoint).toEqual({ x: 7900, y: 2200 });
    expect(floor.routes).toEqual([]);
  });

  test("marks the main entry and draws a deduplicated route only to circulation targets", () => {
    const routedBuilding = structuredClone(building);
    routedBuilding.floors[0].spaces[0].type = "foyer";
    routedBuilding.floors[0].spaces[1].type = "stair";
    routedBuilding.floors[0].openings.push({
      id: "main-entry",
      floorId: "F0",
      wallId: "south-wall",
      kind: "door",
      offsetMm: 4200,
      widthMm: 900,
      heightMm: 2100,
      sillHeightMm: 0,
      connects: ["EXTERIOR", "living"],
      hinge: "start",
      swing: "clockwise",
    });
    const floor = buildDrawing(routedBuilding).floors[0];
    expect(floor.openings.find((opening) => opening.id === "main-entry")?.isEntrance).toBe(true);
    expect(floor.routes).toHaveLength(1);
    expect(floor.routes[0].points).toEqual([{ x: 5650, y: 9000 }, { x: 7000, y: 2650 }]);
  });

  test("chooses a generated door swing toward the room being entered", () => {
    const floor = placeFloorOpenings(building.floors[0], { entranceSide: "south", isGroundFloor: true });
    const sharedDoor = floor.openings.find((opening) => opening.wallId === "shared");
    expect(sharedDoor?.connects).toEqual(["living", "bedroom"]);
    expect(sharedDoor?.swing).toBe("counterclockwise");
  });
});
