import { minimumClearDimensionMm } from "@/lib/building/dimensions";
import { resolveRoomAreaPolicy, type ResolvedRoomAreaPolicy } from "@/lib/building/area-policy-v3";
import type { CurrentBuildingRequirements, RoomRequirement } from "@/lib/building/requirements";
import type { FloorRegion, OrthogonalPolygon, Rectangle, WallSegment } from "@/lib/building/schema";
import {
  auditOrthogonalPartition,
  normalizeOrthogonalPolygon,
  orthogonalPolygonAreaMm2,
  orthogonalPolygonBounds,
  rectangleToOrthogonalPolygon,
  residualRectangles,
  type PartitionCoverageAudit,
} from "@/lib/building/orthogonal-partition";
import type { V3TopologyScheme } from "@/lib/building/generate-v3-topology";
import { DOOR_JUNCTION_CLEARANCE_MM, MAIN_ENTRY_MIN_WALL_RUN_MM } from "@/lib/building/v3-constants";
import {
  allocateZonedFloor,
  allocateZonedUpperFloor,
  type ZonedAllocationRejection,
} from "@/lib/building/candidates/v3-zoned-allocation";

const ALLOCATION_GRID_MM = 100;
const DENSE_ORDER_ATTEMPT_LIMIT = 1_000;
const PEDESTRIAN_RELAY_ROOM_TYPES = new Set<RoomRequirement["type"]>([
  "foyer",
  "circulation",
  "living",
  "dining",
  "stair",
]);

export type DerivedAllocatedSpace = {
  id: string;
  floorId: string;
  name: string;
  type: RoomRequirement["type"];
  regionId: string;
  bounds: Rectangle;
  areaMm2: number;
  accessible: boolean;
};

export type AboveParkingAllocation = {
  floorId: string;
  use: "occupied_rooms" | "balcony" | "terrace" | "unbuilt";
  parkingProjection: OrthogonalPolygon;
  realizedRegionIds: string[];
};

export type V3AllocatedFloor = {
  floorId: string;
  label: string;
  level: number;
  elevationMm: number;
  floorHeightMm: number;
  envelope: OrthogonalPolygon;
  regions: FloorRegion[];
  spaces: DerivedAllocatedSpace[];
  walls: WallSegment[];
  constructedFootprints: OrthogonalPolygon[];
  intentionalUnbuiltRegions: FloorRegion[];
  coverage: PartitionCoverageAudit;
  targetProgramAreaMm2: number;
  allocatedProgramAreaMm2: number;
  surplusPenalty: number;
  footprintExpandedForProgram: boolean;
};

export type V3AllocatedScheme = {
  schemeId: string;
  partiId: V3TopologyScheme["partiId"];
  topologySchemeId: string;
  arrivalReservations: Pick<V3TopologyScheme["topology"], "primaryRoadSide" | "mainEntry" | "secondaryEntry" | "foyerWallRunReservation" | "vehicleApertureReservation">;
  floors: V3AllocatedFloor[];
  aboveParking: AboveParkingAllocation[];
  areaPolicies: ResolvedRoomAreaPolicy[];
  surplusPenalty: number;
};

export class ProgramAreaInfeasibleError extends Error {
  constructor(
    readonly requirementIds: string[],
    message: string,
    readonly planningDiagnostics?: {
      evaluatedCandidateCount: number;
      rejections: ZonedAllocationRejection[];
    },
  ) {
    super(message);
    this.name = "ProgramAreaInfeasibleError";
  }
}

function zonedFailureDiagnostics(error: Error) {
  const details = error as Error & {
    evaluatedCandidateCount?: unknown;
    rejections?: unknown;
    requirementIds?: unknown;
  };
  return {
    requirementIds: Array.isArray(details.requirementIds)
      ? details.requirementIds.filter((value): value is string => typeof value === "string")
      : [],
    planningDiagnostics: {
      evaluatedCandidateCount: typeof details.evaluatedCandidateCount === "number"
        ? details.evaluatedCandidateCount
        : 0,
      rejections: Array.isArray(details.rejections)
        ? details.rejections as ZonedAllocationRejection[]
        : [],
    },
  };
}

function ceilGrid(value: number) {
  return Math.ceil(value / ALLOCATION_GRID_MM) * ALLOCATION_GRID_MM;
}

function overlapArea(left: Rectangle, right: Rectangle) {
  return Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x))
    * Math.max(0, Math.min(left.y + left.depth, right.y + right.depth) - Math.max(left.y, right.y));
}

function polygonContainsPoint(polygon: OrthogonalPolygon, x: number, y: number) {
  let inside = false;
  for (let current = 0, previous = polygon.points.length - 1; current < polygon.points.length; previous = current, current += 1) {
    const a = polygon.points[current];
    const b = polygon.points[previous];
    if (((a.y > y) !== (b.y > y)) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function rectangleInsideAnyFootprint(rectangle: Rectangle, footprints: OrthogonalPolygon[]) {
  const samples = [
    [rectangle.x + 1, rectangle.y + 1],
    [rectangle.x + rectangle.width - 1, rectangle.y + 1],
    [rectangle.x + 1, rectangle.y + rectangle.depth - 1],
    [rectangle.x + rectangle.width - 1, rectangle.y + rectangle.depth - 1],
    [rectangle.x + rectangle.width / 2, rectangle.y + rectangle.depth / 2],
  ];
  return samples.every(([x, y]) => footprints.some((polygon) => polygonContainsPoint(polygon, x, y)));
}

function dimensionCandidates(room: RoomRequirement, policy: ResolvedRoomAreaPolicy, envelope: Rectangle, allocationTargetAreaMm2: number, minimumDimensionMm = 0) {
  const minimum = ceilGrid(Math.max(
    minimumClearDimensionMm(room.type, room.accessible),
    room.type === "foyer" ? MAIN_ENTRY_MIN_WALL_RUN_MM : 0,
    minimumDimensionMm,
  ));
  const target = Math.max(policy.minimumAreaMm2, allocationTargetAreaMm2);
  const candidates: Rectangle[] = [];
  for (let width = minimum; width <= envelope.width; width += 500) {
    const depth = Math.max(minimum, ceilGrid(target / width));
    if (depth > envelope.depth) continue;
    const area = width * depth;
    if (area < policy.minimumAreaMm2 || area > policy.hardMaximumAreaMm2) continue;
    candidates.push({ x: 0, y: 0, width, depth });
    if (width !== depth && depth <= envelope.width && width <= envelope.depth) candidates.push({ x: 0, y: 0, width: depth, depth: width });
  }
  return candidates.sort((left, right) =>
    (room.type === "circulation"
      ? Math.min(left.width, left.depth) - Math.min(right.width, right.depth)
      : Math.abs(left.width * left.depth - target) - Math.abs(right.width * right.depth - target))
    || Math.abs(left.width * left.depth - target) - Math.abs(right.width * right.depth - target)
    || Math.abs(left.width / left.depth - 1) - Math.abs(right.width / right.depth - 1)
    || left.width - right.width,
  );
}

function axisOrigins(start: number, span: number, size: number, preferredCenter: number) {
  const values: number[] = [];
  for (let value = start; value + size <= start + span; value += ALLOCATION_GRID_MM) values.push(value);
  return values.sort((left, right) =>
    Math.abs(left + size / 2 - preferredCenter) - Math.abs(right + size / 2 - preferredCenter)
    || left - right,
  ).slice(0, 200);
}

type RequiredBoundary = {
  side: "north" | "east" | "south" | "west";
  minimumWallRunMm: number;
};

function rectangleSatisfiesBoundary(rectangle: Rectangle, envelope: Rectangle, boundary: RequiredBoundary) {
  if (boundary.side === "north") return rectangle.y === envelope.y && rectangle.width >= boundary.minimumWallRunMm;
  if (boundary.side === "south") return rectangle.y + rectangle.depth === envelope.y + envelope.depth && rectangle.width >= boundary.minimumWallRunMm;
  if (boundary.side === "west") return rectangle.x === envelope.x && rectangle.depth >= boundary.minimumWallRunMm;
  return rectangle.x + rectangle.width === envelope.x + envelope.width && rectangle.depth >= boundary.minimumWallRunMm;
}

function sharedBoundaryLength(left: Rectangle, right: Rectangle) {
  if (left.x + left.width === right.x || right.x + right.width === left.x) {
    return Math.max(0, Math.min(left.y + left.depth, right.y + right.depth) - Math.max(left.y, right.y));
  }
  if (left.y + left.depth === right.y || right.y + right.depth === left.y) {
    return Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  }
  return 0;
}

function placeRoom(input: {
  room: RoomRequirement;
  policy: ResolvedRoomAreaPolicy;
  envelope: Rectangle;
  preferred: { x: number; y: number };
  topologyFootprints: OrthogonalPolygon[];
  occupied: Rectangle[];
  forbidden: Rectangle[];
  allocationTargetAreaMm2: number;
  requiredBoundary?: RequiredBoundary;
  requiredAdjacentRectangles?: Rectangle[];
  minimumSharedWallMm?: number;
  minimumDimensionMm?: number;
}) {
  const dimensions = dimensionCandidates(input.room, input.policy, input.envelope, input.allocationTargetAreaMm2, input.minimumDimensionMm);
  for (const preferTopology of [true, false]) for (const dimension of dimensions) {
    const boundary = input.requiredBoundary;
    const wallRun = boundary && (boundary.side === "north" || boundary.side === "south")
      ? dimension.width
      : dimension.depth;
    if (boundary && wallRun < boundary.minimumWallRunMm) continue;
    const xs = boundary?.side === "west"
      ? [input.envelope.x]
      : boundary?.side === "east"
        ? [input.envelope.x + input.envelope.width - dimension.width]
        : axisOrigins(input.envelope.x, input.envelope.width, dimension.width, input.preferred.x);
    const ys = boundary?.side === "north"
      ? [input.envelope.y]
      : boundary?.side === "south"
        ? [input.envelope.y + input.envelope.depth - dimension.depth]
        : axisOrigins(input.envelope.y, input.envelope.depth, dimension.depth, input.preferred.y);
    for (const x of xs) for (const y of ys) {
      const rectangle = { x, y, width: dimension.width, depth: dimension.depth };
      if (input.occupied.some((item) => overlapArea(item, rectangle) > 0) || input.forbidden.some((item) => overlapArea(item, rectangle) > 0)) continue;
      if (input.requiredAdjacentRectangles?.length
        && !input.requiredAdjacentRectangles.some((adjacent) => sharedBoundaryLength(adjacent, rectangle) >= (input.minimumSharedWallMm ?? 1_000))) continue;
      if (preferTopology && input.room.type !== "courtyard" && !rectangleInsideAnyFootprint(rectangle, input.topologyFootprints)) continue;
      return { rectangle, footprintExpanded: !preferTopology };
    }
  }
  throw new ProgramAreaInfeasibleError([input.policy.requirementId], `PROGRAM_AREA_INFEASIBLE:${input.policy.requirementId}`);
}

function aboveParkingOutdoorCandidates(input: {
  room: RoomRequirement;
  policy: ResolvedRoomAreaPolicy;
  projection: Rectangle;
  occupied: Rectangle[];
  adjacent: Rectangle[];
  targetAreaMm2: number;
  placementEnvelope?: Rectangle;
}) {
  const placementEnvelope = input.placementEnvelope ?? input.projection;
  const target = Math.min(input.targetAreaMm2, input.projection.width * input.projection.depth);
  const dimensions = [
    target,
    Math.round((target + input.policy.minimumAreaMm2) / 2),
    input.policy.minimumAreaMm2,
  ].flatMap((candidateTarget) => dimensionCandidates(
    input.room,
    input.policy,
    placementEnvelope,
    candidateTarget,
  )).filter((dimension, index, candidates) =>
    candidates.findIndex((candidate) =>
      candidate.width === dimension.width && candidate.depth === dimension.depth,
    ) === index,
  );
  const right = input.projection.x + input.projection.width;
  const bottom = input.projection.y + input.projection.depth;
  const placements: Array<{ rectangle: Rectangle; footprintExpanded: true }> = [];
  for (const dimension of dimensions) {
    const clampX = (value: number) => Math.max(
      placementEnvelope.x,
      Math.min(placementEnvelope.x + placementEnvelope.width - dimension.width, value),
    );
    const clampY = (value: number) => Math.max(
      placementEnvelope.y,
      Math.min(placementEnvelope.y + placementEnvelope.depth - dimension.depth, value),
    );
    const xs = new Set([
      clampX(input.projection.x),
      clampX(right - dimension.width),
      clampX(input.projection.x - Math.floor(dimension.width / 2)),
      clampX(right - Math.ceil(dimension.width / 2)),
      ...input.adjacent.flatMap((rectangle) => [
        clampX(rectangle.x),
        clampX(rectangle.x + rectangle.width - dimension.width),
      ]),
    ]);
    const ys = new Set([
      clampY(input.projection.y),
      clampY(bottom - dimension.depth),
      clampY(input.projection.y - Math.floor(dimension.depth / 2)),
      clampY(bottom - Math.ceil(dimension.depth / 2)),
      ...input.adjacent.flatMap((rectangle) => [
        clampY(rectangle.y),
        clampY(rectangle.y + rectangle.depth - dimension.depth),
      ]),
    ]);
    for (const x of [...xs].sort((left, candidate) => left - candidate)) {
      for (const y of [...ys].sort((left, candidate) => left - candidate)) {
        const rectangle = { x, y, width: dimension.width, depth: dimension.depth };
        if (overlapArea(rectangle, input.projection) * 2 < rectangle.width * rectangle.depth) continue;
        if (input.occupied.some((candidate) => overlapArea(candidate, rectangle) > 0)) continue;
        if (input.adjacent.length > 0
          && !input.adjacent.some((candidate) => sharedBoundaryLength(candidate, rectangle) >= 1_000)) continue;
        placements.push({ rectangle, footprintExpanded: true });
      }
    }
  }
  return placements;
}

function placeAboveParkingOutdoor(input: Parameters<typeof aboveParkingOutdoorCandidates>[0]) {
  return aboveParkingOutdoorCandidates(input)[0];
}

function regionKind(room: RoomRequirement): FloorRegion["kind"] {
  if (room.type === "parking" || room.type === "balcony" || room.type === "verandah") return "covered_outdoor";
  if (room.type === "courtyard" || room.type === "terrace") return "open_to_sky";
  return "interior";
}

function pointRegion(regions: FloorRegion[], x: number, y: number) {
  return regions.find((region) => region.spaceId && region.kind !== "open_to_sky" && polygonContainsPoint(region.polygon, x, y));
}

function deriveWalls(
  floorId: string,
  envelope: Rectangle,
  regions: FloorRegion[],
  rooms: readonly RoomRequirement[],
): WallSegment[] {
  const roomTypeById = new Map(rooms.map((room) => [room.id, room.type]));
  const isOpenDaylightEdge = (region: FloorRegion | undefined) =>
    region?.kind === "open_to_sky"
    || (region?.spaceId
      ? roomTypeById.get(region.spaceId) === "verandah"
        || roomTypeById.get(region.spaceId) === "balcony"
      : false);
  const wallRole = (left: FloorRegion | undefined, right: FloorRegion | undefined) => {
    const enclosureBoundary = left && right
      && isOpenDaylightEdge(left) !== isOpenDaylightEdge(right)
      && (isOpenDaylightEdge(left) || isOpenDaylightEdge(right));
    return {
      type: left && right && !enclosureBoundary ? "interior" as const : "exterior" as const,
      thicknessMm: left && right && !enclosureBoundary ? 115 : 230,
    };
  };
  const xs = [...new Set([envelope.x, envelope.x + envelope.width, ...regions.flatMap((region) => region.polygon.points.map((point) => point.x))])].sort((a, b) => a - b);
  const ys = [...new Set([envelope.y, envelope.y + envelope.depth, ...regions.flatMap((region) => region.polygon.points.map((point) => point.y))])].sort((a, b) => a - b);
  const walls: WallSegment[] = [];
  for (const x of xs) for (let index = 0; index < ys.length - 1; index += 1) {
    const from = ys[index];
    const to = ys[index + 1];
    const middle = (from + to) / 2;
    const left = pointRegion(regions, x - 0.25, middle);
    const right = pointRegion(regions, x + 0.25, middle);
    if (left?.spaceId === right?.spaceId || (!left && !right)) continue;
    const role = wallRole(left, right);
    walls.push({
      id: `${floorId}-wall-v-${x}-${from}-${to}`,
      floorId,
      start: { x, y: from },
      end: { x, y: to },
      thicknessMm: role.thicknessMm,
      type: role.type,
      adjacentSpaceIds: [left?.spaceId, right?.spaceId].filter((value): value is string => Boolean(value)).sort(),
    });
  }
  for (const y of ys) for (let index = 0; index < xs.length - 1; index += 1) {
    const from = xs[index];
    const to = xs[index + 1];
    const middle = (from + to) / 2;
    const above = pointRegion(regions, middle, y - 0.25);
    const below = pointRegion(regions, middle, y + 0.25);
    if (above?.spaceId === below?.spaceId || (!above && !below)) continue;
    const role = wallRole(above, below);
    walls.push({
      id: `${floorId}-wall-h-${y}-${from}-${to}`,
      floorId,
      start: { x: from, y },
      end: { x: to, y },
      thicknessMm: role.thicknessMm,
      type: role.type,
      adjacentSpaceIds: [above?.spaceId, below?.spaceId].filter((value): value is string => Boolean(value)).sort(),
    });
  }
  const ordered = walls.sort((left, right) => {
    const leftHorizontal = left.start.y === left.end.y;
    const rightHorizontal = right.start.y === right.end.y;
    return Number(leftHorizontal) - Number(rightHorizontal)
      || (leftHorizontal ? left.start.y - right.start.y : left.start.x - right.start.x)
      || (leftHorizontal ? left.start.x - right.start.x : left.start.y - right.start.y);
  });
  const merged: WallSegment[] = [];
  for (const wall of ordered) {
    const previous = merged.at(-1);
    const horizontal = wall.start.y === wall.end.y;
    const sameRole = previous
      && previous.type === wall.type
      && previous.thicknessMm === wall.thicknessMm
      && previous.adjacentSpaceIds.join("|") === wall.adjacentSpaceIds.join("|");
    const contiguous = previous && (horizontal
      ? previous.start.y === wall.start.y && previous.end.x === wall.start.x
      : previous.start.x === wall.start.x && previous.end.y === wall.start.y);
    if (sameRole && contiguous) previous.end = wall.end;
    else merged.push({ ...wall });
  }
  return merged.map((wall, index) => ({ ...wall, id: `${floorId}-wall-${index + 1}` }));
}

function resolvedAboveParkingUse(requirements: CurrentBuildingRequirements, floorId: string) {
  const requested = requirements.aboveParkingUse.value;
  if (requested !== "auto") return requested;
  return requirements.rooms.some((room) => room.floorId === floorId && !["balcony", "terrace", "circulation"].includes(room.type))
    ? "occupied_rooms" as const
    : "unbuilt" as const;
}

function zonedAboveParkingCompatible(input: {
  placements: ReadonlyMap<string, Rectangle>;
  rooms: readonly RoomRequirement[];
  use: ReturnType<typeof resolvedAboveParkingUse> | undefined;
  targetId?: string;
  projection?: Rectangle;
}) {
  if (!input.use || !input.projection) return true;
  const roomById = new Map(input.rooms.map((room) => [room.id, room]));
  const overlaps = [...input.placements].filter(([, rectangle]) =>
    overlapArea(rectangle, input.projection!) > 0);
  if (input.use === "unbuilt") return overlaps.length === 0;
  if (input.use === "occupied_rooms") {
    return overlaps.some(([roomId]) =>
      !["balcony", "terrace", "circulation", "stair"].includes(roomById.get(roomId)?.type ?? ""));
  }
  const target = input.targetId ? input.placements.get(input.targetId) : undefined;
  if (!target || overlapArea(target, input.projection) !== target.width * target.depth) return false;
  return overlaps.every(([roomId]) => roomId === input.targetId);
}

function denseProgramPlacements(input: {
  rooms: RoomRequirement[];
  targetByRoom: Map<string, number>;
  policyByRoom: Map<string, ResolvedRoomAreaPolicy>;
  envelope: Rectangle;
  entrySide: "north" | "east" | "south" | "west";
  requiredBoundaryRoom?: { roomId: string; boundary: RequiredBoundary };
  additionalBoundaryRoom?: { roomId: string; boundary: RequiredBoundary };
  rootRoomId: string;
  attachedBathroomBedroom: ReadonlyMap<string, string>;
}) {
  const targetArea = [...input.targetByRoom.values()].reduce((sum, value) => sum + value, 0);
  let plate: Rectangle;
  if (input.entrySide === "north" || input.entrySide === "south") {
    const depth = ceilGrid(targetArea / input.envelope.width);
    plate = {
      x: input.envelope.x,
      y: input.entrySide === "south" ? input.envelope.y + input.envelope.depth - depth : input.envelope.y,
      width: input.envelope.width,
      depth,
    };
  } else {
    const width = ceilGrid(targetArea / input.envelope.depth);
    plate = {
      x: input.entrySide === "east" ? input.envelope.x + input.envelope.width - width : input.envelope.x,
      y: input.envelope.y,
      width,
      depth: input.envelope.depth,
    };
  }
  if (plate.width > input.envelope.width || plate.depth > input.envelope.depth) throw new ProgramAreaInfeasibleError(
    input.rooms.map((room) => room.id),
    "PROGRAM_AREA_INFEASIBLE:dense_plate",
  );
  function partition(placements: Map<string, Rectangle>, rooms: RoomRequirement[], bounds: Rectangle, depth: number) {
    if (rooms.length === 1) {
      placements.set(rooms[0].id, bounds);
      return;
    }
    const total = rooms.reduce((sum, room) => sum + (input.targetByRoom.get(room.id) ?? room.minAreaMm2), 0);
    let running = 0;
    let splitIndex = 1;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (let index = 1; index < rooms.length; index += 1) {
      running += input.targetByRoom.get(rooms[index - 1].id) ?? rooms[index - 1].minAreaMm2;
      const delta = Math.abs(total / 2 - running);
      if (delta < bestDelta) { bestDelta = delta; splitIndex = index; }
    }
    const first = rooms.slice(0, splitIndex);
    const second = rooms.slice(splitIndex);
    const firstWeight = first.reduce((sum, room) => sum + (input.targetByRoom.get(room.id) ?? room.minAreaMm2), 0);
    const vertical = bounds.width > bounds.depth || (bounds.width === bounds.depth && depth % 2 === 0);
    if (vertical) {
      const width = Math.max(ALLOCATION_GRID_MM, Math.min(bounds.width - ALLOCATION_GRID_MM, ceilGrid(bounds.width * firstWeight / total)));
      partition(placements, first, { ...bounds, width }, depth + 1);
      partition(placements, second, { x: bounds.x + width, y: bounds.y, width: bounds.width - width, depth: bounds.depth }, depth + 1);
    } else {
      const splitDepth = Math.max(ALLOCATION_GRID_MM, Math.min(bounds.depth - ALLOCATION_GRID_MM, ceilGrid(bounds.depth * firstWeight / total)));
      partition(placements, first, { ...bounds, depth: splitDepth }, depth + 1);
      partition(placements, second, { x: bounds.x, y: bounds.y + splitDepth, width: bounds.width, depth: bounds.depth - splitDepth }, depth + 1);
    }
  }

  function connectivityValid(placements: ReadonlyMap<string, Rectangle>) {
    const roomsById = new Map(input.rooms.map((room) => [room.id, room]));
    const reached = new Set([input.rootRoomId]);
    const queue = [input.rootRoomId];
    const relayTypes = new Set<RoomRequirement["type"]>(["foyer", "circulation", "living", "dining", "stair"]);
    while (queue.length) {
      const from = queue.shift()!;
      const fromRectangle = placements.get(from);
      if (!fromRectangle) return false;
      for (const room of input.rooms) {
        if (reached.has(room.id) || room.type === "parking" || room.type === "courtyard" || room.type === "terrace") continue;
        if (input.attachedBathroomBedroom.has(room.id) && input.attachedBathroomBedroom.get(room.id) !== from) continue;
        const rectangle = placements.get(room.id);
        if (!rectangle || sharedBoundaryLength(fromRectangle, rectangle) < 1_000) continue;
        reached.add(room.id);
        if (relayTypes.has(room.type)) queue.push(room.id);
      }
    }
    for (const [bathroomId, bedroomId] of input.attachedBathroomBedroom) {
      const bathroom = placements.get(bathroomId);
      const bedroom = placements.get(bedroomId);
      if (bathroom && bedroom && reached.has(bedroomId) && sharedBoundaryLength(bathroom, bedroom) >= 1_000) reached.add(bathroomId);
    }
    return input.rooms.every((room) =>
      room.type === "parking"
      || room.type === "courtyard"
      || room.type === "terrace"
      || (roomsById.has(room.id) && reached.has(room.id)));
  }

  const pinned = input.requiredBoundaryRoom
    ? input.rooms.find((room) => room.id === input.requiredBoundaryRoom?.roomId)
    : undefined;
  const additionalPinned = input.additionalBoundaryRoom
    ? input.rooms.find((room) => room.id === input.additionalBoundaryRoom?.roomId)
    : undefined;
  const movable = input.rooms.filter((room) => room.id !== pinned?.id && room.id !== additionalPinned?.id);
  const orders: RoomRequirement[][] = [];
  const seenOrders = new Set<string>();
  const pinnedLast = input.requiredBoundaryRoom?.boundary.side === "south"
    || input.requiredBoundaryRoom?.boundary.side === "east";
  function appendOrders(movableOrder: RoomRequirement[]) {
    const candidates = pinned && additionalPinned
      ? pinnedLast
        ? [[...movableOrder, additionalPinned, pinned], [...movableOrder, pinned, additionalPinned]]
        : [[pinned, additionalPinned, ...movableOrder], [additionalPinned, pinned, ...movableOrder]]
      : [pinned ? (pinnedLast ? [...movableOrder, pinned] : [pinned, ...movableOrder]) : movableOrder];
    for (const candidate of candidates) {
      const key = candidate.map((room) => room.id).join("|");
      if (seenOrders.has(key)) continue;
      seenOrders.add(key);
      orders.push(candidate);
      if (orders.length >= DENSE_ORDER_ATTEMPT_LIMIT) return;
    }
  }
  const prefixBudget = Math.min(250, DENSE_ORDER_ATTEMPT_LIMIT);
  const used = new Set<number>();
  function collectPrefix(current: RoomRequirement[]) {
    if (orders.length >= prefixBudget) return;
    if (current.length === movable.length) {
      appendOrders(current);
      return;
    }
    for (let index = 0; index < movable.length; index += 1) {
      if (used.has(index)) continue;
      used.add(index);
      collectPrefix([...current, movable[index]]);
      used.delete(index);
      if (orders.length >= prefixBudget) return;
    }
  }
  appendOrders(movable);
  appendOrders([...movable].reverse());
  collectPrefix([]);

  const relayTypes = new Set<RoomRequirement["type"]>(["circulation", "foyer", "living", "dining", "stair"]);
  const relays = movable.filter((room) => relayTypes.has(room.type));
  const destinations = movable.filter((room) => !relayTypes.has(room.type));
  for (let relayOffset = 0; relayOffset < Math.max(1, relays.length); relayOffset += 1) {
    for (let destinationOffset = 0; destinationOffset < Math.max(1, destinations.length); destinationOffset += 1) {
      const relayOrder = relays.map((_, index) => relays[(index + relayOffset) % relays.length]);
      const destinationOrder = destinations.map((_, index) => destinations[(index + destinationOffset) % destinations.length]);
      const interleaved: RoomRequirement[] = [];
      let relayIndex = 0;
      let destinationIndex = 0;
      while (relayIndex < relayOrder.length || destinationIndex < destinationOrder.length) {
        const placeRelay = relayIndex < relayOrder.length
          && (destinationIndex >= destinationOrder.length
            || Math.floor((interleaved.length + 1) * relayOrder.length / Math.max(1, movable.length)) > relayIndex);
        if (placeRelay) interleaved.push(relayOrder[relayIndex++]);
        else interleaved.push(destinationOrder[destinationIndex++]);
      }
      appendOrders(interleaved);
      appendOrders([...interleaved].reverse());
      if (orders.length >= DENSE_ORDER_ATTEMPT_LIMIT) break;
    }
    if (orders.length >= DENSE_ORDER_ATTEMPT_LIMIT) break;
  }

  let shuffleState = movable.reduce((hash, room) => {
    for (const character of room.id) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash;
  }, 0x811c9dc5) >>> 0;
  for (let attempt = 0; orders.length < DENSE_ORDER_ATTEMPT_LIMIT && attempt < DENSE_ORDER_ATTEMPT_LIMIT * 4; attempt += 1) {
    const shuffled = [...movable];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      shuffleState = (Math.imul(shuffleState, 1_664_525) + 1_013_904_223) >>> 0;
      const swapIndex = shuffleState % (index + 1);
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    appendOrders(shuffled);
  }
  for (const order of orders) {
    const placements = new Map<string, Rectangle>();
    partition(placements, order, plate, 0);
    if (input.requiredBoundaryRoom) {
      const rectangle = placements.get(input.requiredBoundaryRoom.roomId);
      if (!rectangle || !rectangleSatisfiesBoundary(rectangle, input.envelope, input.requiredBoundaryRoom.boundary)) continue;
    }
    if (input.additionalBoundaryRoom) {
      const rectangle = placements.get(input.additionalBoundaryRoom.roomId);
      if (!rectangle || !rectangleSatisfiesBoundary(rectangle, input.envelope, input.additionalBoundaryRoom.boundary)) continue;
    }
    const areasValid = input.rooms.every((room) => {
      const rectangle = placements.get(room.id);
      const policy = input.policyByRoom.get(room.id);
      if (!rectangle || !policy) return false;
      const area = rectangle.width * rectangle.depth;
      return area >= policy.minimumAreaMm2 && area <= policy.hardMaximumAreaMm2;
    });
    if (!areasValid) continue;
    if (connectivityValid(placements)) return placements;
  }
  throw new ProgramAreaInfeasibleError(
    input.rooms.map((room) => room.id),
    `PROGRAM_AREA_INFEASIBLE:${input.rootRoomId}:dense_connected_partition`,
  );
}

export function allocateV3TopologyScheme(requirements: CurrentBuildingRequirements, scheme: V3TopologyScheme): V3AllocatedScheme {
  const orderedFloors = [...requirements.floors].sort((left, right) => left.level - right.level);
  const floors: V3AllocatedFloor[] = [];
  const allPolicies: ResolvedRoomAreaPolicy[] = [];
  const aboveParking: AboveParkingAllocation[] = [];
  let groundParkingBounds: Rectangle | undefined;
  let verticalStairBounds: Rectangle | undefined;
  let elevationMm = 0;
  for (const floorRequirement of orderedFloors) {
    const envelope = scheme.topology.envelope;
    const envelopePolygon = normalizeOrthogonalPolygon(rectangleToOrthogonalPolygon(envelope));
    const usableAreaMm2 = envelope.width * envelope.depth;
    const rooms = requirements.rooms.filter((room) => room.floorId === floorRequirement.id);
    const policies = rooms.map((room) => resolveRoomAreaPolicy({ requirements, room, usableFloorAreaMm2: usableAreaMm2 }));
    const minimumProgramAreaMm2 = policies.reduce((sum, policy) => sum + policy.minimumAreaMm2, 0);
    if (minimumProgramAreaMm2 > usableAreaMm2) throw new ProgramAreaInfeasibleError(
      policies.map((policy) => policy.requirementId),
      `PROGRAM_AREA_INFEASIBLE:${floorRequirement.id}:minimum_program_exceeds_envelope`,
    );
    const requestedProgramAreaMm2 = policies.reduce((sum, policy) => sum + policy.effectiveTargetAreaMm2, 0);
    const allocationCoverageLimit = requestedProgramAreaMm2 > usableAreaMm2 * 0.9 ? 0.95 : 0.75;
    const allocationBudgetMm2 = Math.max(minimumProgramAreaMm2, Math.min(requestedProgramAreaMm2, Math.round(usableAreaMm2 * allocationCoverageLimit)));
    const targetFlex = requestedProgramAreaMm2 - minimumProgramAreaMm2;
    const budgetFlex = allocationBudgetMm2 - minimumProgramAreaMm2;
    const targetScale = targetFlex > 0 ? Math.min(1, budgetFlex / targetFlex) : 0;
    const allocationTargetByPolicy = new Map(policies.map((policy) => [policy, Math.round(
      policy.minimumAreaMm2 + (policy.effectiveTargetAreaMm2 - policy.minimumAreaMm2) * targetScale,
    )]));
    allPolicies.push(...policies);
    const topologyRooms = new Map(scheme.topology.rooms.filter((room) => room.floorId === floorRequirement.id).map((room) => [room.id, room]));
    const topologyFootprints = scheme.topology.occupiedFootprintsByFloor.find((floor) => floor.floorId === floorRequirement.id)?.polygons ?? [envelopePolygon];
    const occupied: Rectangle[] = [];
    const regionByRoom = new Map<string, FloorRegion>();
    const forbidden: Rectangle[] = [];
    const aboveUse = floorRequirement.level === 1 && groundParkingBounds
      ? resolvedAboveParkingUse(requirements, floorRequirement.id)
      : undefined;
    if ((aboveUse === "unbuilt" || aboveUse === "balcony" || aboveUse === "terrace") && groundParkingBounds) {
      forbidden.push(groundParkingBounds);
    }
    const aboveTarget = aboveUse === "balcony"
      ? rooms.find((room) => room.type === "balcony")
      : aboveUse === "terrace"
        ? rooms.find((room) => room.type === "terrace")
        : aboveUse === "occupied_rooms"
          ? rooms.find((room) => !["balcony", "terrace", "circulation", "stair"].includes(room.type))
          : undefined;
    if ((aboveUse === "balcony" || aboveUse === "terrace") && !aboveTarget) throw new ProgramAreaInfeasibleError(
      ["aboveParkingUse"],
      `PROGRAM_AREA_INFEASIBLE:aboveParkingUse:${aboveUse}`,
    );
    const reservationPriority = (room: RoomRequirement) => floorRequirement.level !== 0
      ? room.type === "stair"
        ? 0
        : room.type === "circulation"
          ? 1
          : room.type === "living" || room.type === "dining"
            ? 2
            : room.id === aboveTarget?.id
              ? 3
              : ["balcony", "verandah", "courtyard", "terrace"].includes(room.type)
                ? 5
                : 4
      : room.id === scheme.topology.foyerWallRunReservation.targetRoomId
        ? 0
        : room.id === scheme.topology.vehicleApertureReservation?.targetRoomId
          ? 1
          : room.type === "circulation" || room.type === "stair"
            ? 2
            : room.type === "living" || room.type === "dining"
              ? 3
              : ["balcony", "verandah", "courtyard", "terrace"].includes(room.type)
                ? 5
                : 4;
    const roomOrder = [...rooms].sort((left, right) =>
      reservationPriority(left) - reservationPriority(right)
      || (policies.find((policy) => policy.requirementId === right.id)?.effectiveTargetAreaMm2 ?? right.targetAreaMm2)
        - (policies.find((policy) => policy.requirementId === left.id)?.effectiveTargetAreaMm2 ?? left.targetAreaMm2)
      || left.id.localeCompare(right.id),
    );
    const targetByRoom = new Map(roomOrder.map((room) => {
      const policy = policies.find((candidate) => candidate.requirementId === room.id)
        ?? policies.find((candidate) => candidate.roomType === room.type);
      return [room.id, policy ? allocationTargetByPolicy.get(policy) ?? policy.effectiveTargetAreaMm2 : room.targetAreaMm2] as const;
    }));
    const policyByRoom = new Map(roomOrder.map((room) => [
      room.id,
      policies.find((candidate) => candidate.requirementId === room.id)
        ?? policies.find((candidate) => candidate.roomType === room.type),
    ]).filter((entry): entry is [string, ResolvedRoomAreaPolicy] => Boolean(entry[1])));
    const attachedBathroomBedroom = new Map<string, string>();
    for (const relationship of requirements.relationships.filter((candidate) => candidate.type === "must_connect")) {
      const from = rooms.find((room) => room.id === relationship.fromRoomId);
      const to = rooms.find((room) => room.id === relationship.toRoomId);
      if (from?.type === "bathroom" && to?.type === "bedroom") attachedBathroomBedroom.set(from.id, to.id);
      if (to?.type === "bathroom" && from?.type === "bedroom") attachedBathroomBedroom.set(to.id, from.id);
    }
    const placementOrder: RoomRequirement[] = [];
    const placementConsumed = new Set<string>();
    for (const room of roomOrder) {
      if (placementConsumed.has(room.id) || attachedBathroomBedroom.has(room.id)) continue;
      placementOrder.push(room);
      placementConsumed.add(room.id);
      const attachedBathrooms = [...attachedBathroomBedroom]
        .filter(([, bedroomId]) => bedroomId === room.id)
        .map(([bathroomId]) => roomOrder.find((candidate) => candidate.id === bathroomId))
        .filter((candidate): candidate is RoomRequirement => Boolean(candidate))
        .sort((left, right) => left.id.localeCompare(right.id));
      for (const bathroom of attachedBathrooms) {
        placementOrder.push(bathroom);
        placementConsumed.add(bathroom.id);
      }
    }
    for (const room of roomOrder) if (!placementConsumed.has(room.id)) {
      placementOrder.push(room);
      placementConsumed.add(room.id);
    }
    const denseFoyerBoundary: RequiredBoundary | undefined = floorRequirement.level === 0
      ? {
          side: scheme.topology.foyerWallRunReservation.side,
          minimumWallRunMm: Math.max(
            scheme.topology.foyerWallRunReservation.minimumClearWidthMm,
            requirements.entry.primaryDoorClearWidthMm + 2 * DOOR_JUNCTION_CLEARANCE_MM,
          ),
        }
      : undefined;
    const denseIndoorRooms = roomOrder.filter((room) =>
      room.type !== "verandah"
      && room.type !== "balcony"
      && room.type !== "terrace"
      && room.type !== "courtyard");
    const denseIndoorTargets = new Map(denseIndoorRooms.map((room) => [
      room.id,
      targetByRoom.get(room.id) ?? room.targetAreaMm2,
    ]));
    const denseIndoorPolicies = new Map(denseIndoorRooms.flatMap((room) => {
      const policy = policyByRoom.get(room.id);
      return policy ? [[room.id, policy] as const] : [];
    }));
    const zonedBoundaryByRoom = new Map<string, RequiredBoundary>();
    if (denseFoyerBoundary) {
      zonedBoundaryByRoom.set(
        scheme.topology.foyerWallRunReservation.targetRoomId,
        denseFoyerBoundary,
      );
    }
    if (floorRequirement.level === 0 && scheme.topology.vehicleApertureReservation) {
      zonedBoundaryByRoom.set(
        scheme.topology.vehicleApertureReservation.targetRoomId,
        {
          side: scheme.topology.vehicleApertureReservation.side,
          minimumWallRunMm: scheme.topology.vehicleApertureReservation.minimumClearWidthMm
            + 2 * DOOR_JUNCTION_CLEARANCE_MM,
        },
      );
    }
    let zonedPlacements: Map<string, Rectangle> | undefined;
    let zonedOutdoorReservation: Rectangle | undefined;
    let failedZonedPlanning: ReturnType<typeof zonedFailureDiagnostics> | undefined;
    if (floorRequirement.level === 0 && forbidden.length === 0) {
      try {
        zonedPlacements = allocateZonedFloor({
          floorId: floorRequirement.id,
          rooms: roomOrder,
          policyByRoom,
          targetByRoom,
          envelope,
          entrySide: scheme.topology.mainEntry.side,
          rootRoomId: scheme.topology.mainEntry.targetRoomId,
          requiredBoundaryByRoom: zonedBoundaryByRoom,
          attachedBathroomBedroom,
          minimumDimensionByRoom: new Map(roomOrder
            .filter((room) => room.type === "stair")
            .map((room) => [room.id, requirements.vertical.stairWidthMm])),
        }).placements;
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith("ZONED_ALLOCATION_")) throw error;
        failedZonedPlanning = zonedFailureDiagnostics(error);
      }
    } else if (floorRequirement.level > 0 && verticalStairBounds) {
      const stair = roomOrder.find((room) => room.type === "stair");
      if (stair) try {
        const projectedOutdoorReservations = (aboveUse === "balcony" || aboveUse === "terrace")
          && aboveTarget
          && groundParkingBounds
          && policyByRoom.get(aboveTarget.id)
          ? aboveParkingOutdoorCandidates({
              room: aboveTarget,
              policy: policyByRoom.get(aboveTarget.id)!,
              projection: groundParkingBounds,
              placementEnvelope: envelope,
              occupied: [verticalStairBounds],
              adjacent: [],
              targetAreaMm2: policyByRoom.get(aboveTarget.id)!.minimumAreaMm2,
            }).map((candidate) => candidate.rectangle)
          : [];
        const zonedUpperRooms = (aboveUse === "balcony" || aboveUse === "terrace") && aboveTarget
          ? roomOrder.filter((room) => room.id !== aboveTarget.id)
          : roomOrder;
        if ((aboveUse === "balcony" || aboveUse === "terrace") && projectedOutdoorReservations.length === 0) {
          throw new Error(`ZONED_UPPER_ALLOCATION_OUTDOOR_RESERVATION_INFEASIBLE:${floorRequirement.id}`);
        }
        const reservationAttempts: Array<Rectangle | undefined> = projectedOutdoorReservations.length > 0
          ? projectedOutdoorReservations
          : [undefined];
        let zoned: ReturnType<typeof allocateZonedUpperFloor> | undefined;
        let selectedOutdoorReservation: Rectangle | undefined;
        let lastZonedError: Error | undefined;
        for (const outdoorReservation of reservationAttempts) {
          const zonedForbidden = aboveUse === "unbuilt" && groundParkingBounds
            ? [groundParkingBounds]
            : outdoorReservation
              ? [outdoorReservation]
              : [];
          try {
            zoned = allocateZonedUpperFloor({
              floorId: floorRequirement.id,
              rooms: zonedUpperRooms,
              policyByRoom,
              targetByRoom,
              envelope,
              entrySide: scheme.topology.mainEntry.side,
              rootRoomId: stair.id,
              attachedBathroomBedroom,
              fixedPlacements: new Map([[stair.id, verticalStairBounds]]),
              forbiddenRectangles: zonedForbidden,
              minimumDimensionByRoom: new Map([[stair.id, requirements.vertical.stairWidthMm]]),
            });
            if (outdoorReservation) {
              const relayRectangles = [...zoned.placements]
                .filter(([roomId]) =>
                  PEDESTRIAN_RELAY_ROOM_TYPES.has(zonedUpperRooms.find((room) => room.id === roomId)?.type ?? "bedroom"))
                .map(([, rectangle]) => rectangle);
              if (!relayRectangles.some((rectangle) =>
                sharedBoundaryLength(rectangle, outdoorReservation) >= 1_000)) {
                zoned = undefined;
                continue;
              }
            }
            selectedOutdoorReservation = outdoorReservation;
            break;
          } catch (error) {
            if (!(error instanceof Error) || !error.message.startsWith("ZONED_UPPER_ALLOCATION_")) throw error;
            lastZonedError = error;
          }
        }
        if (!zoned) throw lastZonedError
          ?? new Error(`ZONED_UPPER_ALLOCATION_INFEASIBLE:${floorRequirement.id}`);
        const upperPlacementCompatible = aboveUse === "balcony" || aboveUse === "terrace" || aboveUse === "unbuilt"
          ? true
          : zonedAboveParkingCompatible({
              placements: zoned.placements,
              rooms: zonedUpperRooms,
              use: aboveUse,
              targetId: aboveTarget?.id,
              projection: groundParkingBounds,
            });
        if (upperPlacementCompatible) {
          zonedPlacements = zoned.placements;
          zonedOutdoorReservation = selectedOutdoorReservation;
        }
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith("ZONED_UPPER_ALLOCATION_")) throw error;
        failedZonedPlanning = zonedFailureDiagnostics(error);
      }
    }
    let densePlacements: Map<string, Rectangle> | undefined;
    try {
      densePlacements = zonedPlacements ?? (requestedProgramAreaMm2 > usableAreaMm2 * 0.9
        && forbidden.length === 0
        ? denseProgramPlacements({
          rooms: denseIndoorRooms,
          targetByRoom: denseIndoorTargets,
          policyByRoom: denseIndoorPolicies,
          envelope,
          entrySide: scheme.topology.mainEntry.side,
          rootRoomId: floorRequirement.level === 0
            ? scheme.topology.mainEntry.targetRoomId
            : rooms.find((room) => room.type === "stair")?.id
              ?? rooms.find((room) => room.type === "circulation")?.id
              ?? rooms.find((room) => room.type === "living")?.id
              ?? roomOrder[0].id,
          attachedBathroomBedroom,
          requiredBoundaryRoom: denseFoyerBoundary
            ? { roomId: scheme.topology.foyerWallRunReservation.targetRoomId, boundary: denseFoyerBoundary }
            : undefined,
          additionalBoundaryRoom: floorRequirement.level === 0 && scheme.topology.vehicleApertureReservation
            ? {
                roomId: scheme.topology.vehicleApertureReservation.targetRoomId,
                boundary: {
                  side: scheme.topology.vehicleApertureReservation.side,
                  minimumWallRunMm: scheme.topology.vehicleApertureReservation.minimumClearWidthMm + 2 * DOOR_JUNCTION_CLEARANCE_MM,
                },
              }
            : undefined,
        })
        : undefined);
    } catch (error) {
      if (!(error instanceof ProgramAreaInfeasibleError) || !failedZonedPlanning) throw error;
      throw new ProgramAreaInfeasibleError(
        [...new Set([...failedZonedPlanning.requirementIds, ...error.requirementIds])],
        error.message,
        failedZonedPlanning.planningDiagnostics,
      );
    }
    let footprintExpandedForProgram = false;
    const placedByRoom = new Map<string, Rectangle>();
    for (const room of placementOrder) {
      const policy = policies.find((candidate) => candidate.roomType === room.type && candidate.requirementId === room.id)
        ?? policies.find((candidate) => candidate.roomType === room.type);
      if (!policy || policy.effectiveTargetAreaMm2 === 0) continue;
      const prefersAboveParkingEdge = groundParkingBounds
        && (room.id === aboveTarget?.id
          || (["circulation", "living"].includes(room.type)
            && (aboveUse === "balcony" || aboveUse === "terrace")));
      const preferred = prefersAboveParkingEdge && groundParkingBounds
        ? { x: groundParkingBounds.x + groundParkingBounds.width / 2, y: groundParkingBounds.y + groundParkingBounds.depth / 2 }
        : topologyRooms.get(room.id)?.centroid ?? { x: envelope.x + envelope.width / 2, y: envelope.y + envelope.depth / 2 };
      const requiredBoundary = floorRequirement.level !== 0
        ? undefined
        : room.id === scheme.topology.foyerWallRunReservation.targetRoomId
          ? {
              side: scheme.topology.foyerWallRunReservation.side,
              minimumWallRunMm: Math.max(
                scheme.topology.foyerWallRunReservation.minimumClearWidthMm,
                requirements.entry.primaryDoorClearWidthMm + 2 * DOOR_JUNCTION_CLEARANCE_MM,
              ),
            }
          : room.id === scheme.topology.vehicleApertureReservation?.targetRoomId
            ? {
                side: scheme.topology.vehicleApertureReservation.side,
                minimumWallRunMm: scheme.topology.vehicleApertureReservation.minimumClearWidthMm + 2 * DOOR_JUNCTION_CLEARANCE_MM,
              }
            : undefined;
      const attachedBedroomId = attachedBathroomBedroom.get(room.id);
      const requiresNoInteriorDoor = room.type === "parking" || room.type === "courtyard" || room.type === "terrace";
      const isFloorRoot = floorRequirement.level === 0
        ? room.id === scheme.topology.mainEntry.targetRoomId
        : room.type === "stair" || (room.type === "circulation" && !rooms.some((candidate) => candidate.type === "stair"));
      const requiredAdjacentRectangles = attachedBedroomId
        ? [placedByRoom.get(attachedBedroomId)].filter((rectangle): rectangle is Rectangle => Boolean(rectangle))
        : !isFloorRoot && !requiresNoInteriorDoor
          ? [...placedByRoom.entries()]
              .filter(([roomId]) => PEDESTRIAN_RELAY_ROOM_TYPES.has(rooms.find((candidate) => candidate.id === roomId)?.type ?? "bedroom"))
              .map(([, rectangle]) => rectangle)
          : [];
      if (attachedBedroomId && requiredAdjacentRectangles.length === 0) throw new ProgramAreaInfeasibleError(
        [room.id, attachedBedroomId],
        `PROGRAM_AREA_INFEASIBLE:${room.id}:attached_bedroom_not_allocated`,
      );
      if (!isFloorRoot && !requiresNoInteriorDoor && !attachedBedroomId && requiredAdjacentRectangles.length === 0) throw new ProgramAreaInfeasibleError(
        [room.id],
        `PROGRAM_AREA_INFEASIBLE:${room.id}:interior_spine_not_allocated`,
      );
      const denseRectangle = densePlacements?.get(room.id);
      const aboveParkingEnvelope = room.id === aboveTarget?.id
        && groundParkingBounds
        && (aboveUse === "balcony" || aboveUse === "terrace")
        ? groundParkingBounds
        : undefined;
      const alignedStairRectangle = room.type === "stair" && verticalStairBounds
        && overlapArea(verticalStairBounds, envelope) === verticalStairBounds.width * verticalStairBounds.depth
        && occupied.every((rectangle) => overlapArea(rectangle, verticalStairBounds!) === 0)
        && forbidden.every((rectangle) => overlapArea(rectangle, verticalStairBounds!) === 0)
        && verticalStairBounds.width * verticalStairBounds.depth >= policy.minimumAreaMm2
        && verticalStairBounds.width * verticalStairBounds.depth <= policy.hardMaximumAreaMm2
        ? verticalStairBounds
        : undefined;
      const alignedAboveParkingOutdoor = aboveParkingEnvelope
        ? zonedOutdoorReservation && room.id === aboveTarget?.id
          ? { rectangle: zonedOutdoorReservation, footprintExpanded: true as const }
          : placeAboveParkingOutdoor({
            room,
            policy,
            projection: aboveParkingEnvelope,
            placementEnvelope: envelope,
            occupied,
            adjacent: requiredAdjacentRectangles,
            targetAreaMm2: allocationTargetByPolicy.get(policy) ?? policy.effectiveTargetAreaMm2,
          })
        : undefined;
      const placed = alignedStairRectangle
        ? { rectangle: alignedStairRectangle, footprintExpanded: !rectangleInsideAnyFootprint(alignedStairRectangle, topologyFootprints) }
        : alignedAboveParkingOutdoor
          ? alignedAboveParkingOutdoor
        : denseRectangle ? { rectangle: denseRectangle, footprintExpanded: true } : placeRoom({
        room,
        policy,
        envelope: aboveParkingEnvelope ?? envelope,
        preferred,
        topologyFootprints,
        occupied,
        forbidden: aboveParkingEnvelope
          ? forbidden.filter((rectangle) => rectangle !== groundParkingBounds)
          : forbidden,
        allocationTargetAreaMm2: aboveParkingEnvelope
          ? Math.min(
              allocationTargetByPolicy.get(policy) ?? policy.effectiveTargetAreaMm2,
              aboveParkingEnvelope.width * aboveParkingEnvelope.depth,
            )
          : room.type === "circulation"
          ? Math.max(allocationTargetByPolicy.get(policy) ?? policy.effectiveTargetAreaMm2, Math.floor(policy.hardMaximumAreaMm2 * 0.9))
          : allocationTargetByPolicy.get(policy) ?? policy.effectiveTargetAreaMm2,
        requiredBoundary,
        requiredAdjacentRectangles,
        minimumSharedWallMm: 1_000,
        minimumDimensionMm: room.type === "stair"
          ? requirements.vertical.stairFamily === "dog_leg"
            ? requirements.vertical.stairWidthMm * 2 + 200
            : requirements.vertical.stairWidthMm
          : room.type === "circulation" && (aboveUse === "balcony" || aboveUse === "terrace")
            ? 1_300
          : undefined,
      });
      const placedAreaMm2 = placed.rectangle.width * placed.rectangle.depth;
      if (placedAreaMm2 < policy.minimumAreaMm2 || placedAreaMm2 > policy.hardMaximumAreaMm2) throw new ProgramAreaInfeasibleError(
        [policy.requirementId],
        `PROGRAM_AREA_INFEASIBLE:${policy.requirementId}:allocated_area_outside_policy`,
      );
      footprintExpandedForProgram ||= placed.footprintExpanded;
      occupied.push(placed.rectangle);
      placedByRoom.set(room.id, placed.rectangle);
      if (room.type === "stair") {
        if (verticalStairBounds && (placed.rectangle.x !== verticalStairBounds.x
          || placed.rectangle.y !== verticalStairBounds.y
          || placed.rectangle.width !== verticalStairBounds.width
          || placed.rectangle.depth !== verticalStairBounds.depth)) throw new ProgramAreaInfeasibleError(
          [room.id],
          `PROGRAM_AREA_INFEASIBLE:${room.id}:vertical_stair_not_aligned`,
        );
        verticalStairBounds ??= placed.rectangle;
      }
      const region: FloorRegion = {
        id: `${floorRequirement.id}-region-${room.id}`,
        kind: regionKind(room),
        polygon: normalizeOrthogonalPolygon(rectangleToOrthogonalPolygon(placed.rectangle)),
        spaceId: room.id,
      };
      regionByRoom.set(room.id, region);
      if (room.type === "parking" && floorRequirement.level === 0) groundParkingBounds = placed.rectangle;
    }
    const intentionalUnbuiltRegions: FloorRegion[] = residualRectangles(envelope, occupied).map((rectangle, index) => ({
      id: `${floorRequirement.id}-unbuilt-${index + 1}`,
      kind: "intentional_unbuilt",
      polygon: normalizeOrthogonalPolygon(rectangleToOrthogonalPolygon(rectangle)),
    }));
    const programRegions = [...regionByRoom.values()];
    const regions = [...programRegions, ...intentionalUnbuiltRegions];
    const missingRequirementIds = rooms
      .filter((room) => !regionByRoom.has(room.id))
      .map((room) => room.id);
    if (missingRequirementIds.length > 0) throw new ProgramAreaInfeasibleError(
      missingRequirementIds,
      `PROGRAM_AREA_INFEASIBLE:${floorRequirement.id}:requested_rooms_not_realized`,
      failedZonedPlanning?.planningDiagnostics,
    );
    const spaces: DerivedAllocatedSpace[] = rooms.flatMap((room) => {
      const region = regionByRoom.get(room.id);
      if (!region) return [];
      return [{
        id: room.id,
        floorId: room.floorId,
        name: room.name,
        type: room.type,
        regionId: region.id,
        bounds: orthogonalPolygonBounds(region.polygon),
        areaMm2: orthogonalPolygonAreaMm2(region.polygon),
        accessible: room.accessible,
      }];
    });
    const coverage = auditOrthogonalPartition(envelopePolygon, regions);
    if (!coverage.valid) throw new Error(`ALLOCATED_PARTITION_INVALID:${floorRequirement.id}`);
    const targetProgramAreaMm2 = policies.reduce((sum, policy) => sum + policy.effectiveTargetAreaMm2, 0);
    const allocatedProgramAreaMm2 = spaces.reduce((sum, space) => sum + space.areaMm2, 0);
    const surplusPenalty = policies.reduce((penalty, policy) => {
      const actual = spaces.find((space) => space.id === policy.requirementId || space.type === policy.roomType)?.areaMm2 ?? 0;
      return penalty + Math.max(0, actual - policy.effectiveTargetAreaMm2) / Math.max(1, policy.effectiveTargetAreaMm2)
        * (policy.flexibilityClass === "outdoor" ? 2 : 1);
    }, 0);
    floors.push({
      floorId: floorRequirement.id,
      label: floorRequirement.label,
      level: floorRequirement.level,
      elevationMm,
      floorHeightMm: floorRequirement.floorHeightMm,
      envelope: envelopePolygon,
      regions,
      spaces,
      walls: deriveWalls(floorRequirement.id, envelope, regions, rooms),
      constructedFootprints: programRegions.filter((region) => region.kind !== "open_to_sky").map((region) => region.polygon),
      intentionalUnbuiltRegions,
      coverage,
      targetProgramAreaMm2,
      allocatedProgramAreaMm2,
      surplusPenalty,
      footprintExpandedForProgram,
    });
    if (aboveUse && groundParkingBounds) {
      const realizedRegionIds = aboveUse === "unbuilt"
        ? intentionalUnbuiltRegions.filter((region) => overlapArea(orthogonalPolygonBounds(region.polygon), groundParkingBounds as Rectangle) > 0).map((region) => region.id)
        : programRegions.filter((region) => overlapArea(orthogonalPolygonBounds(region.polygon), groundParkingBounds as Rectangle) > 0).map((region) => region.id);
      if (realizedRegionIds.length === 0) throw new ProgramAreaInfeasibleError(["aboveParkingUse"], "PROGRAM_AREA_INFEASIBLE:aboveParkingUse:not_realized");
      aboveParking.push({
        floorId: floorRequirement.id,
        use: aboveUse,
        parkingProjection: rectangleToOrthogonalPolygon(groundParkingBounds),
        realizedRegionIds,
      });
    }
    elevationMm += floorRequirement.floorHeightMm;
  }
  return {
    schemeId: `${scheme.schemeId}-allocation`,
    partiId: scheme.partiId,
    topologySchemeId: scheme.schemeId,
    arrivalReservations: {
      primaryRoadSide: scheme.topology.primaryRoadSide,
      mainEntry: scheme.topology.mainEntry,
      secondaryEntry: scheme.topology.secondaryEntry,
      foyerWallRunReservation: scheme.topology.foyerWallRunReservation,
      vehicleApertureReservation: scheme.topology.vehicleApertureReservation,
    },
    floors,
    aboveParking,
    areaPolicies: allPolicies,
    surplusPenalty: floors.reduce((sum, floor) => sum + floor.surplusPenalty, 0),
  };
}
