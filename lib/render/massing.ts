import type { Building, Floor, Opening, Rectangle, WallSegment } from "@/lib/building/schema";
import { isCoveredSpace } from "@/lib/building/space-semantics";
import { isOpenToSkySpace, isVerandahOpenEdgeWall } from "@/lib/building/topology";

const MM_TO_M = 1 / 1000;
export const SLAB_THICKNESS_M = 0.18;
export const MASSING_SITE_GRADE_M = -0.02;
export const MASSING_SITE_THICKNESS_M = 0.05;
export const MASSING_GRID_Y_M = MASSING_SITE_GRADE_M + 0.004;

export type MassingPrimitiveKind = "site" | "slab" | "roof" | "exterior_wall" | "interior_wall" | "column" | "stair" | "window_glass" | "door_leaf" | "parapet";

export type MassingPrimitive = {
  id: string;
  kind: MassingPrimitiveKind;
  floorId?: string;
  sourceId?: string;
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

function planToScene(building: Building, xMm: number, yMm: number): [number, number] {
  return [(xMm - building.site.widthMm / 2) * MM_TO_M, (yMm - building.site.depthMm / 2) * MM_TO_M];
}

function rectanglePrimitive(
  building: Building,
  rectangle: Rectangle,
  id: string,
  kind: MassingPrimitiveKind,
  centreYM: number,
  heightM: number,
  floorId?: string,
  sourceId?: string,
): MassingPrimitive {
  const [x, z] = planToScene(building, rectangle.x + rectangle.width / 2, rectangle.y + rectangle.depth / 2);
  return { id, kind, floorId, sourceId, center: [x, centreYM, z], size: [rectangle.width * MM_TO_M, heightM, rectangle.depth * MM_TO_M] };
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
  building: Building,
  floor: Floor,
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
    floorId: floor.id,
    sourceId: wall.id,
    center: [x, baseYM + (panel.bottomMm + panel.topMm) * MM_TO_M / 2, z],
    size: horizontal ? [panelLengthM, panelHeightM, thicknessM] : [thicknessM, panelHeightM, panelLengthM],
  };
}

const WINDOW_PANE_THICKNESS_RATIO = 0.35;
const DOOR_LEAF_THICKNESS_RATIO = 0.7;

function openingFillPrimitive(
  building: Building,
  floor: Floor,
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
    floorId: floor.id,
    sourceId: wall.id,
    center: [x, baseYM + PARAPET_HEIGHT_M / 2, z],
    size: horizontal ? [lengthM, PARAPET_HEIGHT_M, thicknessM] : [thicknessM, PARAPET_HEIGHT_M, lengthM],
  };
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
      floorId: floor.id,
      sourceId: connector.id,
      center: [x, floor.elevationMm * MM_TO_M + explodeYM + heightM / 2, z] as [number, number, number],
      size: directionAlongX
        ? [treadMm * MM_TO_M, heightM, crossWidthMm * MM_TO_M]
        : [crossWidthMm * MM_TO_M, heightM, treadMm * MM_TO_M] as [number, number, number],
    };
  });
}

export function buildMassingModel(building: Building, options: MassingOptions = {}): MassingModel {
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
        if (opening.usage === "vehicle") continue; // carport columns handle vehicle entries (Task 6)
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

export function massingMetrics(building: Building) {
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
