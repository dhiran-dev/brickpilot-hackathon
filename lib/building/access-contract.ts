import { MINIMUM_ACCESS_SHARED_WALL_MM } from "@/lib/building/dimensions";
import type { RoomType } from "@/lib/building/requirements";
import type { Rectangle } from "@/lib/building/schema";

type AccessCell = {
  id: string;
  type: RoomType;
  bounds: Rectangle;
  occupied: boolean;
};

export type AccessSharedWallViolation = {
  code: "ACCESS_EDGE_TOO_SHORT" | "REQUIRED_CONNECTION_TOO_SHORT" | "ACCESS_DEPTH_EXCEEDED" | "INNER_CELL_NOT_SERVICE";
  cellIds: string[];
  measuredMm: number;
  requiredMm: number;
};

export function sharedWallLengthMm(left: Rectangle, right: Rectangle) {
  const verticalTouch = left.x + left.width === right.x || right.x + right.width === left.x;
  if (verticalTouch) {
    return Math.max(0, Math.min(left.y + left.depth, right.y + right.depth) - Math.max(left.y, right.y));
  }
  const horizontalTouch = left.y + left.depth === right.y || right.y + right.depth === left.y;
  if (horizontalTouch) {
    return Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  }
  return 0;
}

/**
 * Verifies the tiler/opening precondition: every destination is connected to the declared access
 * spine through door-capable (>=1,000 mm) shared edges, and every required direct connection has
 * that same minimum contiguous edge. Access-depth/privacy is a separate T3 parti-grammar rule.
 */
export function accessSharedWallViolations(
  cells: AccessCell[],
  accessSpineSpaceIds: readonly string[],
  requiredConnections: readonly [string, string][] = [],
  innerServiceTypes: ReadonlySet<RoomType> = new Set<RoomType>(["bathroom", "utility", "store", "pooja"]),
) {
  const byId = new Map(cells.map((cell) => [cell.id, cell]));
  const spineIds = new Set(accessSpineSpaceIds);
  const spine = cells.filter((cell) => spineIds.has(cell.id));
  const occupied = cells.filter((cell) => cell.occupied && !spineIds.has(cell.id) && cell.type !== "stair");
  const violations: AccessSharedWallViolation[] = [];
  const neighbours = new Map(cells.map((cell) => [cell.id, [] as string[]]));
  for (let leftIndex = 0; leftIndex < cells.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < cells.length; rightIndex += 1) {
      const left = cells[leftIndex];
      const right = cells[rightIndex];
      if (sharedWallLengthMm(left.bounds, right.bounds) < MINIMUM_ACCESS_SHARED_WALL_MM) continue;
      neighbours.get(left.id)?.push(right.id);
      neighbours.get(right.id)?.push(left.id);
    }
  }
  const reached = new Set<string>(spine.map((cell) => cell.id));
  const accessDepth = new Map(spine.map((cell) => [cell.id, 0]));
  const queue = [...reached];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of neighbours.get(current) ?? []) {
      if (reached.has(next)) continue;
      reached.add(next);
      accessDepth.set(next, (accessDepth.get(current) ?? 0) + 1);
      queue.push(next);
    }
  }
  for (const cell of occupied.filter((candidate) => reached.has(candidate.id))) {
    const depth = accessDepth.get(cell.id) ?? Number.POSITIVE_INFINITY;
    if (depth > 2) violations.push({
      code: "ACCESS_DEPTH_EXCEEDED",
      cellIds: [cell.id],
      measuredMm: depth,
      requiredMm: 2,
    });
    else if (depth === 2 && !innerServiceTypes.has(cell.type)) violations.push({
      code: "INNER_CELL_NOT_SERVICE",
      cellIds: [cell.id],
      measuredMm: depth,
      requiredMm: 1,
    });
  }
  for (const cell of occupied.filter((candidate) => !reached.has(candidate.id))) {
    const measured = Math.max(0, ...cells
      .filter((candidate) => candidate.id !== cell.id)
      .map((candidate) => sharedWallLengthMm(cell.bounds, candidate.bounds)));
    violations.push({ code: "ACCESS_EDGE_TOO_SHORT", cellIds: [cell.id], measuredMm: measured, requiredMm: MINIMUM_ACCESS_SHARED_WALL_MM });
  }

  for (const [leftId, rightId] of requiredConnections) {
    const left = byId.get(leftId);
    const right = byId.get(rightId);
    const measured = left && right ? sharedWallLengthMm(left.bounds, right.bounds) : 0;
    if (measured < MINIMUM_ACCESS_SHARED_WALL_MM) violations.push({
      code: "REQUIRED_CONNECTION_TOO_SHORT",
      cellIds: [leftId, rightId],
      measuredMm: measured,
      requiredMm: MINIMUM_ACCESS_SHARED_WALL_MM,
    });
  }
  return violations;
}
