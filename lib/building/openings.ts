import type { Building, Floor, Opening, Space, WallSegment } from "@/lib/building/schema";
import { isCirculationBackboneSpace, wallAdjacencyEdges } from "@/lib/building/circulation";
import { EXTERIOR, wallLength } from "@/lib/building/topology";

type OpeningOptions = {
  entranceSide: Building["site"]["facing"];
  isGroundFloor: boolean;
  requiredConnections?: Array<[string, string]>;
};

function exteriorSide(wall: WallSegment, floor: Floor): Building["site"]["facing"] | undefined {
  if (wall.start.y === floor.envelope.y && wall.end.y === floor.envelope.y) return "north";
  if (wall.start.x === floor.envelope.x + floor.envelope.width && wall.end.x === floor.envelope.x + floor.envelope.width) return "east";
  if (wall.start.y === floor.envelope.y + floor.envelope.depth && wall.end.y === floor.envelope.y + floor.envelope.depth) return "south";
  if (wall.start.x === floor.envelope.x && wall.end.x === floor.envelope.x) return "west";
  return undefined;
}

function openingOnWall(
  floor: Floor,
  wall: WallSegment,
  id: string,
  kind: Opening["kind"],
  connects: [string, string],
  desiredWidth: number,
): Opening {
  const length = wallLength(wall);
  const clearance = kind === "window" ? 250 : 150;
  const maximum = Math.max(100, length - clearance * 2);
  const width = Math.min(desiredWidth, maximum);
  const resolvedKind = kind;
  const targetSpaceId = connects[1] === EXTERIOR ? connects[0] : connects[1];
  const targetSpace = floor.spaces.find((space) => space.id === targetSpaceId);
  let swing: Opening["swing"] = "none";
  if (resolvedKind === "door") {
    const horizontal = wall.start.y === wall.end.y;
    const increasing = horizontal ? wall.end.x >= wall.start.x : wall.end.y >= wall.start.y;
    const direction = increasing ? 1 : -1;
    const start = horizontal
      ? { x: wall.start.x + direction * Math.max(50, Math.floor((length - width) / 2)), y: wall.start.y }
      : { x: wall.start.x, y: wall.start.y + direction * Math.max(50, Math.floor((length - width) / 2)) };
    const closedVector = horizontal ? { x: direction * width, y: 0 } : { x: 0, y: direction * width };
    const clockwiseLeaf = { x: start.x - closedVector.y, y: start.y + closedVector.x };
    const counterclockwiseLeaf = { x: start.x + closedVector.y, y: start.y - closedVector.x };
    const targetCenter = targetSpace
      ? { x: targetSpace.bounds.x + targetSpace.bounds.width / 2, y: targetSpace.bounds.y + targetSpace.bounds.depth / 2 }
      : clockwiseLeaf;
    const distanceSquared = (point: { x: number; y: number }) => (point.x - targetCenter.x) ** 2 + (point.y - targetCenter.y) ** 2;
    swing = distanceSquared(clockwiseLeaf) <= distanceSquared(counterclockwiseLeaf) ? "clockwise" : "counterclockwise";
  }
  return {
    id,
    floorId: floor.id,
    wallId: wall.id,
    kind: resolvedKind,
    offsetMm: Math.max(50, Math.floor((length - width) / 2)),
    widthMm: width,
    heightMm: resolvedKind === "window" ? 1200 : 2100,
    sillHeightMm: resolvedKind === "window" ? 900 : 0,
    connects,
    hinge: resolvedKind === "door" ? "start" : "none",
    swing,
  };
}

function entrancePreference(space: Space) {
  const order: Record<Space["type"], number> = {
    foyer: 0, living: 1, circulation: 2, parking: 3, stair: 4, dining: 5, study: 6, pooja: 7,
    kitchen: 8, utility: 9, store: 10, bedroom: 11, bathroom: 12, balcony: 13, courtyard: 14, terrace: 15,
  };
  return order[space.type];
}

function chooseEntrance(floor: Floor, side: Building["site"]["facing"]) {
  const byId = new Map(floor.spaces.map((space) => [space.id, space]));
  const candidates = floor.walls
    .filter((wall) => wall.type === "exterior" && exteriorSide(wall, floor) === side && wallLength(wall) >= 1200)
    .map((wall) => ({ wall, space: byId.get(wall.adjacentSpaceIds[0]) as Space }))
    .filter((candidate) => isCirculationBackboneSpace(candidate.space))
    .sort((left, right) => entrancePreference(left.space) - entrancePreference(right.space) || wallLength(right.wall) - wallLength(left.wall));
  return candidates[0] ?? floor.walls
    .filter((wall) => wall.type === "exterior" && wallLength(wall) >= 1200)
    .map((wall) => ({ wall, space: byId.get(wall.adjacentSpaceIds[0]) as Space }))
    .filter((candidate) => isCirculationBackboneSpace(candidate.space))
    .sort((left, right) => entrancePreference(left.space) - entrancePreference(right.space) || wallLength(right.wall) - wallLength(left.wall))[0];
}

function spanningDoorOpenings(floor: Floor, rootId: string, requiredConnections: Array<[string, string]> = []) {
  const edges = wallAdjacencyEdges(floor);
  const byNode = new Map<string, typeof edges>();
  for (const edge of edges) {
    byNode.set(edge.from, [...(byNode.get(edge.from) ?? []), edge]);
    byNode.set(edge.to, [...(byNode.get(edge.to) ?? []), edge]);
  }
  const bySpace = new Map(floor.spaces.map((space) => [space.id, space]));
  const attachedBedroomByBathroom = new Map<string, string>();
  for (const [leftId, rightId] of requiredConnections) {
    const left = bySpace.get(leftId);
    const right = bySpace.get(rightId);
    if (left?.type === "bedroom" && right?.type === "bathroom") attachedBedroomByBathroom.set(right.id, left.id);
    if (right?.type === "bedroom" && left?.type === "bathroom") attachedBedroomByBathroom.set(left.id, right.id);
  }
  const reached = new Set([rootId]);
  const openings: Opening[] = [];

  const addDoor = (from: string, to: string, edge: (typeof edges)[number]) => {
    const accessible = bySpace.get(from)?.accessible || bySpace.get(to)?.accessible;
    openings.push(openingOnWall(floor, edge.wall, `${floor.id}-door-${openings.length + 1}`, "door", [from, to], accessible ? 900 : 820));
    reached.add(to);
  };
  const usableEdgesFrom = (current: string) => [...(byNode.get(current) ?? [])]
    .filter((edge) => {
      const next = edge.from === current ? edge.to : edge.from;
      const desiredWidth = bySpace.get(current)?.accessible || bySpace.get(next)?.accessible ? 900 : 820;
      return wallLength(edge.wall) >= desiredWidth + 300;
    })
    .sort((left, right) => wallLength(right.wall) - wallLength(left.wall) || left.wall.id.localeCompare(right.wall.id));

  // First form one connected common-access spine. Private and service rooms never expand this graph.
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (!isCirculationBackboneSpace(bySpace.get(current) as Space)) continue;
    for (const edge of usableEdgesFrom(current)) {
      const next = edge.from === current ? edge.to : edge.from;
      const nextSpace = bySpace.get(next);
      if (reached.has(next) || !nextSpace || !isCirculationBackboneSpace(nextSpace)) continue;
      addDoor(current, next, edge);
      queue.push(next);
    }
  }

  // Then hang every ordinary room directly from the common spine as a destination leaf.
  for (const space of [...floor.spaces].sort((left, right) => left.id.localeCompare(right.id))) {
    if (reached.has(space.id) || attachedBedroomByBathroom.has(space.id)) continue;
    const edge = edges
      .filter((candidate) => candidate.from === space.id || candidate.to === space.id)
      .filter((candidate) => {
        const other = candidate.from === space.id ? candidate.to : candidate.from;
        return reached.has(other) && isCirculationBackboneSpace(bySpace.get(other) as Space);
      })
      .filter((candidate) => wallLength(candidate.wall) >= ((space.accessible ? 900 : 820) + 300))
      .sort((left, right) => wallLength(right.wall) - wallLength(left.wall) || left.wall.id.localeCompare(right.wall.id))[0];
    if (!edge) continue;
    const backboneId = edge.from === space.id ? edge.to : edge.from;
    addDoor(backboneId, space.id, edge);
  }

  // Explicitly requested attached bathrooms are the sole private-passage exception.
  for (const [bathroomId, bedroomId] of [...attachedBedroomByBathroom].sort(([left], [right]) => left.localeCompare(right))) {
    if (!reached.has(bedroomId) || reached.has(bathroomId)) continue;
    const edge = edges
      .filter((candidate) => (
        candidate.from === bathroomId && candidate.to === bedroomId
      ) || (
        candidate.to === bathroomId && candidate.from === bedroomId
      ))
      .filter((candidate) => wallLength(candidate.wall) >= 1000)
      .sort((left, right) => wallLength(right.wall) - wallLength(left.wall) || left.wall.id.localeCompare(right.wall.id))[0];
    if (edge) addDoor(bedroomId, bathroomId, edge);
  }
  return { openings, reached };
}

function windowOpenings(floor: Floor, occupiedWallIds: Set<string>) {
  const openings: Opening[] = [];
  for (const space of floor.spaces.filter((candidate) => candidate.occupied && !["bathroom", "store", "circulation", "stair"].includes(candidate.type))) {
    const wall = floor.walls
      .filter((candidate) => candidate.type === "exterior" && candidate.adjacentSpaceIds[0] === space.id && !occupiedWallIds.has(candidate.id) && wallLength(candidate) >= 900)
      .sort((left, right) => wallLength(right) - wallLength(left) || left.id.localeCompare(right.id))[0];
    if (!wall) continue;
    const desiredWidth = Math.min(1800, Math.max(750, Math.round(Math.sqrt(space.areaMm2) * 0.35)));
    openings.push(openingOnWall(floor, wall, `${floor.id}-window-${openings.length + 1}`, "window", [space.id, EXTERIOR], desiredWidth));
    occupiedWallIds.add(wall.id);
  }
  return openings;
}

export function placeFloorOpenings(floor: Floor, options: OpeningOptions): Floor {
  let rootId: string;
  const openings: Opening[] = [];
  if (options.isGroundFloor) {
    const entrance = chooseEntrance(floor, options.entranceSide);
    if (!entrance) return floor;
    rootId = entrance.space.id;
    openings.push(openingOnWall(floor, entrance.wall, `${floor.id}-entrance`, "door", [EXTERIOR, rootId], entrance.space.accessible ? 1000 : 900));
  } else {
    rootId = floor.spaces.find((space) => space.type === "stair")?.id ?? floor.spaces[0].id;
  }
  const doors = spanningDoorOpenings(floor, rootId, options.requiredConnections).openings;
  openings.push(...doors);
  for (const [leftId, rightId] of options.requiredConnections ?? []) {
    if (openings.some((opening) => opening.kind !== "window" && opening.connects.includes(leftId) && opening.connects.includes(rightId))) continue;
    const wall = floor.walls.find((candidate) =>
      candidate.adjacentSpaceIds.length === 2 && candidate.adjacentSpaceIds.includes(leftId) && candidate.adjacentSpaceIds.includes(rightId),
    );
    if (!wall) continue;
    const bySpace = new Map(floor.spaces.map((space) => [space.id, space]));
    const desiredWidth = bySpace.get(leftId)?.accessible || bySpace.get(rightId)?.accessible ? 900 : 700;
    if (wallLength(wall) < desiredWidth + 300) continue;
    openings.push(openingOnWall(
      floor,
      wall,
      `${floor.id}-required-door-${openings.length + 1}`,
      "door",
      [leftId, rightId],
      desiredWidth,
    ));
  }
  const occupiedWallIds = new Set(openings.map((opening) => opening.wallId));
  openings.push(...windowOpenings(floor, occupiedWallIds));
  return { ...floor, openings };
}
