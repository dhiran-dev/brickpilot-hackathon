import type { CurrentBuildingRequirements } from "@/lib/building/requirements";
import type { CurrentOpening, Rectangle, WallSegment } from "@/lib/building/schema";
import type { V3AllocatedFloor, V3AllocatedScheme } from "@/lib/building/candidates/v3-allocation";
import { orthogonalPolygonBounds } from "@/lib/building/orthogonal-partition";
import { v3OpeningPolicy, v3WindowPolicy } from "@/lib/building/opening-policy-v3";
import { isV3PrivateDestination, v3SpaceAccessSemantics, type V3SpaceAccessSemantics } from "@/lib/building/space-semantics-v3";
import { DOOR_JUNCTION_CLEARANCE_MM } from "@/lib/building/v3-constants";

const EXTERIOR = "EXTERIOR";

export type V3CirculationNode = { spaceId: string; floorId: string; semantics: V3SpaceAccessSemantics };
export type V3CirculationEdge = { openingId: string; from: string; to: string; role: NonNullable<CurrentOpening["role"]> };
export type V3CirculationGraph = { nodes: V3CirculationNode[]; edges: V3CirculationEdge[]; unreachableSpaceIds: string[] };
export type V3CirculatedFloor = V3AllocatedFloor & { openings: CurrentOpening[] };
export type V3CirculatedScheme = Omit<V3AllocatedScheme, "floors"> & {
  contractVersion: "circulation-stage-v3";
  floors: V3CirculatedFloor[];
  circulationGraph: V3CirculationGraph;
  arrivalRealization: {
    mainEntryOpeningId: string;
    mainEntryWallId: string;
    primaryRoadSide: V3AllocatedScheme["arrivalReservations"]["primaryRoadSide"];
    vehicleApertureOpeningId?: string;
    secondaryEntryOpeningId?: string;
  };
};

export class V3CirculationInfeasibleError extends Error {
  constructor(readonly code: "ARRIVAL_RESERVATION_UNREALIZED" | "VEHICLE_APERTURE_UNREALIZED" | "CIRCULATION_INFEASIBLE", message: string) {
    super(message);
    this.name = "V3CirculationInfeasibleError";
  }
}

function wallLength(wall: WallSegment) {
  return Math.abs(wall.end.x - wall.start.x) + Math.abs(wall.end.y - wall.start.y);
}

function exteriorSide(wall: WallSegment, envelope: Rectangle) {
  if (wall.start.y === envelope.y && wall.end.y === envelope.y) return "north" as const;
  if (wall.start.x === envelope.x + envelope.width && wall.end.x === envelope.x + envelope.width) return "east" as const;
  if (wall.start.y === envelope.y + envelope.depth && wall.end.y === envelope.y + envelope.depth) return "south" as const;
  if (wall.start.x === envelope.x && wall.end.x === envelope.x) return "west" as const;
  return undefined;
}

function openingOnWall(input: {
  floorId: string;
  wall: WallSegment;
  id: string;
  role: NonNullable<CurrentOpening["role"]>;
  connects: [string, string];
  accessible?: boolean;
  requestedMainWidthMm?: number;
}): CurrentOpening {
  const policy = v3OpeningPolicy(input.role, input.accessible, input.requestedMainWidthMm);
  const maximum = wallLength(input.wall) - 2 * DOOR_JUNCTION_CLEARANCE_MM;
  if (maximum < policy.widthMm) throw new V3CirculationInfeasibleError(
    input.role === "vehicle_entry" ? "VEHICLE_APERTURE_UNREALIZED" : "CIRCULATION_INFEASIBLE",
    `${input.role.toUpperCase()}_WALL_TOO_SHORT:${input.wall.id}`,
  );
  return {
    id: input.id,
    floorId: input.floorId,
    wallId: input.wall.id,
    kind: policy.kind,
    usage: policy.usage,
    role: policy.role,
    materialToken: policy.materialToken,
    offsetMm: Math.floor((wallLength(input.wall) - policy.widthMm) / 2),
    widthMm: policy.widthMm,
    heightMm: policy.heightMm,
    sillHeightMm: 0,
    connects: input.connects,
    hinge: policy.kind === "door" ? "start" : "none",
    swing: policy.kind === "door" ? "clockwise" : "none",
  };
}

function hostWall(floor: V3AllocatedFloor, targetId: string, side: V3AllocatedScheme["arrivalReservations"]["primaryRoadSide"], widthMm: number) {
  const envelope = orthogonalPolygonBounds(floor.envelope);
  return floor.walls
    .filter((wall) => wall.type === "exterior" && wall.adjacentSpaceIds.includes(targetId))
    .filter((wall) => exteriorSide(wall, envelope) === side && wallLength(wall) >= widthMm + 2 * DOOR_JUNCTION_CLEARANCE_MM)
    .sort((left, right) => wallLength(right) - wallLength(left) || left.id.localeCompare(right.id))[0];
}

function sharedEdges(floor: V3AllocatedFloor) {
  return floor.walls
    .filter((wall) => wall.adjacentSpaceIds.length === 2)
    .map((wall) => ({ wall, left: wall.adjacentSpaceIds[0], right: wall.adjacentSpaceIds[1] }))
    .sort((left, right) => left.left.localeCompare(right.left) || left.right.localeCompare(right.right) || wallLength(right.wall) - wallLength(left.wall));
}

function daylightWindow(input: {
  floor: V3AllocatedFloor;
  spaceId: string;
  roomType: CurrentBuildingRequirements["rooms"][number]["type"];
  existingOpenings: CurrentOpening[];
}): CurrentOpening | undefined {
  const policy = v3WindowPolicy(input.roomType);
  if (!policy) return undefined;
  const candidate = input.floor.walls
    .filter((wall) => wall.type === "exterior" && wall.adjacentSpaceIds.includes(input.spaceId))
    .flatMap((wall) => {
      const length = wallLength(wall);
      const blocked = input.existingOpenings
        .filter((opening) => opening.wallId === wall.id)
        .map((opening) => ({
          start: Math.max(DOOR_JUNCTION_CLEARANCE_MM, opening.offsetMm - DOOR_JUNCTION_CLEARANCE_MM),
          end: Math.min(length - DOOR_JUNCTION_CLEARANCE_MM, opening.offsetMm + opening.widthMm + DOOR_JUNCTION_CLEARANCE_MM),
        }))
        .sort((left, right) => left.start - right.start);
      const intervals: Array<{ start: number; end: number }> = [];
      let cursor = DOOR_JUNCTION_CLEARANCE_MM;
      for (const span of blocked) {
        if (span.start > cursor) intervals.push({ start: cursor, end: span.start });
        cursor = Math.max(cursor, span.end);
      }
      if (cursor < length - DOOR_JUNCTION_CLEARANCE_MM) intervals.push({ start: cursor, end: length - DOOR_JUNCTION_CLEARANCE_MM });
      return intervals.map((interval) => ({ wall, interval, available: interval.end - interval.start }));
    })
    .filter(({ available }) => available >= policy.minimumWidthMm)
    .sort((left, right) => right.available - left.available || left.wall.id.localeCompare(right.wall.id))[0];
  if (!candidate) return undefined;
  const widthMm = Math.min(policy.targetWidthMm, candidate.available);
  return {
    id: `${input.floor.floorId}-window-${input.spaceId}`,
    floorId: input.floor.floorId,
    wallId: candidate.wall.id,
    kind: "window",
    usage: "daylight",
    materialToken: policy.materialToken,
    offsetMm: Math.round(candidate.interval.start + (candidate.available - widthMm) / 2),
    widthMm,
    heightMm: policy.heightMm,
    sillHeightMm: policy.sillHeightMm,
    connects: [EXTERIOR, input.spaceId],
    hinge: "none",
    swing: "none",
  };
}

export function realizeV3Circulation(requirements: CurrentBuildingRequirements, scheme: V3AllocatedScheme): V3CirculatedScheme {
  const allEdges: V3CirculationEdge[] = [];
  const allNodes: V3CirculationNode[] = [];
  const reached = new Set<string>();
  let mainEntryOpeningId = "";
  let mainEntryWallId = "";
  let vehicleApertureOpeningId: string | undefined;
  let secondaryEntryOpeningId: string | undefined;
  const roomTypeById = new Map(requirements.rooms.map((room) => [room.id, room.type]));
  const attachedBathroomBedroom = new Map<string, string>();
  for (const relationship of requirements.relationships.filter((candidate) => candidate.type === "must_connect")) {
    const fromType = roomTypeById.get(relationship.fromRoomId);
    const toType = roomTypeById.get(relationship.toRoomId);
    if (fromType === "bathroom" && toType === "bedroom") attachedBathroomBedroom.set(relationship.fromRoomId, relationship.toRoomId);
    if (toType === "bathroom" && fromType === "bedroom") attachedBathroomBedroom.set(relationship.toRoomId, relationship.fromRoomId);
  }
  const floors: V3CirculatedFloor[] = scheme.floors.map((floor) => {
    const spaces = new Map(floor.spaces.map((space) => [space.id, space]));
    const openings: CurrentOpening[] = [];
    for (const space of floor.spaces) allNodes.push({ spaceId: space.id, floorId: floor.floorId, semantics: v3SpaceAccessSemantics(space) });
    const root = floor.level === 0
      ? spaces.get(scheme.arrivalReservations.mainEntry.targetRoomId)
      : floor.spaces.find((space) => space.type === "stair") ?? floor.spaces.find((space) => space.type === "circulation") ?? floor.spaces.find((space) => space.type === "living");
    if (!root) throw new V3CirculationInfeasibleError("CIRCULATION_INFEASIBLE", `CIRCULATION_ROOT_MISSING:${floor.floorId}`);
    if (floor.level === 0) {
      const policy = v3OpeningPolicy("main_entry", root.accessible, requirements.entry.primaryDoorClearWidthMm);
      const wall = hostWall(floor, root.id, scheme.arrivalReservations.primaryRoadSide, policy.widthMm);
      if (!wall) throw new V3CirculationInfeasibleError("ARRIVAL_RESERVATION_UNREALIZED", `ARRIVAL_RESERVATION_UNREALIZED:${scheme.schemeId}`);
      const opening = openingOnWall({ floorId: floor.floorId, wall, id: `${floor.floorId}-main-entry`, role: "main_entry", connects: [EXTERIOR, root.id], accessible: root.accessible, requestedMainWidthMm: requirements.entry.primaryDoorClearWidthMm });
      openings.push(opening);
      mainEntryOpeningId = opening.id;
      mainEntryWallId = wall.id;
      allEdges.push({ openingId: opening.id, from: EXTERIOR, to: root.id, role: "main_entry" });
      reached.add(root.id);
    } else reached.add(root.id);

    const candidates = sharedEdges(floor);
    const queue = [root.id];
    const openedPairs = new Set<string>();
    while (queue.length > 0) {
      const from = queue.shift() as string;
      const fromSpace = spaces.get(from);
      if (!fromSpace) continue;
      const fromSemantics = v3SpaceAccessSemantics(fromSpace);
      if (!fromSemantics.mayRelayPedestrianAccess) continue;
      const adjacent = candidates.filter((edge) => edge.left === from || edge.right === from);
      for (const edge of adjacent) {
        const to = edge.left === from ? edge.right : edge.left;
        if (reached.has(to)) continue;
        const toSpace = spaces.get(to);
        if (!toSpace) continue;
        const toSemantics = v3SpaceAccessSemantics(toSpace);
        if (toSemantics.vehicleArrival) continue;
        if (attachedBathroomBedroom.has(to) && attachedBathroomBedroom.get(to) !== from) continue;
        const pair = [from, to].sort().join("|");
        if (openedPairs.has(pair)) continue;
        const policy = v3OpeningPolicy("interior_door", fromSpace.accessible || toSpace.accessible);
        if (wallLength(edge.wall) < policy.widthMm + 2 * DOOR_JUNCTION_CLEARANCE_MM) continue;
        const opening = openingOnWall({ floorId: floor.floorId, wall: edge.wall, id: `${floor.floorId}-interior-${openings.length + 1}`, role: "interior_door", connects: [from, to], accessible: fromSpace.accessible || toSpace.accessible });
        openings.push(opening);
        openedPairs.add(pair);
        reached.add(to);
        allEdges.push({ openingId: opening.id, from, to, role: "interior_door" });
        if (toSemantics.mayRelayPedestrianAccess) queue.push(to);
      }
    }

    for (const [bathroomId, bedroomId] of attachedBathroomBedroom) {
      if (!spaces.has(bathroomId) || !spaces.has(bedroomId) || !reached.has(bedroomId)) continue;
      const edge = candidates.find((candidate) =>
        (candidate.left === bathroomId && candidate.right === bedroomId)
        || (candidate.left === bedroomId && candidate.right === bathroomId));
      const bathroom = spaces.get(bathroomId)!;
      const bedroom = spaces.get(bedroomId)!;
      const policy = v3OpeningPolicy("interior_door", bathroom.accessible || bedroom.accessible);
      if (!edge || wallLength(edge.wall) < policy.widthMm + 2 * DOOR_JUNCTION_CLEARANCE_MM) throw new V3CirculationInfeasibleError(
        "CIRCULATION_INFEASIBLE",
        `ATTACHED_BATHROOM_CONNECTION_UNREALIZED:${bedroomId}:${bathroomId}`,
      );
      const opening = openingOnWall({
        floorId: floor.floorId,
        wall: edge.wall,
        id: `${floor.floorId}-attached-bath-${openings.length + 1}`,
        role: "interior_door",
        connects: [bedroomId, bathroomId],
        accessible: bathroom.accessible || bedroom.accessible,
      });
      openings.push(opening);
      reached.add(bathroomId);
      allEdges.push({ openingId: opening.id, from: bedroomId, to: bathroomId, role: "interior_door" });
    }

    if (floor.level === 0 && scheme.arrivalReservations.vehicleApertureReservation) {
      const reservation = scheme.arrivalReservations.vehicleApertureReservation;
      const wall = [reservation.side, ...requirements.site.roadEdges.filter((side) => side !== reservation.side)]
        .map((side) => hostWall(floor, reservation.targetRoomId, side, reservation.minimumClearWidthMm))
        .find(Boolean);
      if (!wall) throw new V3CirculationInfeasibleError("VEHICLE_APERTURE_UNREALIZED", `VEHICLE_APERTURE_UNREALIZED:${scheme.schemeId}`);
      const opening = openingOnWall({ floorId: floor.floorId, wall, id: `${floor.floorId}-vehicle-entry`, role: "vehicle_entry", connects: [EXTERIOR, reservation.targetRoomId] });
      openings.push(opening);
      vehicleApertureOpeningId = opening.id;
      allEdges.push({ openingId: opening.id, from: EXTERIOR, to: reservation.targetRoomId, role: "vehicle_entry" });
    }

    if (floor.level === 0 && scheme.arrivalReservations.secondaryEntry && requirements.entry.secondaryEntry.value !== "none" && requirements.entry.secondaryEntry.value !== "auto") {
      const target = spaces.get(scheme.arrivalReservations.secondaryEntry.targetRoomId);
      const policy = v3OpeningPolicy("service_entry", target?.accessible);
      const wall = target && hostWall(floor, target.id, scheme.arrivalReservations.secondaryEntry.side, policy.widthMm);
      if (target && wall && openings.filter((opening) => opening.connects.includes(EXTERIOR) && opening.usage === "pedestrian").length < requirements.maxExteriorPedestrianEntryCount) {
        const opening = openingOnWall({ floorId: floor.floorId, wall, id: `${floor.floorId}-service-entry`, role: "service_entry", connects: [EXTERIOR, target.id], accessible: target.accessible });
        openings.push(opening);
        secondaryEntryOpeningId = opening.id;
        reached.add(target.id);
        allEdges.push({ openingId: opening.id, from: EXTERIOR, to: target.id, role: "service_entry" });
      }
    }
    for (const room of requirements.rooms.filter((candidate) => candidate.floorId === floor.floorId && candidate.mustBeExterior)) {
      if (!spaces.has(room.id)) continue;
      const window = daylightWindow({ floor, spaceId: room.id, roomType: room.type, existingOpenings: openings });
      if (window) openings.push(window);
    }
    return { ...floor, openings };
  });

  const privateForbidden = floors.flatMap((floor) => floor.openings.filter((opening) => {
    if (opening.usage !== "pedestrian") return false;
    const types = opening.connects.map((id) => floors.flatMap((item) => item.spaces).find((space) => space.id === id)?.type);
    return types.some((type) => type && isV3PrivateDestination(type))
      && opening.connects.some((id) => id === EXTERIOR || floors.flatMap((item) => item.spaces).find((space) => space.id === id)?.type === "parking" || floors.flatMap((item) => item.spaces).find((space) => space.id === id)?.type === "verandah");
  }));
  if (privateForbidden.length > 0) throw new V3CirculationInfeasibleError("CIRCULATION_INFEASIBLE", "PRIVATE_ACCESS_FROM_OPEN_EXTERIOR");
  const unreachableSpaceIds = allNodes.filter((node) =>
    node.semantics.pedestrianDestination
    && node.semantics.role !== "arrival_court"
    && !reached.has(node.spaceId)).map((node) => node.spaceId).sort();
  if (unreachableSpaceIds.length > 0) throw new V3CirculationInfeasibleError(
    "CIRCULATION_INFEASIBLE",
    `UNREACHABLE_REQUIRED_SPACES:${unreachableSpaceIds.join(",")}`,
  );
  return {
    ...scheme,
    contractVersion: "circulation-stage-v3",
    floors,
    circulationGraph: { nodes: allNodes, edges: allEdges, unreachableSpaceIds },
    arrivalRealization: { mainEntryOpeningId, mainEntryWallId, primaryRoadSide: scheme.arrivalReservations.primaryRoadSide, vehicleApertureOpeningId, secondaryEntryOpeningId },
  };
}
