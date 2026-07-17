import type { CardinalDirection, FormStrategy } from "@/lib/building/requirements";
import type { Rectangle } from "@/lib/building/schema";
import type { CandidateRoom, FloorCandidate } from "@/lib/building/candidates/types";
import { minimumRemainingDimensionMm } from "@/lib/building/dimensions";

const MIN_RECESS_MM = 900;
const MAX_RECESS_MM = 1_500;
function minimumRemainingDimension(cell: CandidateRoom) {
  return minimumRemainingDimensionMm(cell.type);
}

const RECESS_ROOM_PRIORITY: Record<CandidateRoom["type"], number> = {
  study: 0,
  pooja: 1,
  utility: 2,
  dining: 3,
  living: 4,
  bedroom: 5,
  kitchen: 6,
  bathroom: 7,
  store: 8,
  foyer: 9,
  circulation: 10,
  parking: 11,
  stair: 12,
  balcony: 13,
  courtyard: 14,
  terrace: 15,
  verandah: 16,
};

function right(bounds: Rectangle) {
  return bounds.x + bounds.width;
}

function bottom(bounds: Rectangle) {
  return bounds.y + bounds.depth;
}

function touchesSide(bounds: Rectangle, envelope: Rectangle, side: CardinalDirection) {
  if (side === "north") return bounds.y === envelope.y;
  if (side === "east") return right(bounds) === right(envelope);
  if (side === "south") return bottom(bounds) === bottom(envelope);
  return bounds.x === envelope.x;
}

function removableDepth(cell: CandidateRoom, side: CardinalDirection) {
  const facadeSpan = side === "north" || side === "south" ? cell.bounds.width : cell.bounds.depth;
  const inwardDimension = side === "north" || side === "south" ? cell.bounds.depth : cell.bounds.width;
  const areaAllowance = Math.floor((facadeSpan * inwardDimension - cell.minAreaMm2) / Math.max(1, facadeSpan));
  return Math.max(0, Math.min(MAX_RECESS_MM, inwardDimension - minimumRemainingDimension(cell), areaAllowance));
}

function carveCell(cell: CandidateRoom, side: CardinalDirection, amountMm: number, ordinal: number): CandidateRoom[] {
  const original = cell.bounds;
  let retained: Rectangle;
  let recess: Rectangle;
  if (side === "north") {
    retained = { ...original, y: original.y + amountMm, depth: original.depth - amountMm };
    recess = { ...original, depth: amountMm };
  } else if (side === "south") {
    retained = { ...original, depth: original.depth - amountMm };
    recess = { ...original, y: original.y + original.depth - amountMm, depth: amountMm };
  } else if (side === "west") {
    retained = { ...original, x: original.x + amountMm, width: original.width - amountMm };
    recess = { ...original, width: amountMm };
  } else {
    retained = { ...original, width: original.width - amountMm };
    recess = { ...original, x: original.x + original.width - amountMm, width: amountMm };
  }
  const recessArea = recess.width * recess.depth;
  return [
    { ...cell, bounds: retained },
    {
      id: `${cell.floorId}-form-recess-${ordinal}`,
      name: cell.floorId === "F0"
        ? (ordinal === 1 ? "Entry court / landscape recess" : "Open-to-sky side court")
        : "Sectioned setback terrace",
      type: "terrace",
      floorId: cell.floorId,
      minAreaMm2: recessArea,
      targetAreaMm2: recessArea,
      accessible: false,
      bounds: recess,
      occupied: false,
    },
  ];
}

function orthogonalSide(front: CardinalDirection, seed: number): CardinalDirection {
  const useClockwise = (seed & 1) === 0;
  const clockwise: Record<CardinalDirection, CardinalDirection> = {
    north: "east",
    east: "south",
    south: "west",
    west: "north",
  };
  const counterClockwise: Record<CardinalDirection, CardinalDirection> = {
    north: "west",
    west: "south",
    south: "east",
    east: "north",
  };
  return (useClockwise ? clockwise : counterClockwise)[front];
}

function carveOne(cells: CandidateRoom[], envelope: Rectangle, side: CardinalDirection, ordinal: number) {
  const ranked = cells
    .map((cell, index) => ({ cell, index, removableMm: removableDepth(cell, side) }))
    .filter(({ cell, removableMm }) => (
      cell.occupied
      && !["stair", "circulation", "parking", "foyer"].includes(cell.type)
      && touchesSide(cell.bounds, envelope, side)
      && removableMm >= MIN_RECESS_MM
    ))
    .sort((left, rightCandidate) => (
      RECESS_ROOM_PRIORITY[left.cell.type] - RECESS_ROOM_PRIORITY[rightCandidate.cell.type]
      || rightCandidate.removableMm - left.removableMm
      || left.cell.id.localeCompare(rightCandidate.cell.id)
    ));
  const selected = ranked[0];
  if (!selected) return { cells, carved: false };
  const amountMm = Math.max(MIN_RECESS_MM, Math.min(selected.removableMm, 1_200 + (ordinal - 1) * 150));
  return {
    cells: cells.flatMap((cell, index) => index === selected.index ? carveCell(cell, side, amountMm, ordinal) : [cell]),
    carved: true,
  };
}

/**
 * Converts a plain rectangular planning fill into a still-exact, validated articulated footprint.
 * The envelope remains fully tiled by explicit planning cells; recesses are modeled as unbuilt,
 * open-to-sky cells so walls, drawings, structure and 3D can share one canonical geometry.
 */
export function applyFormStrategy(
  candidate: FloorCandidate,
  envelope: Rectangle,
  strategy: FormStrategy,
  front: CardinalDirection,
  seed: number,
  allowArticulation = true,
): FloorCandidate {
  if (!allowArticulation || strategy === "compact") return candidate;
  const levelOrdinal = candidate.floor.level + 1;
  const frontCarve = carveOne(candidate.cells, envelope, front, levelOrdinal);
  if (strategy !== "articulated_wings" || !frontCarve.carved) return { ...candidate, cells: frontCarve.cells };
  const sideCarve = carveOne(frontCarve.cells, envelope, orthogonalSide(front, seed ^ candidate.floor.level), 10 + candidate.floor.level);
  return { ...candidate, cells: sideCarve.cells };
}
