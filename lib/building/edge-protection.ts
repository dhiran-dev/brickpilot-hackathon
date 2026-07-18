import type { CurrentBuildingRequirements } from "@/lib/building/requirements";
import type { EdgeProtection, Segment2, WallSegment } from "@/lib/building/schema";
import type { V3CirculatedScheme } from "@/lib/building/candidates/v3-circulation";
import { DEFAULT_GUARD_HEIGHT_MM, GUARD_TRIGGER_DROP_MM } from "@/lib/building/v3-constants";

function segmentKey(segment: Segment2) {
  const points = [segment.start, segment.end].sort((left, right) => left.x - right.x || left.y - right.y);
  return `${points[0].x}:${points[0].y}:${points[1].x}:${points[1].y}`;
}

function wallSegment(wall: WallSegment): Segment2 {
  return { start: wall.start, end: wall.end };
}

/** Generates only hazardous-drop guards; ground-level decorative rails are intentionally omitted. */
export function deriveV3EdgeProtections(requirements: CurrentBuildingRequirements, scheme: V3CirculatedScheme): EdgeProtection[] {
  const protections: EdgeProtection[] = [];
  for (const floor of scheme.floors) {
    if (floor.elevationMm < GUARD_TRIGGER_DROP_MM) continue;
    const guardedSpaceIds = new Set(floor.spaces.filter((space) => space.type === "balcony" || space.type === "verandah" || space.type === "terrace").map((space) => space.id));
    const candidates = floor.walls.filter((wall) => wall.type === "exterior" && wall.adjacentSpaceIds.some((id) => guardedSpaceIds.has(id)));
    const openingWallIds = new Set(floor.openings.filter((opening) => opening.usage === "pedestrian").map((opening) => opening.wallId));
    for (const [index, wall] of candidates.entries()) {
      if (openingWallIds.has(wall.id)) continue;
      protections.push({
        id: `${floor.floorId}-guard-${index + 1}-${segmentKey(wallSegment(wall))}`,
        floorId: floor.floorId,
        edge: wallSegment(wall),
        kind: requirements.budget.qualityTier === "premium" ? "glass_rail" : "metal_rail",
        heightMm: DEFAULT_GUARD_HEIGHT_MM,
        dropHeightMm: floor.elevationMm,
      });
    }
  }
  return protections;
}
