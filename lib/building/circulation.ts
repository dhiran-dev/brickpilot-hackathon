import type { Building, Floor, Opening, Space, WallSegment } from "@/lib/building/schema";
import type { BuildingRequirements, RoomType } from "@/lib/building/requirements";
import { EXTERIOR } from "@/lib/building/topology";

export type AdjacencyEdge = { wall: WallSegment; from: string; to: string };

export function wallAdjacencyEdges(floor: Floor): AdjacencyEdge[] {
  return floor.walls
    .filter((wall) => wall.adjacentSpaceIds.length === 2)
    .map((wall) => ({ wall, from: wall.adjacentSpaceIds[0], to: wall.adjacentSpaceIds[1] }));
}

export function openingUsage(opening: Opening) {
  return opening.usage ?? (opening.kind === "window" ? "daylight" : "pedestrian");
}

function openingPassable(opening: Opening) {
  return openingUsage(opening) === "pedestrian" && (opening.kind === "door" || opening.kind === "open_connection");
}

export function spaceAccessSemantics(space: Pick<Space, "occupied" | "type">) {
  return {
    pedestrian: space.occupied || ["balcony", "courtyard", "parking"].includes(space.type),
    vehicleRoad: space.type === "parking",
  };
}

const CIRCULATION_BACKBONE_TYPES = new Set<RoomType>([
  "foyer",
  "circulation",
  "living",
  "dining",
  "stair",
]);

/** Rooms that may form the shared access spine rather than acting only as destinations. */
export function isCirculationBackboneSpace(space: Pick<Space, "type">) {
  return CIRCULATION_BACKBONE_TYPES.has(space.type);
}

export function buildReachabilityGraph(floors: Floor[]) {
  const graph = new Map<string, Set<string>>();
  const add = (left: string, right: string) => {
    if (!graph.has(left)) graph.set(left, new Set());
    if (!graph.has(right)) graph.set(right, new Set());
    graph.get(left)?.add(right);
    graph.get(right)?.add(left);
  };
  for (const floor of floors) {
    for (const space of floor.spaces) if (!graph.has(space.id)) graph.set(space.id, new Set());
    for (const opening of floor.openings) if (openingPassable(opening)) add(opening.connects[0], opening.connects[1]);
  }
  return graph;
}

export function connectVerticalCirculation(graph: Map<string, Set<string>>, building: Building) {
  for (const connector of building.verticalConnectors) {
    const stairSpaces = connector.servedFloorIds
      .map((floorId) => building.floors.find((floor) => floor.id === floorId)?.spaces.find((space) => space.type === "stair")?.id)
      .filter(Boolean) as string[];
    for (let index = 1; index < stairSpaces.length; index += 1) {
      graph.get(stairSpaces[index - 1])?.add(stairSpaces[index]);
      graph.get(stairSpaces[index])?.add(stairSpaces[index - 1]);
    }
  }
  return graph;
}

export function reachableFrom(graph: Map<string, Set<string>>, start = EXTERIOR) {
  const reached = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (reached.has(current)) continue;
    reached.add(current);
    for (const next of graph.get(current) ?? []) if (!reached.has(next)) queue.push(next);
  }
  return reached;
}

export function unreachableOccupiedSpaces(building: Building) {
  const graph = connectVerticalCirculation(buildReachabilityGraph(building.floors), building);
  const reached = reachableFrom(graph);
  return building.floors.flatMap((floor) => floor.spaces.filter((space) => spaceAccessSemantics(space).pedestrian && !reached.has(space.id)));
}

export function spacesWithNoPassableOpening(floor: Floor): Space[] {
  return floor.spaces.filter((space) =>
    spaceAccessSemantics(space).pedestrian && !floor.openings.some((opening) => {
      if (!openingPassable(opening) || !opening.connects.includes(space.id)) return false;
      return space.type !== "balcony" || opening.connects.some((id) => id !== space.id && id !== EXTERIOR);
    }),
  );
}

function shortestRoute(graph: Map<string, Set<string>>, targetId: string) {
  const queue = [EXTERIOR];
  const previous = new Map<string, string | undefined>([[EXTERIOR, undefined]]);
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (current === targetId) break;
    for (const next of [...(graph.get(current) ?? [])].sort()) {
      if (previous.has(next)) continue;
      previous.set(next, current);
      queue.push(next);
    }
  }
  if (!previous.has(targetId)) return [];
  const route: string[] = [];
  let current: string | undefined = targetId;
  while (current) {
    route.unshift(current);
    current = previous.get(current);
  }
  return route;
}

function attachedBedroomsByBathroom(building: Building, requirements?: BuildingRequirements) {
  const spaceById = new Map(building.floors.flatMap((floor) => floor.spaces).map((space) => [space.id, space]));
  const attached = new Map<string, Set<string>>();
  for (const relation of requirements?.relationships ?? []) {
    if (relation.type !== "must_connect") continue;
    const from = spaceById.get(relation.fromRoomId);
    const to = spaceById.get(relation.toRoomId);
    const bedroom = from?.type === "bedroom" && to?.type === "bathroom"
      ? from
      : to?.type === "bedroom" && from?.type === "bathroom"
        ? to
        : undefined;
    const bathroom = from?.type === "bathroom" && to?.type === "bedroom"
      ? from
      : to?.type === "bathroom" && from?.type === "bedroom"
        ? to
        : undefined;
    if (!bedroom || !bathroom) continue;
    attached.set(bathroom.id, new Set([...(attached.get(bathroom.id) ?? []), bedroom.id]));
  }
  return attached;
}

export type CirculationPassageConflict = {
  target: Space;
  passageSpaces: Space[];
};

/**
 * Finds reachable rooms whose every exterior route uses a private/service room as a corridor.
 * A bathroom may use only its explicitly related bedroom as the final passage step.
 */
export function circulationPassageConflicts(building: Building, requirements?: BuildingRequirements) {
  const graph = connectVerticalCirculation(buildReachabilityGraph(building.floors), building);
  const spaces = building.floors.flatMap((floor) => floor.spaces);
  const spaceById = new Map(spaces.map((space) => [space.id, space]));
  const attached = attachedBedroomsByBathroom(building, requirements);
  const isDestinationOnly = (space: Space) => !isCirculationBackboneSpace(space);
  const output: CirculationPassageConflict[] = [];

  for (const target of spaces.filter((space) => spaceAccessSemantics(space).pedestrian)) {
    const allowedPrivatePassages = target.type === "bathroom" ? attached.get(target.id) ?? new Set<string>() : new Set<string>();
    const reached = new Set<string>();
    const queue = [EXTERIOR];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      if (reached.has(current)) continue;
      reached.add(current);
      for (const next of [...(graph.get(current) ?? [])].sort()) {
        if (reached.has(next)) continue;
        const nextSpace = spaceById.get(next);
        if (
          next !== target.id &&
          nextSpace &&
          isDestinationOnly(nextSpace) &&
          !allowedPrivatePassages.has(next)
        ) continue;
        queue.push(next);
      }
    }
    if (reached.has(target.id)) continue;

    const route = shortestRoute(graph, target.id);
    if (route.length === 0) continue;
    const passageSpaces = route
      .slice(1, -1)
      .map((id) => spaceById.get(id))
      .filter((space): space is Space => Boolean(
        space && isDestinationOnly(space) && !allowedPrivatePassages.has(space.id),
      ));
    if (passageSpaces.length > 0) output.push({ target, passageSpaces });
  }
  return output;
}
