import type { Building, CurrentBuilding, CurrentFloor, Floor, Opening, ReadableBuilding, Rectangle, RoofSystem, WallSegment } from "@/lib/building/schema";
import { orthogonalPolygonAreaMm2, orthogonalPolygonBounds } from "@/lib/building/orthogonal-partition";
import { isCoveredSpace } from "@/lib/building/space-semantics";
import { isOpenToSkySpace, isVerandahOpenEdgeWall } from "@/lib/building/topology";

const MM_TO_M = 1 / 1000;
export const SLAB_THICKNESS_M = 0.18;
export const MASSING_SITE_GRADE_M = -0.02;
export const MASSING_SITE_THICKNESS_M = 0.05;
export const MASSING_GRID_Y_M = MASSING_SITE_GRADE_M + 0.004;

export type MassingPrimitiveKind = "site" | "slab" | "roof" | "exterior_wall" | "interior_wall" | "column" | "support" | "guard" | "pergola" | "stair" | "window_glass" | "door_leaf" | "parapet";
export type MassingSemanticKind = Exclude<MassingPrimitiveKind, "parapet">;

type MassingPrimitiveBase = {
  id: string;
  kind: MassingPrimitiveKind;
  semanticKind: MassingSemanticKind;
  floorId?: string;
  sourceId?: string;
  materialToken: string;
  /** Cached visual bounds in scene metres, shared by camera framing and every shape branch. */
  center: [number, number, number];
  size: [number, number, number];
};

export type MassingPrimitive = MassingPrimitiveBase & (
  | {
      shape: "box";
    }
  | {
      shape: "mesh";
      vertices: Array<[number, number, number]>;
      triangleIndices: number[];
    }
  | {
      shape: "linear_member";
      start: [number, number, number];
      end: [number, number, number];
      sectionMm: { width: number; depth: number };
    }
);

export type MassingBounds = {
  center: [number, number, number];
  size: [number, number, number];
};

export type MassingModel = {
  primitives: MassingPrimitive[];
  floorIds: string[];
  widthM: number;
  depthM: number;
  heightM: number;
  centre: [number, number, number];
};

export type MassingOptions = {
  visibleFloorIds?: string[];
  explodeM?: number;
  includeInteriorWalls?: boolean;
  includeSlabs?: boolean;
  includeRoof?: boolean;
  includeSite?: boolean;
  includeColumns?: boolean;
};

type WallPanel = { fromMm: number; toMm: number; bottomMm: number; topMm: number };

function clampOpening(opening: Opening, wallLengthMm: number, wallHeightMm: number) {
  const fromMm = Math.min(wallLengthMm, Math.max(0, opening.offsetMm));
  const toMm = Math.min(wallLengthMm, Math.max(fromMm, opening.offsetMm + opening.widthMm));
  const bottomMm = Math.min(wallHeightMm, Math.max(0, opening.sillHeightMm));
  const topMm = Math.min(wallHeightMm, Math.max(bottomMm, opening.sillHeightMm + opening.heightMm));
  return { fromMm, toMm, bottomMm, topMm };
}

export function wallPanels(wall: WallSegment, openings: Opening[], wallHeightMm: number): WallPanel[] {
  const wallLengthMm = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
  const sorted = openings
    .map((opening) => clampOpening(opening, wallLengthMm, wallHeightMm))
    .filter((opening) => opening.toMm > opening.fromMm && opening.topMm > opening.bottomMm)
    .sort((left, right) => left.fromMm - right.fromMm || left.toMm - right.toMm);
  const panels: WallPanel[] = [];
  let cursorMm = 0;
  for (const opening of sorted) {
    const fromMm = Math.max(cursorMm, opening.fromMm);
    if (fromMm > cursorMm) panels.push({ fromMm: cursorMm, toMm: fromMm, bottomMm: 0, topMm: wallHeightMm });
    if (opening.bottomMm > 0 && opening.toMm > fromMm) {
      panels.push({ fromMm, toMm: opening.toMm, bottomMm: 0, topMm: opening.bottomMm });
    }
    if (opening.topMm < wallHeightMm && opening.toMm > fromMm) {
      panels.push({ fromMm, toMm: opening.toMm, bottomMm: opening.topMm, topMm: wallHeightMm });
    }
    cursorMm = Math.max(cursorMm, opening.toMm);
  }
  if (cursorMm < wallLengthMm) panels.push({ fromMm: cursorMm, toMm: wallLengthMm, bottomMm: 0, topMm: wallHeightMm });
  return panels.filter((panel) => panel.toMm > panel.fromMm && panel.topMm > panel.bottomMm);
}

function planToScene(building: Pick<ReadableBuilding, "site">, xMm: number, yMm: number): [number, number] {
  return [(xMm - building.site.widthMm / 2) * MM_TO_M, (yMm - building.site.depthMm / 2) * MM_TO_M];
}

function rectanglePrimitive(
  building: Pick<ReadableBuilding, "site">,
  rectangle: Rectangle,
  id: string,
  kind: MassingPrimitiveKind,
  centreYM: number,
  heightM: number,
  floorId?: string,
  sourceId?: string,
): MassingPrimitive {
  const [x, z] = planToScene(building, rectangle.x + rectangle.width / 2, rectangle.y + rectangle.depth / 2);
  return {
    id, kind, semanticKind: kind === "parapet" ? "guard" : kind, floorId, sourceId,
    materialToken: `massing.${kind}`, shape: "box",
    center: [x, centreYM, z], size: [rectangle.width * MM_TO_M, heightM, rectangle.depth * MM_TO_M],
  };
}

function rectangleRight(rectangle: Rectangle) {
  return rectangle.x + rectangle.width;
}

function rectangleBottom(rectangle: Rectangle) {
  return rectangle.y + rectangle.depth;
}

/** Returns an exact, non-overlapping rectangle decomposition of subject minus cutter. */
function subtractRectangle(subject: Rectangle, cutter: Rectangle): Rectangle[] {
  const intersection = {
    x: Math.max(subject.x, cutter.x),
    y: Math.max(subject.y, cutter.y),
    right: Math.min(rectangleRight(subject), rectangleRight(cutter)),
    bottom: Math.min(rectangleBottom(subject), rectangleBottom(cutter)),
  };
  if (intersection.right <= intersection.x || intersection.bottom <= intersection.y) return [subject];

  const fragments: Rectangle[] = [];
  if (intersection.y > subject.y) {
    fragments.push({ x: subject.x, y: subject.y, width: subject.width, depth: intersection.y - subject.y });
  }
  if (intersection.bottom < rectangleBottom(subject)) {
    fragments.push({
      x: subject.x,
      y: intersection.bottom,
      width: subject.width,
      depth: rectangleBottom(subject) - intersection.bottom,
    });
  }
  const middleDepth = intersection.bottom - intersection.y;
  if (intersection.x > subject.x) {
    fragments.push({ x: subject.x, y: intersection.y, width: intersection.x - subject.x, depth: middleDepth });
  }
  if (intersection.right < rectangleRight(subject)) {
    fragments.push({
      x: intersection.right,
      y: intersection.y,
      width: rectangleRight(subject) - intersection.right,
      depth: middleDepth,
    });
  }
  return fragments;
}

function subtractRectangles(subject: Rectangle, cutters: Rectangle[]) {
  return cutters.reduce<Rectangle[]>(
    (fragments, cutter) => fragments.flatMap((fragment) => subtractRectangle(fragment, cutter)),
    [subject],
  );
}

function wallPrimitive(
  building: Pick<ReadableBuilding, "site">,
  floor: Pick<Floor, "id">,
  wall: WallSegment,
  panel: WallPanel,
  baseYM: number,
  index: number,
  kindOverride?: "exterior_wall" | "interior_wall",
): MassingPrimitive {
  const dx = wall.end.x - wall.start.x;
  const dz = wall.end.y - wall.start.y;
  const lengthMm = Math.hypot(dx, dz);
  const ux = dx / lengthMm;
  const uz = dz / lengthMm;
  const midpointMm = (panel.fromMm + panel.toMm) / 2;
  const [x, z] = planToScene(building, wall.start.x + ux * midpointMm, wall.start.y + uz * midpointMm);
  const horizontal = Math.abs(dx) >= Math.abs(dz);
  const panelLengthM = (panel.toMm - panel.fromMm) * MM_TO_M;
  const panelHeightM = (panel.topMm - panel.bottomMm) * MM_TO_M;
  const thicknessM = wall.thicknessMm * MM_TO_M;
  return {
    id: `${wall.id}-panel-${index}`,
    kind: kindOverride ?? (wall.type === "exterior" ? "exterior_wall" : "interior_wall"),
    semanticKind: kindOverride ?? (wall.type === "exterior" ? "exterior_wall" : "interior_wall"),
    materialToken: wall.type === "exterior" ? "wall.exterior.base" : "wall.interior.base",
    shape: "box",
    floorId: floor.id,
    sourceId: wall.id,
    center: [x, baseYM + (panel.bottomMm + panel.topMm) * MM_TO_M / 2, z],
    size: horizontal ? [panelLengthM, panelHeightM, thicknessM] : [thicknessM, panelHeightM, panelLengthM],
  };
}

const WINDOW_PANE_THICKNESS_RATIO = 0.35;
const DOOR_LEAF_THICKNESS_RATIO = 0.7;

function openingFillPrimitive(
  building: Pick<ReadableBuilding, "site">,
  floor: Pick<Floor, "id" | "floorHeightMm">,
  wall: WallSegment,
  opening: Opening,
  baseYM: number,
  kind: "window_glass" | "door_leaf",
): MassingPrimitive | null {
  const dx = wall.end.x - wall.start.x;
  const dz = wall.end.y - wall.start.y;
  const lengthMm = Math.hypot(dx, dz);
  const clamped = clampOpening(opening, lengthMm, floor.floorHeightMm);
  if (clamped.toMm <= clamped.fromMm || clamped.topMm <= clamped.bottomMm) return null;
  const ux = dx / lengthMm;
  const uz = dz / lengthMm;
  const midpointMm = (clamped.fromMm + clamped.toMm) / 2;
  const [x, z] = planToScene(building, wall.start.x + ux * midpointMm, wall.start.y + uz * midpointMm);
  const horizontal = Math.abs(dx) >= Math.abs(dz);
  const fillLengthM = (clamped.toMm - clamped.fromMm) * MM_TO_M;
  const fillHeightM = (clamped.topMm - clamped.bottomMm) * MM_TO_M;
  const thicknessM = wall.thicknessMm * MM_TO_M * (kind === "window_glass" ? WINDOW_PANE_THICKNESS_RATIO : DOOR_LEAF_THICKNESS_RATIO);
  return {
    id: `${opening.id}-fill`,
    kind,
    semanticKind: kind,
    materialToken: `massing.${kind}`,
    shape: "box",
    floorId: floor.id,
    sourceId: opening.id,
    center: [x, baseYM + (clamped.bottomMm + clamped.topMm) * MM_TO_M / 2, z],
    size: horizontal ? [fillLengthM, fillHeightM, thicknessM] : [thicknessM, fillHeightM, fillLengthM],
  };
}

const PARAPET_HEIGHT_M = 1.0;

/** Glass guard on a fully open-to-sky perimeter edge: same footprint and axis as the skipped wall, base at the floor top. */
function parapetPrimitive(building: Building, floor: Floor, wall: WallSegment, baseYM: number): MassingPrimitive {
  const dx = wall.end.x - wall.start.x;
  const dz = wall.end.y - wall.start.y;
  const [x, z] = planToScene(building, (wall.start.x + wall.end.x) / 2, (wall.start.y + wall.end.y) / 2);
  const horizontal = Math.abs(dx) >= Math.abs(dz);
  const lengthM = Math.hypot(dx, dz) * MM_TO_M;
  const thicknessM = wall.thicknessMm * MM_TO_M;
  return {
    id: `${wall.id}-parapet`,
    kind: "parapet",
    semanticKind: "guard",
    materialToken: "guard.glass",
    shape: "box",
    floorId: floor.id,
    sourceId: wall.id,
    center: [x, baseYM + PARAPET_HEIGHT_M / 2, z],
    size: horizontal ? [lengthM, PARAPET_HEIGHT_M, thicknessM] : [thicknessM, PARAPET_HEIGHT_M, lengthM],
  };
}

const CARPORT_COLUMN_SIZE_MM = 250;

/** Two square columns flanking a vehicle opening, spanning the full floor height. */
function carportColumnPrimitives(building: Building, floor: Floor, wall: WallSegment, opening: Opening, baseYM: number): MassingPrimitive[] {
  const dx = wall.end.x - wall.start.x;
  const dz = wall.end.y - wall.start.y;
  const lengthMm = Math.hypot(dx, dz);
  const clamped = clampOpening(opening, lengthMm, floor.floorHeightMm);
  if (clamped.toMm <= clamped.fromMm) return [];
  const ux = dx / lengthMm;
  const uz = dz / lengthMm;
  const heightM = floor.floorHeightMm * MM_TO_M;
  const sizeM = CARPORT_COLUMN_SIZE_MM * MM_TO_M;
  return [clamped.fromMm, clamped.toMm].map((alongMm, index) => {
    const [x, z] = planToScene(building, wall.start.x + ux * alongMm, wall.start.y + uz * alongMm);
    return {
      id: `${opening.id}-carport-column-${index}`,
      kind: "column" as const,
      semanticKind: "column" as const,
      materialToken: "column.concrete",
      shape: "box" as const,
      floorId: floor.id,
      sourceId: opening.id,
      center: [x, baseYM + heightM / 2, z] as [number, number, number],
      size: [sizeM, heightM, sizeM] as [number, number, number],
    };
  });
}

function stairPrimitives(building: Building, floor: Floor, explodeYM: number): MassingPrimitive[] {
  const connector = building.verticalConnectors.find((candidate) => candidate.servedFloorIds.includes(floor.id));
  const bounds = connector?.boundsByFloor[floor.id];
  if (!connector || !bounds) return [];
  const orderedFloors = [...building.floors].sort((left, right) => left.level - right.level);
  if (floor.id === orderedFloors.at(-1)?.id) return [];
  const stepCount = Math.max(8, Math.min(20, Math.round(floor.floorHeightMm / connector.riseMm)));
  const directionAlongX = connector.direction === "east" || connector.direction === "west";
  const ascendingPositive = connector.direction === "east" || connector.direction === "south";
  const runLengthMm = directionAlongX ? bounds.width : bounds.depth;
  const crossWidthMm = Math.min(connector.widthMm, directionAlongX ? bounds.depth : bounds.width);
  return Array.from({ length: stepCount }, (_, index) => {
    const treadMm = runLengthMm / stepCount;
    const alongMm = ascendingPositive ? (index + 0.5) * treadMm : runLengthMm - (index + 0.5) * treadMm;
    const xMm = directionAlongX ? bounds.x + alongMm : bounds.x + bounds.width / 2;
    const zMm = directionAlongX ? bounds.y + bounds.depth / 2 : bounds.y + alongMm;
    const [x, z] = planToScene(building, xMm, zMm);
    const heightM = ((index + 1) * floor.floorHeightMm / stepCount) * MM_TO_M;
    return {
      id: `${connector.id}-${floor.id}-step-${index}`,
      kind: "stair" as const,
      semanticKind: "stair" as const,
      materialToken: "stair.concrete",
      shape: "box" as const,
      floorId: floor.id,
      sourceId: connector.id,
      center: [x, floor.elevationMm * MM_TO_M + explodeYM + heightM / 2, z] as [number, number, number],
      size: directionAlongX
        ? [treadMm * MM_TO_M, heightM, crossWidthMm * MM_TO_M]
        : [crossWidthMm * MM_TO_M, heightM, treadMm * MM_TO_M] as [number, number, number],
    };
  });
}

function buildLegacyMassingModel(building: Building, options: MassingOptions = {}): MassingModel {
  const visible = new Set(options.visibleFloorIds ?? building.floors.map((floor) => floor.id));
  const explodeM = Math.max(0, options.explodeM ?? 0);
  const includeInteriorWalls = options.includeInteriorWalls ?? true;
  const includeSlabs = options.includeSlabs ?? true;
  const includeRoof = options.includeRoof ?? true;
  const includeSite = options.includeSite ?? true;
  const includeColumns = options.includeColumns ?? true;
  const primitives: MassingPrimitive[] = [];
  const orderedFloors = [...building.floors].sort((left, right) => left.level - right.level);

  if (includeSite) {
    primitives.push(rectanglePrimitive(
      building,
      { x: 0, y: 0, width: building.site.widthMm, depth: building.site.depthMm },
      "site",
      "site",
      MASSING_SITE_GRADE_M - MASSING_SITE_THICKNESS_M / 2,
      MASSING_SITE_THICKNESS_M,
    ));
  }

  for (const floor of orderedFloors) {
    if (!visible.has(floor.id)) continue;
    const explodeYM = floor.level * explodeM;
    const baseYM = floor.elevationMm * MM_TO_M + explodeYM;
    const openToSkyIds = new Set(floor.spaces.filter(isOpenToSkySpace).map((space) => space.id));
    const constructedSpaces = floor.spaces.filter(isCoveredSpace);
    if (includeSlabs) constructedSpaces.forEach((space) => primitives.push(rectanglePrimitive(building, space.bounds, `${floor.id}-slab-${space.id}`, "slab", baseYM - SLAB_THICKNESS_M / 2, SLAB_THICKNESS_M, floor.id, space.id)));
    const openingsByWall = new Map<string, Opening[]>();
    for (const opening of floor.openings) openingsByWall.set(opening.wallId, [...(openingsByWall.get(opening.wallId) ?? []), opening]);
    for (const wall of floor.walls) {
      if (isVerandahOpenEdgeWall(wall, floor.spaces)) continue;
      const openAdjacent = wall.adjacentSpaceIds.filter((id) => openToSkyIds.has(id));
      if (openAdjacent.length === wall.adjacentSpaceIds.length) {
        if (openAdjacent.length > 0) primitives.push(parapetPrimitive(building, floor, wall, baseYM));
        continue;
      }
      const kindOverride = openAdjacent.length > 0 ? "exterior_wall" as const : undefined;
      if (!includeInteriorWalls && wall.type !== "exterior" && !kindOverride) continue;
      wallPanels(wall, openingsByWall.get(wall.id) ?? [], floor.floorHeightMm)
        .forEach((panel, index) => primitives.push(wallPrimitive(building, floor, wall, panel, baseYM, index, kindOverride)));
      for (const opening of openingsByWall.get(wall.id) ?? []) {
        if (opening.usage === "vehicle") {
          if (includeColumns) primitives.push(...carportColumnPrimitives(building, floor, wall, opening, baseYM));
          continue;
        }
        if (opening.kind === "open_connection") continue; // intentional pass-throughs stay open
        const fill = openingFillPrimitive(building, floor, wall, opening, baseYM, opening.kind === "window" ? "window_glass" : "door_leaf");
        if (fill) primitives.push(fill);
      }
    }
    if (includeColumns) {
      for (const column of building.structuralConcept?.columns ?? []) {
        if (!column.servedFloorIds.includes(floor.id)) continue;
        primitives.push(rectanglePrimitive(
          building,
          { x: Math.round(column.center.x - column.widthMm / 2), y: Math.round(column.center.y - column.depthMm / 2), width: column.widthMm, depth: column.depthMm },
          `${column.id}-${floor.id}`,
          "column",
          baseYM + floor.floorHeightMm * MM_TO_M / 2,
          floor.floorHeightMm * MM_TO_M,
          floor.id,
          column.id,
        ));
      }
    }
    primitives.push(...stairPrimitives(building, floor, explodeYM));
  }

  const topFloor = orderedFloors.at(-1);
  if (includeRoof) {
    for (let lowerIndex = 0; lowerIndex < orderedFloors.length - 1; lowerIndex += 1) {
      const lowerFloor = orderedFloors[lowerIndex];
      if (!visible.has(lowerFloor.id)) continue;
      const upperFloor = orderedFloors[lowerIndex + 1];
      const upperCoveredBounds = upperFloor.spaces.filter(isCoveredSpace).map((space) => space.bounds);
      const roofYM = (lowerFloor.elevationMm + lowerFloor.floorHeightMm) * MM_TO_M + lowerFloor.level * explodeM;
      for (const lowerSpace of lowerFloor.spaces.filter(isCoveredSpace)) {
        subtractRectangles(lowerSpace.bounds, upperCoveredBounds).forEach((bounds, fragmentIndex) => {
          primitives.push(rectanglePrimitive(
            building,
            bounds,
            `${lowerFloor.id}-roof-${lowerSpace.id}-exposed-${fragmentIndex}`,
            "roof",
            roofYM + SLAB_THICKNESS_M / 2,
            SLAB_THICKNESS_M,
            lowerFloor.id,
            lowerSpace.id,
          ));
        });
      }
    }

    if (topFloor && visible.has(topFloor.id)) {
      const topYM = (topFloor.elevationMm + topFloor.floorHeightMm) * MM_TO_M + topFloor.level * explodeM;
      topFloor.spaces.filter(isCoveredSpace)
        .forEach((space) => primitives.push(rectanglePrimitive(building, space.bounds, `${topFloor.id}-roof-${space.id}`, "roof", topYM + SLAB_THICKNESS_M / 2, SLAB_THICKNESS_M, topFloor.id, space.id)));
    }
  }

  const physicalHeightM = topFloor ? (topFloor.elevationMm + topFloor.floorHeightMm) * MM_TO_M : 0;
  const visualHeightM = physicalHeightM + Math.max(0, orderedFloors.length - 1) * explodeM + SLAB_THICKNESS_M;
  return {
    primitives,
    floorIds: orderedFloors.map((floor) => floor.id),
    widthM: building.site.widthMm * MM_TO_M,
    depthM: building.site.depthMm * MM_TO_M,
    heightM: visualHeightM,
    centre: [0, visualHeightM / 2, 0],
  };
}

function boxPrimitive(input: Omit<MassingPrimitiveBase, "center" | "size"> & { center: [number, number, number]; size: [number, number, number] }): MassingPrimitive {
  return { ...input, shape: "box" };
}

function scenePoint(building: CurrentBuilding, point: { x: number; y: number; z: number }, explodeM = 0): [number, number, number] {
  const [x, z] = planToScene(building, point.x, point.y);
  return [x, point.z * MM_TO_M + explodeM, z];
}

function boundsFromPoints(points: Array<[number, number, number]>): MassingBounds {
  const minimum: [number, number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const maximum: [number, number, number] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const point of points) for (let axis = 0; axis < 3; axis += 1) {
    minimum[axis] = Math.min(minimum[axis], point[axis]);
    maximum[axis] = Math.max(maximum[axis], point[axis]);
  }
  return {
    center: minimum.map((value, axis) => (value + maximum[axis]) / 2) as [number, number, number],
    size: minimum.map((value, axis) => maximum[axis] - value) as [number, number, number],
  };
}

function meshPrimitive(input: Omit<MassingPrimitiveBase, "center" | "size"> & { vertices: Array<[number, number, number]>; triangleIndices: number[] }): MassingPrimitive {
  return { ...input, ...boundsFromPoints(input.vertices), shape: "mesh" };
}

function linearPrimitive(input: Omit<MassingPrimitiveBase, "center" | "size"> & { start: [number, number, number]; end: [number, number, number]; sectionMm: { width: number; depth: number } }): MassingPrimitive {
  const bounds = boundsFromPoints([input.start, input.end]);
  const sectionM = Math.max(input.sectionMm.width, input.sectionMm.depth) * MM_TO_M;
  bounds.size = bounds.size.map((value) => Math.max(sectionM, value + sectionM)) as [number, number, number];
  return { ...input, ...bounds, shape: "linear_member" };
}

function cross2(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointInTriangle(point: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) {
  const first = cross2(a, b, point);
  const second = cross2(b, c, point);
  const third = cross2(c, a, point);
  return (first <= 0 && second <= 0 && third <= 0) || (first >= 0 && second >= 0 && third >= 0);
}

/** Deterministic ear clipping for the canonical simple clockwise floor polygons. */
export function triangulateMassingPolygon(points: Array<{ x: number; y: number }>) {
  const remaining = points.map((_, index) => index);
  const triangles: number[] = [];
  let guard = points.length * points.length;
  while (remaining.length > 3 && guard > 0) {
    let clipped = false;
    for (let cursor = 0; cursor < remaining.length; cursor += 1) {
      const previous = remaining[(cursor - 1 + remaining.length) % remaining.length];
      const current = remaining[cursor];
      const next = remaining[(cursor + 1) % remaining.length];
      if (cross2(points[previous], points[current], points[next]) >= 0) continue;
      if (remaining.some((candidate) => candidate !== previous && candidate !== current && candidate !== next && pointInTriangle(points[candidate], points[previous], points[current], points[next]))) continue;
      triangles.push(previous, current, next);
      remaining.splice(cursor, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
    guard -= 1;
  }
  if (remaining.length === 3) triangles.push(...remaining);
  if (triangles.length !== (points.length - 2) * 3) throw new Error("MASSING_POLYGON_TRIANGULATION_FAILED");
  return triangles;
}

function horizontalPolygonPrimitive(input: {
  building: CurrentBuilding;
  floorId: string;
  id: string;
  sourceId: string;
  kind: "slab" | "roof";
  polygon: CurrentFloor["regions"][number]["polygon"];
  elevationM: number;
  materialToken: string;
}) {
  const topVertices = input.polygon.points.map((point) => {
    const [x, z] = planToScene(input.building, point.x, point.y);
    return [x, input.elevationM, z] as [number, number, number];
  });
  const bottomVertices = topVertices.map(([x, y, z]) => [x, y - SLAB_THICKNESS_M, z] as [number, number, number]);
  const topTriangles = triangulateMassingPolygon(input.polygon.points);
  const count = topVertices.length;
  const bottomTriangles = [...topTriangles].reverse().map((index) => index + count);
  const sideTriangles = topVertices.flatMap((_, index) => {
    const next = (index + 1) % count;
    // Plan polygons are clockwise in scene X/Z coordinates. This winding keeps each
    // vertical fascia outward-facing for the viewer's front-face-only materials.
    return [index, next + count, next, index, index + count, next + count];
  });
  return meshPrimitive({
    id: input.id,
    kind: input.kind,
    semanticKind: input.kind,
    floorId: input.floorId,
    sourceId: input.sourceId,
    materialToken: input.materialToken,
    vertices: [...topVertices, ...bottomVertices],
    triangleIndices: [...topTriangles, ...bottomTriangles, ...sideTriangles],
  });
}

function currentWallPrimitives(building: CurrentBuilding, floor: CurrentFloor, explodeYM: number, includeInteriorWalls: boolean) {
  const result: MassingPrimitive[] = [];
  const baseYM = floor.elevationMm * MM_TO_M + explodeYM;
  const openingsByWall = new Map<string, CurrentFloor["openings"]>();
  for (const opening of floor.openings) openingsByWall.set(opening.wallId, [...(openingsByWall.get(opening.wallId) ?? []), opening]);
  for (const wall of floor.walls) {
    if (!includeInteriorWalls && wall.type !== "exterior") continue;
    wallPanels(wall, openingsByWall.get(wall.id) ?? [], floor.floorHeightMm).forEach((panel, index) => result.push(wallPrimitive(building, floor, wall, panel, baseYM, index)));
    for (const opening of openingsByWall.get(wall.id) ?? []) {
      if (opening.kind === "open_connection" || opening.usage === "vehicle") continue;
      const kind = opening.kind === "window" ? "window_glass" : "door_leaf";
      const fill = openingFillPrimitive(building, floor, wall, opening, baseYM, kind);
      if (fill) result.push({ ...fill, materialToken: opening.materialToken ?? fill.materialToken });
    }
  }
  return result;
}

function roofFloor(building: CurrentBuilding, roof: RoofSystem) {
  if (roof.kind === "open_pergola") return building.floors.find((floor) => floor.id === roof.hostFloorId);
  return building.floors.find((floor) => floor.spaces.some((space) => roof.servesSpaceIds.includes(space.id)));
}

function buildCurrentMassingModel(building: CurrentBuilding, options: MassingOptions = {}): MassingModel {
  const visible = new Set(options.visibleFloorIds ?? building.floors.map((floor) => floor.id));
  const explodeM = Math.max(0, options.explodeM ?? 0);
  const includeInteriorWalls = options.includeInteriorWalls ?? true;
  const includeSlabs = options.includeSlabs ?? true;
  const includeRoof = options.includeRoof ?? true;
  const includeSite = options.includeSite ?? true;
  const includeColumns = options.includeColumns ?? true;
  const primitives: MassingPrimitive[] = [];
  const floors = [...building.floors].sort((left, right) => left.level - right.level);
  if (includeSite) primitives.push(boxPrimitive({
    id: "site", kind: "site", semanticKind: "site", materialToken: "site.ground",
    center: [0, MASSING_SITE_GRADE_M - MASSING_SITE_THICKNESS_M / 2, 0],
    size: [building.site.widthMm * MM_TO_M, MASSING_SITE_THICKNESS_M, building.site.depthMm * MM_TO_M],
  }));
  for (const floor of floors) {
    if (!visible.has(floor.id)) continue;
    const explodeYM = floor.level * explodeM;
    const baseYM = floor.elevationMm * MM_TO_M + explodeYM;
    if (includeSlabs) for (const region of floor.regions.filter((candidate) => candidate.kind === "interior" || candidate.kind === "covered_outdoor")) primitives.push(horizontalPolygonPrimitive({
      building, floorId: floor.id, id: `${floor.id}-slab-${region.id}`, sourceId: region.id, kind: "slab", polygon: region.polygon, elevationM: baseYM, materialToken: "slab.concrete",
    }));
    primitives.push(...currentWallPrimitives(building, floor, explodeYM, includeInteriorWalls));
    if (includeColumns) for (const column of building.structuralConcept.columns.filter((candidate) => candidate.servedFloorIds.includes(floor.id))) primitives.push(rectanglePrimitive(
      building,
      { x: Math.round(column.center.x - column.widthMm / 2), y: Math.round(column.center.y - column.depthMm / 2), width: column.widthMm, depth: column.depthMm },
      `${column.id}-${floor.id}`, "column", baseYM + floor.floorHeightMm * MM_TO_M / 2, floor.floorHeightMm * MM_TO_M, floor.id, column.id,
    ));
  }
  if (includeRoof) for (const roof of building.roofSystems) {
    const floor = roofFloor(building, roof);
    if (!floor || !visible.has(floor.id)) continue;
    const explodeYM = floor.level * explodeM;
    if (roof.kind === "open_pergola") {
      for (const member of [...roof.frameMembers, ...roof.slatMembers]) primitives.push(linearPrimitive({
        id: member.id, kind: "pergola", semanticKind: "pergola", floorId: floor.id, sourceId: roof.id,
        materialToken: "pergola.warm-timber", start: scenePoint(building, member.start, explodeYM), end: scenePoint(building, member.end, explodeYM), sectionMm: member.sectionMm,
      }));
    } else primitives.push(horizontalPolygonPrimitive({
      building,
      floorId: floor.id,
      id: `${roof.id}-closed-cap`,
      sourceId: roof.id,
      kind: "roof",
      polygon: roof.footprint,
      elevationM: roof.eaveHeightMm * MM_TO_M + explodeYM + SLAB_THICKNESS_M,
      materialToken: roof.kind === "flat_slab"
        ? "roof.flat-mineral"
        : roof.kind === "solid_canopy"
          ? "roof.canopy"
          : "roof.warm-tile",
    }));
  }
  if (includeColumns) for (const support of building.secondaryRoofSupports) {
    const floor = building.floors.find((candidate) => candidate.id === support.floorId);
    if (!floor || !visible.has(floor.id)) continue;
    const explodeYM = floor.level * explodeM;
    if (support.role === "ledger") {
      primitives.push(linearPrimitive({
        id: support.id, kind: "support", semanticKind: "support", floorId: floor.id, sourceId: support.id, materialToken: "support.ledger",
        start: scenePoint(building, { ...support.geometry.start, z: support.topElevationMm }, explodeYM),
        end: scenePoint(building, { ...support.geometry.end, z: support.topElevationMm }, explodeYM),
        sectionMm: { width: support.sectionMm?.x ?? 150, depth: support.sectionMm?.y ?? 250 },
      }));
    } else {
      const [x, z] = planToScene(building, support.geometry.x, support.geometry.y);
      primitives.push(boxPrimitive({
        id: support.id, kind: "support", semanticKind: "support", floorId: floor.id, sourceId: support.id, materialToken: `support.${support.role}`,
        center: [x, (support.baseElevationMm + support.topElevationMm) * MM_TO_M / 2 + explodeYM, z],
        size: [support.sectionMm.x * MM_TO_M, (support.topElevationMm - support.baseElevationMm) * MM_TO_M, support.sectionMm.y * MM_TO_M],
      }));
    }
  }
  for (const guard of building.edgeProtections) {
    const floor = building.floors.find((candidate) => candidate.id === guard.floorId);
    if (!floor || !visible.has(floor.id)) continue;
    const explodeYM = floor.level * explodeM;
    const topElevation = floor.elevationMm + guard.heightMm;
    primitives.push(linearPrimitive({
      id: `${guard.id}-top-rail`, kind: "guard", semanticKind: "guard", floorId: floor.id, sourceId: guard.id, materialToken: `guard.${guard.kind}`,
      start: scenePoint(building, { ...guard.edge.start, z: topElevation }, explodeYM), end: scenePoint(building, { ...guard.edge.end, z: topElevation }, explodeYM), sectionMm: { width: 55, depth: 55 },
    }));
    const length = Math.hypot(guard.edge.end.x - guard.edge.start.x, guard.edge.end.y - guard.edge.start.y);
    const divisions = Math.max(1, Math.ceil(length / 1200));
    for (let index = 0; index <= divisions; index += 1) {
      const point = {
        x: Math.round(guard.edge.start.x + (guard.edge.end.x - guard.edge.start.x) * index / divisions),
        y: Math.round(guard.edge.start.y + (guard.edge.end.y - guard.edge.start.y) * index / divisions),
      };
      primitives.push(linearPrimitive({
        id: `${guard.id}-post-${index + 1}`, kind: "guard", semanticKind: "guard", floorId: floor.id, sourceId: guard.id, materialToken: `guard.${guard.kind}`,
        start: scenePoint(building, { ...point, z: floor.elevationMm }, explodeYM), end: scenePoint(building, { ...point, z: topElevation }, explodeYM), sectionMm: { width: 45, depth: 45 },
      }));
    }
  }
  const buildingBounds = primitives.filter((primitive) => primitive.kind !== "site").map(massingPrimitiveBounds);
  const maximumRoofHeight = Math.max(0, ...buildingBounds.map((bounds) => bounds.center[1] + bounds.size[1] / 2));
  return {
    primitives,
    floorIds: floors.map((floor) => floor.id),
    widthM: building.site.widthMm * MM_TO_M,
    depthM: building.site.depthMm * MM_TO_M,
    heightM: maximumRoofHeight,
    centre: [0, maximumRoofHeight / 2, 0],
  };
}

export function massingPrimitiveBounds(primitive: MassingPrimitive): MassingBounds {
  return { center: primitive.center, size: primitive.size };
}

/** Readable-building dispatcher. The legacy branch is intentionally unchanged apart from metadata. */
export function buildMassingModel(building: ReadableBuilding, options: MassingOptions = {}): MassingModel {
  return building.buildingSchemaVersion === 3 ? buildCurrentMassingModel(building, options) : buildLegacyMassingModel(building, options);
}

export function massingMetrics(building: ReadableBuilding) {
  if (building.buildingSchemaVersion === 3) {
    const floors = [...building.floors].sort((left, right) => left.level - right.level);
    const physicalTopMm = Math.max(
      floors.length ? floors.at(-1)!.elevationMm + floors.at(-1)!.floorHeightMm : 0,
      ...building.roofSystems.map((roof) => roof.kind === "open_pergola" ? roof.topElevationMm : roof.eaveHeightMm),
    );
    return {
      storeys: floors.length,
      heightM: physicalTopMm * MM_TO_M,
      builtAreaM2: floors.reduce((sum, floor) => sum + floor.regions
        .filter((region) => region.kind === "interior" || region.kind === "covered_outdoor")
        .reduce((floorTotal, region) => floorTotal + orthogonalPolygonAreaMm2(region.polygon) / 1_000_000, 0), 0),
      openingCount: floors.reduce((sum, floor) => sum + floor.openings.length, 0),
      stairAligned: building.verticalConnectors.every((connector) => {
        const bounds = connector.servedFloorIds.map((floorId) => connector.boundsByFloor[floorId]).filter(Boolean);
        return new Set(bounds.map((item) => `${item.x}:${item.y}:${item.width}:${item.depth}`)).size <= 1;
      }),
      columnCount: building.structuralConcept.columns.length,
    };
  }
  const floors = [...building.floors].sort((left, right) => left.level - right.level);
  const heightM = floors.length ? (floors.at(-1)!.elevationMm + floors.at(-1)!.floorHeightMm) * MM_TO_M : 0;
  return {
    storeys: floors.length,
    heightM,
    builtAreaM2: floors.reduce((sum, floor) => sum + floor.spaces
      .filter((space) => !isOpenToSkySpace(space))
      .reduce((floorTotal, space) => floorTotal + space.areaMm2 / 1_000_000, 0), 0),
    openingCount: floors.reduce((sum, floor) => sum + floor.openings.length, 0),
    stairAligned: building.verticalConnectors.every((connector) => {
      const bounds = connector.servedFloorIds.map((floorId) => connector.boundsByFloor[floorId]).filter(Boolean);
      return new Set(bounds.map((item) => `${item.x}:${item.y}:${item.width}:${item.depth}`)).size <= 1;
    }),
    columnCount: building.structuralConcept?.columns.length ?? 0,
  };
}
