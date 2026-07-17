import type { Floor, Opening, Rectangle, StructuralColumn, StructuralConcept, WallSegment } from "@/lib/building/schema";
import { isOpenToSkySpace } from "@/lib/building/topology";

export const STRUCTURAL_CONCEPT_VERSION = 1 as const;
export const STRUCTURAL_CONCEPT_SCOPE = "conceptual_column_coordination_only" as const;
export const STRUCTURAL_CONCEPT_DISCLAIMER = "Conceptual column coordination only; member sizing, loads, foundations and code compliance require a licensed structural engineer." as const;
export const STRUCTURAL_BASELINE_MAX_BAY_MM = 4_500;
export const STRUCTURAL_NOMINAL_COLUMN_MM = 230;
export const STRUCTURAL_OPENING_CLEARANCE_MM = 100;

function right(rectangle: Rectangle) {
  return rectangle.x + rectangle.width;
}

function bottom(rectangle: Rectangle) {
  return rectangle.y + rectangle.depth;
}

export function structuralColumnBounds(column: StructuralColumn): Rectangle {
  return {
    x: Math.round(column.center.x - column.widthMm / 2),
    y: Math.round(column.center.y - column.depthMm / 2),
    width: column.widthMm,
    depth: column.depthMm,
  };
}

function rectanglesOverlap(left: Rectangle, rightRectangle: Rectangle) {
  return Math.min(right(left), right(rightRectangle)) > Math.max(left.x, rightRectangle.x)
    && Math.min(bottom(left), bottom(rightRectangle)) > Math.max(left.y, rightRectangle.y);
}

function openingInterval(opening: Opening, wall: WallSegment) {
  const horizontal = wall.start.y === wall.end.y;
  const increasing = horizontal ? wall.end.x >= wall.start.x : wall.end.y >= wall.start.y;
  const direction = increasing ? 1 : -1;
  const from = (horizontal ? wall.start.x : wall.start.y) + direction * opening.offsetMm;
  const to = from + direction * opening.widthMm;
  return { horizontal, from: Math.min(from, to), to: Math.max(from, to), line: horizontal ? wall.start.y : wall.start.x };
}

export function columnConflictsWithOpening(
  column: StructuralColumn,
  opening: Opening,
  wall: WallSegment,
  clearanceMm = STRUCTURAL_OPENING_CLEARANCE_MM,
) {
  const interval = openingInterval(opening, wall);
  const bounds = structuralColumnBounds(column);
  if (interval.horizontal) {
    return right(bounds) > interval.from - clearanceMm
      && bounds.x < interval.to + clearanceMm
      && bottom(bounds) > interval.line - clearanceMm
      && bounds.y < interval.line + clearanceMm;
  }
  return bottom(bounds) > interval.from - clearanceMm
    && bounds.y < interval.to + clearanceMm
    && right(bounds) > interval.line - clearanceMm
    && bounds.x < interval.line + clearanceMm;
}

export function columnConflictsWithStair(column: StructuralColumn, floor: Floor) {
  const bounds = structuralColumnBounds(column);
  return floor.spaces.some((space) => space.type === "stair" && rectanglesOverlap(bounds, space.bounds));
}

function axisCoordinates(origin: number, length: number) {
  const bayCount = Math.max(1, Math.ceil(length / STRUCTURAL_BASELINE_MAX_BAY_MM));
  return Array.from({ length: bayCount + 1 }, (_, index) => Math.round(origin + length * index / bayCount));
}

function safeOnEveryServedFloor(column: StructuralColumn, floors: Floor[]) {
  const columnBounds = structuralColumnBounds(column);
  return floors.every((floor) => {
    const overlapsOpenToSkySpace = floor.spaces.some((space) => (
      isOpenToSkySpace(space) && rectanglesOverlap(columnBounds, space.bounds)
    ));
    if (overlapsOpenToSkySpace) return false;
    const supported = floor.spaces.some((space) => (
      !isOpenToSkySpace(space)
      && column.center.x >= space.bounds.x
      && column.center.x <= right(space.bounds)
      && column.center.y >= space.bounds.y
      && column.center.y <= bottom(space.bounds)
    ));
    if (!supported) return false;
    if (columnConflictsWithStair(column, floor)) return false;
    const wallById = new Map(floor.walls.map((wall) => [wall.id, wall]));
    return floor.openings.every((opening) => {
      const wall = wallById.get(opening.wallId);
      return !wall || !columnConflictsWithOpening(column, opening, wall);
    });
  });
}

/**
 * Builds one stable perimeter grid shared by every floor. Candidate columns that would collide
 * with a modeled stair or opening on any served floor are omitted rather than silently overlapping
 * circulation. Bay sizes are a product baseline for coordination, not an engineering span claim.
 */
export function buildStructuralConcept(floors: Floor[]): StructuralConcept {
  const orderedFloors = [...floors].sort((left, right) => left.level - right.level || left.id.localeCompare(right.id));
  const envelope = orderedFloors[0]?.envelope;
  if (!envelope) {
    return {
      structuralConceptVersion: STRUCTURAL_CONCEPT_VERSION,
      scope: STRUCTURAL_CONCEPT_SCOPE,
      disclaimer: STRUCTURAL_CONCEPT_DISCLAIMER,
      baselineMaxBayMm: STRUCTURAL_BASELINE_MAX_BAY_MM,
      axes: [],
      columns: [],
    };
  }
  const baseXCoordinates = axisCoordinates(envelope.x, envelope.width);
  const baseYCoordinates = axisCoordinates(envelope.y, envelope.depth);
  const wallIsOnEnvelope = (wall: WallSegment) => (
    (wall.start.x === wall.end.x && (wall.start.x === envelope.x || wall.start.x === right(envelope)))
    || (wall.start.y === wall.end.y && (wall.start.y === envelope.y || wall.start.y === bottom(envelope)))
  );
  const articulationPoints = orderedFloors.flatMap((floor) => floor.walls
    .filter((wall) => wall.type === "exterior" && !wallIsOnEnvelope(wall))
    .flatMap((wall) => [wall.start, wall.end]));
  const xCoordinates = [...new Set([...baseXCoordinates, ...articulationPoints.map((point) => point.x)])].sort((left, rightValue) => left - rightValue);
  const yCoordinates = [...new Set([...baseYCoordinates, ...articulationPoints.map((point) => point.y)])].sort((left, rightValue) => left - rightValue);
  const servedFloorIds = orderedFloors.map((floor) => floor.id);
  const baseCandidates = baseYCoordinates.flatMap((y) => baseXCoordinates.flatMap((x) => {
    const onPerimeter = x === baseXCoordinates[0] || x === baseXCoordinates.at(-1) || y === baseYCoordinates[0] || y === baseYCoordinates.at(-1);
    return onPerimeter ? [{ x, y }] : [];
  }));
  const candidatePoints = [...new Map([...baseCandidates, ...articulationPoints].map((point) => [`${point.x}:${point.y}`, point])).values()];
  const candidates = candidatePoints.map(({ x, y }) => ({
      id: `column-${x}-${y}`,
      center: { x, y },
      widthMm: STRUCTURAL_NOMINAL_COLUMN_MM,
      depthMm: STRUCTURAL_NOMINAL_COLUMN_MM,
      servedFloorIds,
    } satisfies StructuralColumn));
  const columns = candidates.filter((column) => safeOnEveryServedFloor(column, orderedFloors));
  return {
    structuralConceptVersion: STRUCTURAL_CONCEPT_VERSION,
    scope: STRUCTURAL_CONCEPT_SCOPE,
    disclaimer: STRUCTURAL_CONCEPT_DISCLAIMER,
    baselineMaxBayMm: STRUCTURAL_BASELINE_MAX_BAY_MM,
    axes: [
      ...xCoordinates.map((coordinateMm, index) => ({ id: `grid-x-${index + 1}`, direction: "x" as const, coordinateMm })),
      ...yCoordinates.map((coordinateMm, index) => ({ id: `grid-y-${index + 1}`, direction: "y" as const, coordinateMm })),
    ],
    columns,
  };
}
