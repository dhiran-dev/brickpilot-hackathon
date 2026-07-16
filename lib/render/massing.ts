import type { Building, Floor, Opening, Rectangle, WallSegment } from "@/lib/building/schema";

const MM_TO_M = 1 / 1000;
export const SLAB_THICKNESS_M = 0.18;

export type MassingPrimitiveKind = "site" | "slab" | "roof" | "exterior_wall" | "interior_wall" | "stair";

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

function wallPrimitive(
  building: Building,
  floor: Floor,
  wall: WallSegment,
  panel: WallPanel,
  baseYM: number,
  index: number,
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
    kind: wall.type === "exterior" ? "exterior_wall" : "interior_wall",
    floorId: floor.id,
    sourceId: wall.id,
    center: [x, baseYM + (panel.bottomMm + panel.topMm) * MM_TO_M / 2, z],
    size: horizontal ? [panelLengthM, panelHeightM, thicknessM] : [thicknessM, panelHeightM, panelLengthM],
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
  const primitives: MassingPrimitive[] = [];
  const orderedFloors = [...building.floors].sort((left, right) => left.level - right.level);

  if (includeSite) {
    primitives.push(rectanglePrimitive(
      building,
      { x: 0, y: 0, width: building.site.widthMm, depth: building.site.depthMm },
      "site",
      "site",
      -0.025,
      0.05,
    ));
  }

  for (const floor of orderedFloors) {
    if (!visible.has(floor.id)) continue;
    const explodeYM = floor.level * explodeM;
    const baseYM = floor.elevationMm * MM_TO_M + explodeYM;
    if (includeSlabs) {
      primitives.push(rectanglePrimitive(building, floor.envelope, `${floor.id}-slab`, "slab", baseYM - SLAB_THICKNESS_M / 2, SLAB_THICKNESS_M, floor.id));
    }
    const openingsByWall = new Map<string, Opening[]>();
    for (const opening of floor.openings) openingsByWall.set(opening.wallId, [...(openingsByWall.get(opening.wallId) ?? []), opening]);
    for (const wall of floor.walls) {
      if (!includeInteriorWalls && wall.type !== "exterior") continue;
      wallPanels(wall, openingsByWall.get(wall.id) ?? [], floor.floorHeightMm)
        .forEach((panel, index) => primitives.push(wallPrimitive(building, floor, wall, panel, baseYM, index)));
    }
    primitives.push(...stairPrimitives(building, floor, explodeYM));
  }

  const topFloor = orderedFloors.at(-1);
  if (topFloor && visible.has(topFloor.id) && includeSlabs && includeRoof) {
    const topYM = (topFloor.elevationMm + topFloor.floorHeightMm) * MM_TO_M + topFloor.level * explodeM;
    primitives.push(rectanglePrimitive(building, topFloor.envelope, `${topFloor.id}-roof`, "roof", topYM + SLAB_THICKNESS_M / 2, SLAB_THICKNESS_M, topFloor.id));
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
    builtAreaM2: floors.reduce((sum, floor) => sum + floor.envelope.width * floor.envelope.depth / 1_000_000, 0),
    openingCount: floors.reduce((sum, floor) => sum + floor.openings.length, 0),
    stairAligned: building.verticalConnectors.every((connector) => {
      const bounds = connector.servedFloorIds.map((floorId) => connector.boundsByFloor[floorId]).filter(Boolean);
      return new Set(bounds.map((item) => `${item.x}:${item.y}:${item.width}:${item.depth}`)).size <= 1;
    }),
  };
}
