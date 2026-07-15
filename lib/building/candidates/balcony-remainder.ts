import type { Rectangle } from "@/lib/building/schema";
import type { CandidateRoom } from "@/lib/building/candidates/types";

const BALCONY_TARGET_TOLERANCE_MM2 = 2_000_000;

/** Keeps sparse-floor residual area explicit instead of mislabelling it as an enormous balcony. */
export function splitOversizedBalconies(cells: CandidateRoom[], envelope: Rectangle) {
  return cells.flatMap((cell): CandidateRoom[] => {
    if (cell.type !== "balcony" || cell.bounds.width * cell.bounds.depth <= cell.targetAreaMm2 + BALCONY_TARGET_TOLERANCE_MM2) return [cell];
    const { bounds } = cell;
    const touchesNorth = bounds.y === envelope.y;
    const touchesSouth = bounds.y + bounds.depth === envelope.y + envelope.depth;
    const touchesWest = bounds.x === envelope.x;
    const touchesEast = bounds.x + bounds.width === envelope.x + envelope.width;
    const horizontalFacade = (touchesNorth || touchesSouth) && (!touchesWest && !touchesEast || bounds.width >= bounds.depth);
    let balconyBounds: Rectangle;
    let terraceBounds: Rectangle;
    if (horizontalFacade) {
      const depth = Math.max(1, Math.min(bounds.depth - 1, Math.floor(cell.targetAreaMm2 / bounds.width)));
      const balconyY = touchesSouth ? bounds.y + bounds.depth - depth : bounds.y;
      balconyBounds = { x: bounds.x, y: balconyY, width: bounds.width, depth };
      terraceBounds = touchesSouth
        ? { x: bounds.x, y: bounds.y, width: bounds.width, depth: bounds.depth - depth }
        : { x: bounds.x, y: bounds.y + depth, width: bounds.width, depth: bounds.depth - depth };
    } else {
      const width = Math.max(1, Math.min(bounds.width - 1, Math.floor(cell.targetAreaMm2 / bounds.depth)));
      const balconyX = touchesEast ? bounds.x + bounds.width - width : bounds.x;
      balconyBounds = { x: balconyX, y: bounds.y, width, depth: bounds.depth };
      terraceBounds = touchesEast
        ? { x: bounds.x, y: bounds.y, width: bounds.width - width, depth: bounds.depth }
        : { x: bounds.x + width, y: bounds.y, width: bounds.width - width, depth: bounds.depth };
    }
    const terraceArea = terraceBounds.width * terraceBounds.depth;
    return [
      { ...cell, bounds: balconyBounds },
      {
        id: `${cell.id}-open-terrace`,
        name: "Open terrace / unbuilt",
        type: "terrace",
        floorId: cell.floorId,
        minAreaMm2: terraceArea,
        targetAreaMm2: terraceArea,
        accessible: false,
        bounds: terraceBounds,
        occupied: false,
      },
    ];
  });
}
