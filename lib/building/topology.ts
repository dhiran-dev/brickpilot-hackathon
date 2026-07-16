import type { FloorCandidate } from "@/lib/building/candidates/types";
import { rectanglePolygon, type Floor, type Rectangle, type Space, type WallSegment } from "@/lib/building/schema";

const EXTERIOR = "EXTERIOR";
const OPEN_TO_SKY_TYPES = new Set<Space["type"]>(["courtyard", "terrace"]);

export function isOpenToSkySpace(space: Pick<Space, "type"> | undefined) {
  return Boolean(space && OPEN_TO_SKY_TYPES.has(space.type));
}

/** Unwalled edge zones that shape the enclosed villa footprint. Parking may retain a canopy. */
export function isPerimeterOpenSpace(space: Pick<Space, "type"> | undefined) {
  return Boolean(space && (isOpenToSkySpace(space) || space.type === "parking"));
}

function right(rectangle: Rectangle) {
  return rectangle.x + rectangle.width;
}

function bottom(rectangle: Rectangle) {
  return rectangle.y + rectangle.depth;
}

export function rectangleIntersectionArea(left: Rectangle, rightRectangle: Rectangle) {
  const width = Math.max(0, Math.min(right(left), right(rightRectangle)) - Math.max(left.x, rightRectangle.x));
  const depth = Math.max(0, Math.min(bottom(left), bottom(rightRectangle)) - Math.max(left.y, rightRectangle.y));
  return width * depth;
}

function containsSample(bounds: Rectangle, x: number, y: number) {
  return x > bounds.x && x < right(bounds) && y > bounds.y && y < bottom(bounds);
}

function spaceAt(spaces: Space[], x: number, y: number) {
  return spaces.find((space) => containsSample(space.bounds, x, y));
}

function uniqueSorted(values: number[]) {
  return [...new Set(values)].sort((left, right) => left - right);
}

type RawWall = {
  orientation: "H" | "V";
  line: number;
  from: number;
  to: number;
  adjacentSpaceIds: string[];
};

function adjacencyKey(adjacency: string[]) {
  return [...adjacency].sort().join("|");
}

function mergeRawWalls(rawWalls: RawWall[]) {
  const sorted = [...rawWalls].sort((left, right) =>
    left.orientation.localeCompare(right.orientation) || left.line - right.line || left.from - right.from || left.to - right.to,
  );
  const merged: RawWall[] = [];
  for (const wall of sorted) {
    const previous = merged.at(-1);
    if (
      previous && previous.orientation === wall.orientation && previous.line === wall.line && previous.to === wall.from &&
      adjacencyKey(previous.adjacentSpaceIds) === adjacencyKey(wall.adjacentSpaceIds)
    ) {
      previous.to = wall.to;
    } else {
      merged.push({ ...wall, adjacentSpaceIds: [...wall.adjacentSpaceIds] });
    }
  }
  return merged;
}

export function buildCanonicalWalls(floorId: string, envelope: Rectangle, spaces: Space[]): WallSegment[] {
  const spacesById = new Map(spaces.map((space) => [space.id, space]));
  const xCoordinates = uniqueSorted([envelope.x, right(envelope), ...spaces.flatMap((space) => [space.bounds.x, right(space.bounds)])]);
  const yCoordinates = uniqueSorted([envelope.y, bottom(envelope), ...spaces.flatMap((space) => [space.bounds.y, bottom(space.bounds)])]);
  const rawWalls: RawWall[] = [];

  for (const x of xCoordinates) {
    for (let index = 0; index < yCoordinates.length - 1; index += 1) {
      const from = yCoordinates[index];
      const to = yCoordinates[index + 1];
      if (to <= envelope.y || from >= bottom(envelope)) continue;
      const middle = (from + to) / 2;
      const west = spaceAt(spaces, x - 0.25, middle);
      const east = spaceAt(spaces, x + 0.25, middle);
      if (west?.id === east?.id || (!west && !east)) continue;
      rawWalls.push({ orientation: "V", line: x, from, to, adjacentSpaceIds: [west?.id, east?.id].filter(Boolean) as string[] });
    }
  }

  for (const y of yCoordinates) {
    for (let index = 0; index < xCoordinates.length - 1; index += 1) {
      const from = xCoordinates[index];
      const to = xCoordinates[index + 1];
      if (to <= envelope.x || from >= right(envelope)) continue;
      const middle = (from + to) / 2;
      const north = spaceAt(spaces, middle, y - 0.25);
      const south = spaceAt(spaces, middle, y + 0.25);
      if (north?.id === south?.id || (!north && !south)) continue;
      rawWalls.push({ orientation: "H", line: y, from, to, adjacentSpaceIds: [north?.id, south?.id].filter(Boolean) as string[] });
    }
  }

  return mergeRawWalls(rawWalls).flatMap((wall) => {
    const adjacentSpaces = wall.adjacentSpaceIds.map((id) => spacesById.get(id)).filter(Boolean) as Space[];
    if (adjacentSpaces.length > 0 && adjacentSpaces.every(isPerimeterOpenSpace)) return [];
    const isExterior = wall.adjacentSpaceIds.length === 1 || adjacentSpaces.some(isPerimeterOpenSpace);
    const suffix = `${wall.orientation}-${wall.line}-${wall.from}-${wall.to}`;
    return [{
      id: `${floorId}-wall-${suffix}`,
      floorId,
      start: wall.orientation === "V" ? { x: wall.line, y: wall.from } : { x: wall.from, y: wall.line },
      end: wall.orientation === "V" ? { x: wall.line, y: wall.to } : { x: wall.to, y: wall.line },
      thicknessMm: isExterior ? 230 : 115,
      type: isExterior ? "exterior" : "interior",
      adjacentSpaceIds: [...wall.adjacentSpaceIds].sort(),
    } satisfies WallSegment];
  });
}

export type CoverageAudit = {
  envelopeAreaMm2: number;
  coveredAreaMm2: number;
  overlapAreaMm2: number;
  gapAreaMm2: number;
  outsideAreaMm2: number;
};

export function analyzeCoverage(envelope: Rectangle, spaces: Pick<Space, "bounds">[]): CoverageAudit {
  const clippedX = spaces.flatMap((space) => [Math.max(envelope.x, space.bounds.x), Math.min(right(envelope), right(space.bounds))]);
  const clippedY = spaces.flatMap((space) => [Math.max(envelope.y, space.bounds.y), Math.min(bottom(envelope), bottom(space.bounds))]);
  const xs = uniqueSorted([envelope.x, right(envelope), ...clippedX.filter((value) => value >= envelope.x && value <= right(envelope))]);
  const ys = uniqueSorted([envelope.y, bottom(envelope), ...clippedY.filter((value) => value >= envelope.y && value <= bottom(envelope))]);
  let coveredAreaMm2 = 0;
  let overlapAreaMm2 = 0;
  let gapAreaMm2 = 0;
  for (let xIndex = 0; xIndex < xs.length - 1; xIndex += 1) {
    for (let yIndex = 0; yIndex < ys.length - 1; yIndex += 1) {
      const cellArea = (xs[xIndex + 1] - xs[xIndex]) * (ys[yIndex + 1] - ys[yIndex]);
      const x = (xs[xIndex] + xs[xIndex + 1]) / 2;
      const y = (ys[yIndex] + ys[yIndex + 1]) / 2;
      const count = spaces.filter((space) => containsSample(space.bounds, x, y)).length;
      if (count === 0) gapAreaMm2 += cellArea;
      else {
        coveredAreaMm2 += cellArea;
        if (count > 1) overlapAreaMm2 += cellArea * (count - 1);
      }
    }
  }
  const totalSpaceArea = spaces.reduce((sum, space) => sum + space.bounds.width * space.bounds.depth, 0);
  const insideMultiplicityArea = coveredAreaMm2 + overlapAreaMm2;
  return {
    envelopeAreaMm2: envelope.width * envelope.depth,
    coveredAreaMm2,
    overlapAreaMm2,
    gapAreaMm2,
    outsideAreaMm2: Math.max(0, totalSpaceArea - insideMultiplicityArea),
  };
}

export function normalizeFloorTopology(candidate: FloorCandidate, envelope: Rectangle, elevationMm: number): Floor {
  const spaces: Space[] = candidate.cells.map((cell) => ({
    id: cell.id,
    floorId: candidate.floor.id,
    name: cell.name,
    type: cell.type,
    planningCellPolygon: rectanglePolygon(cell.bounds),
    bounds: cell.bounds,
    areaMm2: cell.bounds.width * cell.bounds.depth,
    occupied: cell.occupied,
    accessible: cell.accessible,
  }));
  return {
    id: candidate.floor.id,
    label: candidate.floor.label,
    level: candidate.floor.level,
    elevationMm,
    floorHeightMm: candidate.floor.floorHeightMm,
    envelope,
    spaces,
    walls: buildCanonicalWalls(candidate.floor.id, envelope, spaces),
    openings: [],
  };
}

export function wallLength(wall: WallSegment) {
  return Math.abs(wall.end.x - wall.start.x) + Math.abs(wall.end.y - wall.start.y);
}

/** Derives the clear-space rectangle from the authoritative planning cell and wall centre-lines. */
export function deriveClearSpaceBounds(floor: Floor, space: Space): Rectangle {
  let northInset = 0;
  let eastInset = 0;
  let southInset = 0;
  let westInset = 0;
  for (const wall of floor.walls.filter((candidate) => candidate.adjacentSpaceIds.includes(space.id))) {
    const inset = Math.ceil(wall.thicknessMm / 2);
    if (wall.start.y === wall.end.y && wall.start.y === space.bounds.y) northInset = Math.max(northInset, inset);
    if (wall.start.x === wall.end.x && wall.start.x === right(space.bounds)) eastInset = Math.max(eastInset, inset);
    if (wall.start.y === wall.end.y && wall.start.y === bottom(space.bounds)) southInset = Math.max(southInset, inset);
    if (wall.start.x === wall.end.x && wall.start.x === space.bounds.x) westInset = Math.max(westInset, inset);
  }
  return {
    x: space.bounds.x + westInset,
    y: space.bounds.y + northInset,
    width: Math.max(1, space.bounds.width - westInset - eastInset),
    depth: Math.max(1, space.bounds.depth - northInset - southInset),
  };
}

export function deriveClearSpacePolygon(floor: Floor, space: Space) {
  return rectanglePolygon(deriveClearSpaceBounds(floor, space));
}

export { EXTERIOR };
