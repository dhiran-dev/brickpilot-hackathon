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

const ALLOCATION_GRID_MM = 100;
const DENSE_ORDER_ATTEMPT_LIMIT = 1_000;

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
  constructor(readonly requirementIds: string[], message: string) {
    super(message);
    this.name = "ProgramAreaInfeasibleError";
  }
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

function regionKind(room: RoomRequirement): FloorRegion["kind"] {
  if (room.type === "parking" || room.type === "balcony" || room.type === "verandah") return "covered_outdoor";
  if (room.type === "courtyard" || room.type === "terrace") return "open_to_sky";
  return "interior";
}

function pointRegion(regions: FloorRegion[], x: number, y: number) {
  return regions.find((region) => region.spaceId && region.kind !== "open_to_sky" && polygonContainsPoint(region.polygon, x, y));
}

function deriveWalls(floorId: string, envelope: Rectangle, regions: FloorRegion[]): WallSegment[] {
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
    walls.push({
      id: `${floorId}-wall-v-${x}-${from}-${to}`,
      floorId,
      start: { x, y: from },
      end: { x, y: to },
      thicknessMm: left && right ? 115 : 230,
      type: left && right ? "interior" : "exterior",
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
    walls.push({
      id: `${floorId}-wall-h-${y}-${from}-${to}`,
      floorId,
      start: { x: from, y },
      end: { x: to, y },
      thicknessMm: above && below ? 115 : 230,
      type: above && below ? "interior" : "exterior",
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
  const spine = input.rooms.find((room) => room.type === "circulation"
    && room.id !== pinned?.id && room.id !== additionalPinned?.id);
  if (pinned && additionalPinned && spine
    && input.requiredBoundaryRoom?.boundary.side === input.additionalBoundaryRoom?.boundary.side) {
    const side = input.requiredBoundaryRoom.boundary.side;
    const horizontalFrontage = side === "north" || side === "south";
    const frontageSpan = side === "north" || side === "south" ? input.envelope.width : input.envelope.depth;
    const pinnedRooms = [pinned, additionalPinned];
    const pinnedPolicies = pinnedRooms.map((room) => input.policyByRoom.get(room.id));
    const pinnedTargets = pinnedRooms.map((room) => input.targetByRoom.get(room.id) ?? room.targetAreaMm2);
    const frontageThickness = ceilGrid(Math.max(
      ...pinnedRooms.map((room) => minimumClearDimensionMm(room.type, room.accessible)),
      (pinnedTargets[0] + pinnedTargets[1]) / frontageSpan,
    ));
    const frontageLengths = pinnedRooms.map((room, index) => ceilGrid(Math.max(
      input.requiredBoundaryRoom?.roomId === room.id
        ? input.requiredBoundaryRoom.boundary.minimumWallRunMm
        : input.additionalBoundaryRoom?.boundary.minimumWallRunMm ?? 0,
      minimumClearDimensionMm(room.type, room.accessible),
      pinnedTargets[index] / frontageThickness,
    )));
    const spinePolicy = input.policyByRoom.get(spine.id);
    const spineTarget = input.targetByRoom.get(spine.id) ?? spine.targetAreaMm2;
    const inwardSpan = (horizontalFrontage ? input.envelope.depth : input.envelope.width) - frontageThickness;
    const spineThickness = ceilGrid(Math.max(minimumClearDimensionMm(spine.type, spine.accessible), spineTarget / inwardSpan));
    const remainingRooms = input.rooms.filter((room) => !pinnedRooms.includes(room) && room.id !== spine.id);
    const areaWithinPolicy = (rectangle: Rectangle, policy: ResolvedRoomAreaPolicy | undefined) => Boolean(policy)
      && rectangle.width * rectangle.depth >= policy!.minimumAreaMm2
      && rectangle.width * rectangle.depth <= policy!.hardMaximumAreaMm2;
    if (frontageLengths[0] + frontageLengths[1] <= frontageSpan
      && spinePolicy
      && remainingRooms.length <= 16) {
      let firstPinned: Rectangle;
      let secondPinned: Rectangle;
      let spineRectangle: Rectangle;
      let wingSpans: [number, number];
      let inwardStart: number;
      if (horizontalFrontage) {
        const frontageY = side === "north"
          ? input.envelope.y
          : input.envelope.y + input.envelope.depth - frontageThickness;
        secondPinned = {
          x: input.envelope.x,
          y: frontageY,
          width: frontageLengths[1],
          depth: frontageThickness,
        };
        firstPinned = {
          x: secondPinned.x + secondPinned.width,
          y: frontageY,
          width: frontageLengths[0],
          depth: frontageThickness,
        };
        const spineX = firstPinned.x;
        inwardStart = side === "north" ? frontageY + frontageThickness : input.envelope.y;
        spineRectangle = { x: spineX, y: inwardStart, width: spineThickness, depth: inwardSpan };
        wingSpans = [
          spineRectangle.x - input.envelope.x,
          input.envelope.x + input.envelope.width - spineRectangle.x - spineRectangle.width,
        ];
      } else {
        const frontageX = side === "west"
          ? input.envelope.x
          : input.envelope.x + input.envelope.width - frontageThickness;
        secondPinned = {
          x: frontageX,
          y: input.envelope.y,
          width: frontageThickness,
          depth: frontageLengths[1],
        };
        firstPinned = {
          x: frontageX,
          y: secondPinned.y + secondPinned.depth,
          width: frontageThickness,
          depth: frontageLengths[0],
        };
        const spineY = firstPinned.y;
        inwardStart = side === "west" ? frontageX + frontageThickness : input.envelope.x;
        spineRectangle = { x: inwardStart, y: spineY, width: inwardSpan, depth: spineThickness };
        wingSpans = [
          spineRectangle.y - input.envelope.y,
          input.envelope.y + input.envelope.depth - spineRectangle.y - spineRectangle.depth,
        ];
      }
      if (areaWithinPolicy(firstPinned, pinnedPolicies[0])
        && areaWithinPolicy(secondPinned, pinnedPolicies[1])
        && areaWithinPolicy(spineRectangle, spinePolicy)
        && wingSpans.every((span) => span >= ALLOCATION_GRID_MM)) {
        const roomIndex = new Map(remainingRooms.map((room, index) => [room.id, index]));
        for (const targetScale of [1, 0.75, 0.5, 0.25, 0]) {
          const assignmentCount = 2 ** remainingRooms.length;
          for (let assignment = 0; assignment < assignmentCount; assignment += 1) {
            const sideByRoom = new Map(remainingRooms.map((room, index) => [room.id, (assignment >> index) & 1]));
            if ([...input.attachedBathroomBedroom].some(([bathroomId, bedroomId]) =>
              sideByRoom.has(bathroomId) && sideByRoom.has(bedroomId)
              && sideByRoom.get(bathroomId) !== sideByRoom.get(bedroomId))) continue;
            const lengthByRoom = new Map<string, number>();
            let assignmentValid = true;
            for (const room of remainingRooms) {
              const wing = sideByRoom.get(room.id) ?? 0;
              const wingSpan = wingSpans[wing];
              const policy = input.policyByRoom.get(room.id);
              if (!policy || wingSpan < minimumClearDimensionMm(room.type, room.accessible)) {
                assignmentValid = false;
                break;
              }
              const requestedTarget = input.targetByRoom.get(room.id) ?? room.targetAreaMm2;
              const desiredArea = policy.minimumAreaMm2 + (requestedTarget - policy.minimumAreaMm2) * targetScale;
              const length = ceilGrid(Math.max(minimumClearDimensionMm(room.type, room.accessible), desiredArea / wingSpan));
              const actualArea = wingSpan * length;
              if (actualArea < policy.minimumAreaMm2 || actualArea > policy.hardMaximumAreaMm2) {
                assignmentValid = false;
                break;
              }
              lengthByRoom.set(room.id, length);
            }
            if (!assignmentValid) continue;
            const wingRooms = ([0, 1] as const).map((wing) => {
              const assigned = remainingRooms.filter((room) => sideByRoom.get(room.id) === wing);
              const ordered: RoomRequirement[] = [];
              const consumed = new Set<string>();
              for (const room of assigned) {
                if (consumed.has(room.id) || input.attachedBathroomBedroom.has(room.id)) continue;
                ordered.push(room);
                consumed.add(room.id);
                for (const [bathroomId, bedroomId] of input.attachedBathroomBedroom) {
                  if (bedroomId !== room.id) continue;
                  const bathroom = assigned.find((candidate) => candidate.id === bathroomId);
                  if (bathroom) {
                    ordered.push(bathroom);
                    consumed.add(bathroom.id);
                  }
                }
              }
              for (const room of assigned) if (!consumed.has(room.id)) ordered.push(room);
              return ordered;
            });
            const wingSums = wingRooms.map((rooms) => rooms.reduce((sum, room) => sum + (lengthByRoom.get(room.id) ?? 0), 0));
            const overflow = Math.max(...wingSums.map((sum) => sum - inwardSpan));
            if (overflow > 0) continue;
            const frontageSpinePlacements = new Map<string, Rectangle>([
              [pinned.id, firstPinned],
              [additionalPinned.id, secondPinned],
              [spine.id, spineRectangle],
            ]);
            for (const wing of [0, 1] as const) {
              let offset = 0;
              for (const room of wingRooms[wing]) {
                const length = lengthByRoom.get(room.id)!;
                const rectangle = horizontalFrontage
                  ? {
                      x: wing === 0 ? input.envelope.x : spineRectangle.x + spineRectangle.width,
                      y: inwardStart + offset,
                      width: wingSpans[wing],
                      depth: length,
                    }
                  : {
                      x: inwardStart + offset,
                      y: wing === 0 ? input.envelope.y : spineRectangle.y + spineRectangle.depth,
                      width: length,
                      depth: wingSpans[wing],
                    };
                frontageSpinePlacements.set(room.id, rectangle);
                offset += length;
              }
            }
            if (roomIndex.size === remainingRooms.length && connectivityValid(frontageSpinePlacements)) return frontageSpinePlacements;
          }
        }
      }
    }
  }
  const movable = input.rooms.filter((room) => room.id !== pinned?.id && room.id !== additionalPinned?.id);
  const orders: RoomRequirement[][] = [];
  const seenOrders = new Set<string>();
  const pinnedLast = input.requiredBoundaryRoom?.boundary.side === "south"
    || input.requiredBoundaryRoom?.boundary.side === "east";
  function collect(movableOrder: RoomRequirement[]) {
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
  collect(movable);
  collect([...movable].reverse());

  // A depth-first prefix of N! permutations barely changes the early rooms once N grows. Dense
  // programmes need relay rooms distributed through the partition tree, so seed the bounded search
  // with evenly interleaved relay/leaf orders and then deterministic full-span shuffles.
  const relayTypes = new Set<RoomRequirement["type"]>(["circulation", "foyer", "living", "dining", "stair"]);
  const relays = movable.filter((room) => relayTypes.has(room.type));
  const leaves = movable.filter((room) => !relayTypes.has(room.type));
  for (let relayOffset = 0; relayOffset < Math.max(1, relays.length); relayOffset += 1) {
    for (let leafOffset = 0; leafOffset < Math.max(1, leaves.length); leafOffset += 1) {
      const relayOrder = relays.map((_, index) => relays[(index + relayOffset) % relays.length]);
      const leafOrder = leaves.map((_, index) => leaves[(index + leafOffset) % leaves.length]);
      const interleaved: RoomRequirement[] = [];
      let relayIndex = 0;
      let leafIndex = 0;
      while (relayIndex < relayOrder.length || leafIndex < leafOrder.length) {
        const shouldPlaceRelay = relayIndex < relayOrder.length
          && (leafIndex >= leafOrder.length
            || Math.floor((interleaved.length + 1) * relayOrder.length / Math.max(1, movable.length)) > relayIndex);
        if (shouldPlaceRelay) interleaved.push(relayOrder[relayIndex++]);
        else interleaved.push(leafOrder[leafIndex++]);
      }
      collect(interleaved);
      collect([...interleaved].reverse());
      if (orders.length >= DENSE_ORDER_ATTEMPT_LIMIT) break;
    }
    if (orders.length >= DENSE_ORDER_ATTEMPT_LIMIT) break;
  }

  let state = movable.reduce((hash, room) => {
    for (const character of room.id) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash;
  }, 0x811c9dc5) >>> 0;
  for (let shuffleAttempt = 0;
    orders.length < DENSE_ORDER_ATTEMPT_LIMIT && shuffleAttempt < DENSE_ORDER_ATTEMPT_LIMIT * 4;
    shuffleAttempt += 1) {
    const shuffled = [...movable];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      const swapIndex = state % (index + 1);
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    collect(shuffled);
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
    const aboveUse = floorRequirement.level > 0 && groundParkingBounds ? resolvedAboveParkingUse(requirements, floorRequirement.id) : undefined;
    if (aboveUse === "unbuilt" && groundParkingBounds) forbidden.push(groundParkingBounds);
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
          : ["balcony", "verandah", "courtyard", "terrace"].includes(room.type)
            ? 4
            : 3
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
    const denseFoyerBoundary: RequiredBoundary | undefined = floorRequirement.level === 0
      ? {
          side: scheme.topology.foyerWallRunReservation.side,
          minimumWallRunMm: Math.max(
            scheme.topology.foyerWallRunReservation.minimumClearWidthMm,
            requirements.entry.primaryDoorClearWidthMm + 2 * DOOR_JUNCTION_CLEARANCE_MM,
          ),
        }
      : undefined;
    const densePlacements = requestedProgramAreaMm2 > usableAreaMm2 * 0.9
      && forbidden.length === 0
      ? denseProgramPlacements({
          rooms: roomOrder,
          targetByRoom,
          policyByRoom,
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
      : undefined;
    let footprintExpandedForProgram = false;
    const placedByRoom = new Map<string, Rectangle>();
    const relayRoomTypes = new Set<RoomRequirement["type"]>(["foyer", "circulation", "living", "dining", "stair"]);
    for (const room of roomOrder) {
      const policy = policies.find((candidate) => candidate.roomType === room.type && candidate.requirementId === room.id)
        ?? policies.find((candidate) => candidate.roomType === room.type);
      if (!policy || policy.effectiveTargetAreaMm2 === 0) continue;
      const preferred = room.id === aboveTarget?.id && groundParkingBounds
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
              .filter(([roomId]) => relayRoomTypes.has(rooms.find((candidate) => candidate.id === roomId)?.type ?? "bedroom"))
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
      const alignedStairRectangle = room.type === "stair" && verticalStairBounds
        && overlapArea(verticalStairBounds, envelope) === verticalStairBounds.width * verticalStairBounds.depth
        && occupied.every((rectangle) => overlapArea(rectangle, verticalStairBounds!) === 0)
        && forbidden.every((rectangle) => overlapArea(rectangle, verticalStairBounds!) === 0)
        && verticalStairBounds.width * verticalStairBounds.depth >= policy.minimumAreaMm2
        && verticalStairBounds.width * verticalStairBounds.depth <= policy.hardMaximumAreaMm2
        ? verticalStairBounds
        : undefined;
      const placed = alignedStairRectangle
        ? { rectangle: alignedStairRectangle, footprintExpanded: !rectangleInsideAnyFootprint(alignedStairRectangle, topologyFootprints) }
        : denseRectangle ? { rectangle: denseRectangle, footprintExpanded: true } : placeRoom({
        room,
        policy,
        envelope,
        preferred,
        topologyFootprints,
        occupied,
        forbidden,
        allocationTargetAreaMm2: room.type === "circulation"
          ? Math.max(allocationTargetByPolicy.get(policy) ?? policy.effectiveTargetAreaMm2, Math.floor(policy.hardMaximumAreaMm2 * 0.9))
          : allocationTargetByPolicy.get(policy) ?? policy.effectiveTargetAreaMm2,
        requiredBoundary,
        requiredAdjacentRectangles,
        minimumSharedWallMm: 1_000,
        minimumDimensionMm: room.type === "stair"
          ? requirements.vertical.stairFamily === "dog_leg"
            ? requirements.vertical.stairWidthMm * 2 + 200
            : requirements.vertical.stairWidthMm
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
      walls: deriveWalls(floorRequirement.id, envelope, regions),
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
