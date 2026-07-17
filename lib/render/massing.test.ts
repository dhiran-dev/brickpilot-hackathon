import { describe, expect, test } from "bun:test";

import { buildingSchema, rectanglePolygon, type Building } from "@/lib/building/schema";
import {
  buildMassingModel,
  MASSING_GRID_Y_M,
  MASSING_SITE_GRADE_M,
  massingMetrics,
  SLAB_THICKNESS_M,
  wallPanels,
} from "@/lib/render/massing";

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

function replaceSpaceBounds(
  target: Building,
  floorId: string,
  spaceId: string,
  bounds: { x: number; y: number; width: number; depth: number },
) {
  const space = target.floors.find((floor) => floor.id === floorId)?.spaces.find((candidate) => candidate.id === spaceId);
  if (!space) throw new Error(`Missing test space ${floorId}/${spaceId}`);
  space.bounds = bounds;
  space.planningCellPolygon = rectanglePolygon(bounds);
  space.areaMm2 = bounds.width * bounds.depth;
  return space;
}

function addOpenSpace(
  target: Building,
  floorId: string,
  id: string,
  type: "courtyard" | "terrace",
  bounds: { x: number; y: number; width: number; depth: number },
) {
  const floor = target.floors.find((candidate) => candidate.id === floorId);
  if (!floor) throw new Error(`Missing test floor ${floorId}`);
  floor.spaces.push({
    id,
    floorId,
    name: type === "courtyard" ? "Coordinated court void" : "Open terrace / unbuilt",
    type,
    planningCellPolygon: rectanglePolygon(bounds),
    bounds,
    areaMm2: bounds.width * bounds.depth,
    occupied: false,
    accessible: false,
  });
}

function planAreaM2(primitives: ReturnType<typeof buildMassingModel>["primitives"]) {
  return primitives.reduce((sum, primitive) => sum + primitive.size[0] * primitive.size[2], 0);
}

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

  test("separates site grade, analysis grid and finished-floor surfaces", () => {
    const model = buildMassingModel(building);
    const site = model.primitives.find((primitive) => primitive.kind === "site")!;
    const groundSlab = model.primitives.find((primitive) => primitive.kind === "slab" && primitive.floorId === "F0")!;
    const siteTop = site.center[1] + site.size[1] / 2;
    const finishedFloorTop = groundSlab.center[1] + groundSlab.size[1] / 2;

    expect(siteTop).toBeCloseTo(MASSING_SITE_GRADE_M, 8);
    expect(MASSING_GRID_Y_M).toBeGreaterThan(siteTop);
    expect(MASSING_GRID_Y_M).toBeLessThan(finishedFloorTop);
    expect(finishedFloorTop - MASSING_GRID_Y_M).toBeGreaterThan(0.01);
  });

  test("supports floor isolation and optional analysis layers", () => {
    const model = buildMassingModel(building, { visibleFloorIds: ["F1"], includeInteriorWalls: false, includeSlabs: false, includeSite: false });
    expect(model.primitives.every((primitive) => primitive.floorId === "F1")).toBe(true);
    expect(model.primitives.some((primitive) => primitive.kind === "interior_wall")).toBe(false);
    expect(model.primitives.some((primitive) => primitive.kind === "slab" || primitive.kind === "site")).toBe(false);
    expect(model.primitives.some((primitive) => primitive.kind === "roof")).toBe(true);
  });

  test("keeps structural columns independent from the internal-wall layer", () => {
    const withColumns = structuredClone(building);
    withColumns.structuralConcept = {
      structuralConceptVersion: 1,
      scope: "conceptual_column_coordination_only",
      disclaimer: "Conceptual column coordination only; member sizing, loads, foundations and code compliance require a licensed structural engineer.",
      baselineMaxBayMm: 6_000,
      axes: [],
      columns: [{ id: "column-a", center: { x: 2_000, y: 2_000 }, widthMm: 300, depthMm: 300, servedFloorIds: ["F0", "F1"] }],
    };

    const wallsOff = buildMassingModel(withColumns, { includeInteriorWalls: false });
    expect(wallsOff.primitives.some((primitive) => primitive.kind === "interior_wall")).toBe(false);
    expect(wallsOff.primitives.filter((primitive) => primitive.kind === "column")).toHaveLength(2);

    const columnsOff = buildMassingModel(withColumns, { includeColumns: false });
    expect(columnsOff.primitives.some((primitive) => primitive.kind === "column")).toBe(false);
  });

  test("can reveal the top-floor partitions without removing its floor slab", () => {
    const model = buildMassingModel(building, { visibleFloorIds: ["F1"], includeRoof: false });
    expect(model.primitives.some((primitive) => primitive.kind === "roof")).toBe(false);
    expect(model.primitives.some((primitive) => primitive.kind === "slab" && primitive.floorId === "F1")).toBe(true);
    expect(model.primitives.some((primitive) => primitive.kind === "interior_wall" && primitive.floorId === "F1")).toBe(true);
  });

  test("treats open terraces as real massing recesses instead of roofing the full rectangle", () => {
    const articulated = structuredClone(building);
    const floor = articulated.floors[1];
    floor.spaces.push({
      id: "terrace-1",
      floorId: "F1",
      name: "Open terrace / unbuilt",
      type: "terrace",
      planningCellPolygon: rectanglePolygon({ x: 8000, y: 9000, width: 3000, depth: 3000 }),
      bounds: { x: 8000, y: 9000, width: 3000, depth: 3000 },
      areaMm2: 9_000_000,
      occupied: false,
      accessible: false,
    });
    floor.walls.push({ id: "terrace-boundary", floorId: "F1", start: { x: 8000, y: 9000 }, end: { x: 8000, y: 12_000 }, thicknessMm: 115, type: "interior", adjacentSpaceIds: ["living-1", "terrace-1"] });
    const model = buildMassingModel(articulated);
    expect(model.primitives.some((primitive) => primitive.kind === "slab" && primitive.sourceId === "terrace-1")).toBe(false);
    expect(model.primitives.some((primitive) => primitive.kind === "roof" && primitive.sourceId === "terrace-1")).toBe(false);
    expect(model.primitives.some((primitive) => primitive.kind === "exterior_wall" && primitive.sourceId === "terrace-boundary")).toBe(true);
  });

  test("caps a covered lower room beneath an upper-floor open terrace", () => {
    const articulated = structuredClone(building);
    const livingBounds = { ...articulated.floors[0].spaces.find((space) => space.id === "living-0")!.bounds };
    const upperLiving = articulated.floors[1].spaces.find((space) => space.id === "living-1")!;
    articulated.floors[1].spaces = articulated.floors[1].spaces.filter((space) => space.id !== upperLiving.id);
    addOpenSpace(articulated, "F1", "terrace-over-living", "terrace", livingBounds);

    const roofs = buildMassingModel(articulated).primitives.filter((primitive) => (
      primitive.kind === "roof" && primitive.floorId === "F0" && primitive.sourceId === "living-0"
    ));

    expect(roofs).toHaveLength(1);
    expect(planAreaM2(roofs)).toBeCloseTo(80, 8);
    expect(roofs[0].center[1]).toBeCloseTo(3.1 + SLAB_THICKNESS_M / 2, 8);
  });

  test("decomposes only the partially exposed lower footprint into capping roofs", () => {
    const articulated = structuredClone(building);
    replaceSpaceBounds(articulated, "F1", "living-1", { x: 1_000, y: 1_000, width: 6_000, depth: 8_000 });
    addOpenSpace(articulated, "F1", "terrace-over-living", "terrace", { x: 7_000, y: 1_000, width: 4_000, depth: 8_000 });

    const roofs = buildMassingModel(articulated).primitives.filter((primitive) => (
      primitive.kind === "roof" && primitive.floorId === "F0" && primitive.sourceId === "living-0"
    ));

    expect(planAreaM2(roofs)).toBeCloseTo(32, 8);
    expect(roofs).toEqual([
      expect.objectContaining({ center: [3, 3.19, -4], size: [4, SLAB_THICKNESS_M, 8] }),
    ]);
  });

  test("keeps a vertically aligned courtyard open through every floor", () => {
    const withCourt = structuredClone(building);
    const courtBounds = { x: 7_000, y: 1_000, width: 4_000, depth: 8_000 };
    replaceSpaceBounds(withCourt, "F0", "living-0", { x: 1_000, y: 1_000, width: 6_000, depth: 8_000 });
    replaceSpaceBounds(withCourt, "F1", "living-1", { x: 1_000, y: 1_000, width: 6_000, depth: 8_000 });
    addOpenSpace(withCourt, "F0", "court-0", "courtyard", courtBounds);
    addOpenSpace(withCourt, "F1", "court-1", "courtyard", courtBounds);

    const courtyardCaps = buildMassingModel(withCourt).primitives.filter((primitive) => (
      primitive.kind === "roof"
      && primitive.center[0] === 3
      && primitive.center[2] === -4
      && primitive.size[0] === 4
      && primitive.size[2] === 8
    ));

    expect(courtyardCaps).toHaveLength(0);
  });

  test("roofs a verandah canopy while leaving its perimeter edge physically open", () => {
    const withVerandah = structuredClone(building);
    const floor = withVerandah.floors[1];
    floor.spaces.push({
      id: "verandah-1",
      floorId: "F1",
      name: "Front verandah",
      type: "verandah",
      planningCellPolygon: rectanglePolygon({ x: 4_000, y: 9_000, width: 7_000, depth: 3_000 }),
      bounds: { x: 4_000, y: 9_000, width: 7_000, depth: 3_000 },
      areaMm2: 21_000_000,
      occupied: false,
      accessible: false,
    });
    floor.walls.push(
      { id: "verandah-facade", floorId: "F1", start: { x: 4_000, y: 9_000 }, end: { x: 11_000, y: 9_000 }, thicknessMm: 230, type: "exterior", adjacentSpaceIds: ["living-1", "verandah-1"] },
      { id: "verandah-open-edge", floorId: "F1", start: { x: 4_000, y: 12_000 }, end: { x: 11_000, y: 12_000 }, thicknessMm: 230, type: "exterior", adjacentSpaceIds: ["verandah-1"] },
    );

    const model = buildMassingModel(withVerandah);
    expect(model.primitives.some((primitive) => primitive.kind === "slab" && primitive.sourceId === "verandah-1")).toBe(true);
    expect(model.primitives.some((primitive) => primitive.kind === "roof" && primitive.sourceId === "verandah-1")).toBe(true);
    expect(model.primitives.some((primitive) => primitive.sourceId === "verandah-facade")).toBe(true);
    expect(model.primitives.some((primitive) => primitive.sourceId === "verandah-open-edge")).toBe(false);

    const closedUpperBay = structuredClone(withVerandah);
    closedUpperBay.floors[1].spaces.find((space) => space.id === "verandah-1")!.perimeterOpen = false;
    const closedModel = buildMassingModel(closedUpperBay);
    expect(closedModel.primitives.some((primitive) => primitive.sourceId === "verandah-open-edge")).toBe(true);
  });

  test("normalizes legacy t-hub upper facade bays to the persisted closed role", () => {
    const legacy = structuredClone(building);
    legacy.candidate.generatorId = "t-hub";
    const upper = legacy.floors[1];
    const upperLiving = upper.spaces.find((space) => space.id === "living-1")!;
    upperLiving.id = "F1-covered-gallery";
    upperLiving.type = "verandah";
    upperLiving.occupied = false;
    delete upperLiving.perimeterOpen;
    for (const wall of upper.walls) {
      wall.adjacentSpaceIds = wall.adjacentSpaceIds.map((id) => id === "living-1" ? upperLiving.id : id);
    }

    const parsed = buildingSchema.parse(legacy);
    expect(parsed.floors[1].spaces.find((space) => space.id === upperLiving.id)?.perimeterOpen).toBe(false);
    expect(parsed.candidate.geometryHash).toBe(`${legacy.candidate.geometryHash}-perimeter-v1`);
  });

  test("fills window and door openings with glass panes and door leaves", () => {
    const model = buildMassingModel(building);
    const glass = model.primitives.filter((primitive) => primitive.kind === "window_glass");
    const leaves = model.primitives.filter((primitive) => primitive.kind === "door_leaf");
    expect(glass).toHaveLength(2);
    expect(leaves).toHaveLength(2);

    const groundGlass = glass.find((primitive) => primitive.sourceId === "window-0")!;
    expect(groundGlass.floorId).toBe("F0");
    expect(groundGlass.center[0]).toBeCloseTo(-0.1, 6);   // wall x 1000 + (4000+5800)/2 = 5900 → −0.1
    expect(groundGlass.center[1]).toBeCloseTo(1.5, 6);    // (900+2100)/2 mm
    expect(groundGlass.center[2]).toBeCloseTo(0, 6);
    expect(groundGlass.size[0]).toBeCloseTo(1.8, 6);
    expect(groundGlass.size[1]).toBeCloseTo(1.2, 6);
    expect(groundGlass.size[2]).toBeCloseTo(0.23 * 0.35, 6); // thin pane, 35% of wall thickness

    const groundLeaf = leaves.find((primitive) => primitive.sourceId === "door-0")!;
    expect(groundLeaf.center[0]).toBeCloseTo(-3.55, 6);   // wall x 1000 + (1000+1900)/2 = 2450 → −3.55
    expect(groundLeaf.center[1]).toBeCloseTo(1.05, 6);
    expect(groundLeaf.size[1]).toBeCloseTo(2.1, 6);
    expect(groundLeaf.size[2]).toBeCloseTo(0.23 * 0.7, 6); // thicker leaf, 70% of wall thickness

    const firstFloorGlass = glass.find((primitive) => primitive.sourceId === "window-1")!;
    expect(firstFloorGlass.center[1]).toBeCloseTo(3.1 + 1.5, 6); // rides the floor's baseY
  });

  test("does not fill vehicle openings with glass or door leaves", () => {
    const withVehicle = structuredClone(building);
    withVehicle.floors[0].openings.push({
      id: "vehicle-0", floorId: "F0", wallId: "south-0", kind: "open_connection", usage: "vehicle",
      offsetMm: 7000, widthMm: 2400, heightMm: 2400, sillHeightMm: 0,
      connects: ["EXTERIOR", "living-0"], hinge: "none", swing: "none",
    });
    const model = buildMassingModel(withVehicle);
    expect(model.primitives.some((primitive) =>
      (primitive.kind === "window_glass" || primitive.kind === "door_leaf") && primitive.sourceId === "vehicle-0",
    )).toBe(false);
  });

  test("leaves non-vehicle open connections unfilled", () => {
    const withPassThrough = structuredClone(building);
    withPassThrough.floors[0].openings.push({
      id: "arch-0", floorId: "F0", wallId: "internal-0", kind: "open_connection",
      offsetMm: 2000, widthMm: 1500, heightMm: 2400, sillHeightMm: 0,
      connects: ["living-0", "stair-0"], hinge: "none", swing: "none",
    });
    const model = buildMassingModel(withPassThrough);
    expect(model.primitives.some((primitive) => primitive.sourceId === "arch-0")).toBe(false);
  });

  test("adds a glass parapet on fully open terrace perimeter edges only", () => {
    const articulated = structuredClone(building);
    addOpenSpace(articulated, "F1", "terrace-1", "terrace", { x: 8000, y: 9000, width: 3000, depth: 3000 });
    articulated.floors[1].walls.push(
      { id: "terrace-boundary", floorId: "F1", start: { x: 8000, y: 9000 }, end: { x: 8000, y: 12_000 }, thicknessMm: 115, type: "interior", adjacentSpaceIds: ["living-1", "terrace-1"] },
      { id: "terrace-open-edge", floorId: "F1", start: { x: 8000, y: 12_000 }, end: { x: 11_000, y: 12_000 }, thicknessMm: 230, type: "exterior", adjacentSpaceIds: ["terrace-1"] },
    );
    const model = buildMassingModel(articulated);

    const parapets = model.primitives.filter((primitive) => primitive.kind === "parapet");
    expect(parapets).toHaveLength(1);
    expect(parapets[0].sourceId).toBe("terrace-open-edge");
    expect(parapets[0].floorId).toBe("F1");
    expect(parapets[0].size[1]).toBeCloseTo(1, 8);                    // ~1.0 m tall
    expect(parapets[0].center[1]).toBeCloseTo(3.1 + 0.5, 8);          // base at the floor's baseY
    expect(parapets[0].size[0]).toBeCloseTo(3, 8);                    // same footprint as the skipped wall
    expect(parapets[0].size[2]).toBeCloseTo(0.23, 8);
    // the mixed wall still becomes a solid exterior wall, not a parapet
    expect(model.primitives.some((primitive) => primitive.kind === "exterior_wall" && primitive.sourceId === "terrace-boundary")).toBe(true);
    expect(model.primitives.some((primitive) => primitive.kind !== "parapet" && primitive.sourceId === "terrace-open-edge")).toBe(false);
  });

  test("reports exact building-wide evidence", () => {
    expect(massingMetrics(building)).toEqual({ storeys: 2, heightM: 6.2, builtAreaM2: 174.08, openingCount: 4, stairAligned: true, columnCount: 0 });
  });
});
