import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CadPlan } from "@/components/cad-plan/CadPlan";
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

  test("binds scheme identity and achieved-vs-target areas into the sheet", () => {
    const artifact = buildDrawing(building, {
      scheme: { name: "L-Court Villa · Scheme A", partiId: "l_court", style: "warm_minimal" },
      targetAreaByRoomId: { living: 60_000_000, bedroom: 30_000_000 },
    }).floors[0];
    expect(artifact.metadata).toMatchObject({ schemeName: "L-Court Villa · Scheme A", partiId: "l_court", style: "warm_minimal" });
    expect(artifact.areaSchedule).toEqual([
      expect.objectContaining({ roomId: "living", achievedAreaMm2: 48_000_000, targetAreaMm2: 60_000_000, underTarget: true }),
      expect.objectContaining({ roomId: "bedroom", achievedAreaMm2: 32_000_000, targetAreaMm2: 30_000_000, underTarget: false }),
    ]);
    const markup = renderToStaticMarkup(createElement(CadPlan, { artifact, projectName: "Villa study" }));
    expect(markup).toContain("L-COURT VILLA · SCHEME A");
    expect(markup).toContain("AREA SCHEDULE · ACHIEVED / TARGET");
    expect(markup).toContain("UNDER &gt;15%");
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
    const perimeterCompleteFloor = structuredClone(building.floors[0]);
    perimeterCompleteFloor.envelope.depth = 8_000;
    const floor = placeFloorOpenings(perimeterCompleteFloor, { entranceSide: "south", isGroundFloor: true });
    const sharedDoor = floor.openings.find((opening) => opening.wallId === "shared");
    expect(sharedDoor?.connects).toEqual(["living", "bedroom"]);
    expect(sharedDoor?.swing).toBe("counterclockwise");
  });

  test("marks a verandah with an open-edge hatch and omits its perimeter wall", () => {
    const withVerandah = structuredClone(building);
    const floor = withVerandah.floors[0];
    floor.spaces.push({
      id: "front-verandah",
      floorId: "F0",
      name: "Front verandah",
      type: "verandah",
      planningCellPolygon: rectanglePolygon({ x: 1_000, y: 9_000, width: 10_000, depth: 2_000 }),
      bounds: { x: 1_000, y: 9_000, width: 10_000, depth: 2_000 },
      areaMm2: 20_000_000,
      occupied: false,
      accessible: false,
    });
    floor.walls[1].adjacentSpaceIds = ["living", "front-verandah"];
    floor.walls.push({
      id: "verandah-open-edge",
      floorId: "F0",
      start: { x: 1_000, y: 11_000 },
      end: { x: 11_000, y: 11_000 },
      thicknessMm: 230,
      type: "exterior",
      adjacentSpaceIds: ["front-verandah"],
    });
    floor.openings.push({
      id: "verandah-entry",
      floorId: "F0",
      wallId: "verandah-open-edge",
      kind: "open_connection",
      usage: "pedestrian",
      offsetMm: 4_500,
      widthMm: 1_000,
      heightMm: 2_100,
      sillHeightMm: 0,
      connects: ["EXTERIOR", "front-verandah"],
      hinge: "none",
      swing: "none",
    });

    const drawing = buildDrawing(withVerandah).floors[0];
    expect(drawing.rooms.find((room) => room.id === "front-verandah")).toEqual(expect.objectContaining({
      zone: "outdoor",
      edgeTreatment: "open",
    }));
    expect(drawing.walls.some((wall) => wall.id === "verandah-open-edge")).toBe(false);
    expect(drawing.walls.some((wall) => wall.id === "south-wall")).toBe(true);
    expect(drawing.openings.find((opening) => opening.id === "verandah-entry")?.isEntrance).toBe(true);

    const svg = renderToStaticMarkup(createElement(CadPlan, {
      artifact: drawing,
      layers: visibilityForPreset("presentation"),
    }));
    expect(svg).toContain('data-edge-treatment="open"');
    expect(svg).toContain('stroke-dasharray="180 120"');
    expect(svg).toContain("-open-edge");
    expect(svg).toContain("MAIN ENTRY");

    const closedUpperBay = structuredClone(withVerandah);
    const closedSpace = closedUpperBay.floors[0].spaces.find((space) => space.id === "front-verandah")!;
    closedSpace.perimeterOpen = false;
    closedUpperBay.floors[0].openings = closedUpperBay.floors[0].openings.filter((opening) => opening.id !== "verandah-entry");
    const closedDrawing = buildDrawing(closedUpperBay).floors[0];
    expect(closedDrawing.rooms.find((room) => room.id === "front-verandah")?.edgeTreatment).toBeUndefined();
    expect(closedDrawing.walls.some((wall) => wall.id === "verandah-open-edge")).toBe(true);
  });
});
