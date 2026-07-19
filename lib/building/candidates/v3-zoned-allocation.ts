import { minimumClearDimensionMm } from "@/lib/building/dimensions";
import type { ResolvedRoomAreaPolicy } from "@/lib/building/area-policy-v3";
import type { CardinalDirection, RoomRequirement } from "@/lib/building/requirements";
import type { Point, Rectangle } from "@/lib/building/schema";
import { isExteriorPlanningZone, planningZoneClass } from "@/lib/building/planning-zones-v3";

const GRID_MM = 100;
const MINIMUM_SHARED_WALL_MM = 1_000;
const MAX_EVALUATED_CANDIDATES = 50_000;
const TARGET_SCALES = [1, 0.75, 0.5, 0.25, 0] as const;
const GROUND_SCALE_CANDIDATE_BUDGETS = [5_000, 5_000, 7_500, 10_000, 22_500] as const;
const UPPER_SCALE_STRUCTURE_CANDIDATE_BUDGET = 5_000;

export type ZonedPlanningStructure =
  | "frontage_backplate"
  | "sidecar_spine"
  | "dual_loaded_spine"
  | "branched_t_spine"
  | "courtyard_loop";

export type ZonedTargetRelaxation = {
  roomId: string;
  requestedTargetAreaMm2: number;
  realizedTargetAreaMm2: number;
  reason: "FIT_WITHIN_HARD_ENVELOPE";
};

export type ZonedAllocationRejection = {
  structure: ZonedPlanningStructure;
  code:
    | "BOUNDARY_SIDES_INCOMPATIBLE"
    | "FRONTAGE_BAND_INFEASIBLE"
    | "CIRCULATION_SPINE_INFEASIBLE"
    | "ROOM_STACK_INFEASIBLE"
    | "FIXED_PLACEMENT_INFEASIBLE";
  requirementIds: string[];
  reason: string;
};

export type ZonedFloorAllocation = {
  placements: Map<string, Rectangle>;
  planningStructure: ZonedPlanningStructure;
  circulationCells: Rectangle[];
  targetRelaxations: ZonedTargetRelaxation[];
  evaluatedCandidateCount: number;
  rejections: ZonedAllocationRejection[];
};

export type ZonedFloorAllocationInput = {
  floorId: string;
  rooms: readonly RoomRequirement[];
  policyByRoom: ReadonlyMap<string, ResolvedRoomAreaPolicy>;
  targetByRoom: ReadonlyMap<string, number>;
  envelope: Rectangle;
  entrySide: CardinalDirection;
  rootRoomId: string;
  requiredBoundaryByRoom?: ReadonlyMap<string, {
    side: CardinalDirection;
    minimumWallRunMm: number;
  }>;
  attachedBathroomBedroom: ReadonlyMap<string, string>;
  fixedPlacements?: ReadonlyMap<string, Rectangle>;
  forbiddenRectangles?: readonly Rectangle[];
  minimumDimensionByRoom?: ReadonlyMap<string, number>;
  preferredCentroidByRoom?: ReadonlyMap<string, Point>;
};

type LocalRectangle = { u: number; v: number; width: number; depth: number };

type RoomRun = {
  room: RoomRequirement;
  width: number;
  depth: number;
  targetAreaMm2: number;
};

type RoomGroup = {
  id: string;
  rooms: RoomRequirement[];
  forceWing?: 0 | 1;
};

function ceilGrid(value: number) {
  return Math.ceil(value / GRID_MM) * GRID_MM;
}

function rectangleArea(rectangle: Rectangle | LocalRectangle) {
  return rectangle.width * rectangle.depth;
}

function overlapArea(left: Rectangle, right: Rectangle) {
  return Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x))
    * Math.max(0, Math.min(left.y + left.depth, right.y + right.depth) - Math.max(left.y, right.y));
}

function localEnvelopeDimensions(envelope: Rectangle, entrySide: CardinalDirection) {
  return entrySide === "north" || entrySide === "south"
    ? { frontage: envelope.width, inward: envelope.depth }
    : { frontage: envelope.depth, inward: envelope.width };
}

function toGlobal(
  local: LocalRectangle,
  envelope: Rectangle,
  entrySide: CardinalDirection,
): Rectangle {
  if (entrySide === "north") {
    return {
      x: envelope.x + local.u,
      y: envelope.y + local.v,
      width: local.width,
      depth: local.depth,
    };
  }
  if (entrySide === "south") {
    return {
      x: envelope.x + local.u,
      y: envelope.y + envelope.depth - local.v - local.depth,
      width: local.width,
      depth: local.depth,
    };
  }
  if (entrySide === "west") {
    return {
      x: envelope.x + local.v,
      y: envelope.y + local.u,
      width: local.depth,
      depth: local.width,
    };
  }
  return {
    x: envelope.x + envelope.width - local.v - local.depth,
    y: envelope.y + local.u,
    width: local.depth,
    depth: local.width,
  };
}

function fromGlobal(
  rectangle: Rectangle,
  envelope: Rectangle,
  entrySide: CardinalDirection,
): LocalRectangle {
  if (entrySide === "north") {
    return {
      u: rectangle.x - envelope.x,
      v: rectangle.y - envelope.y,
      width: rectangle.width,
      depth: rectangle.depth,
    };
  }
  if (entrySide === "south") {
    return {
      u: rectangle.x - envelope.x,
      v: envelope.y + envelope.depth - rectangle.y - rectangle.depth,
      width: rectangle.width,
      depth: rectangle.depth,
    };
  }
  if (entrySide === "west") {
    return {
      u: rectangle.y - envelope.y,
      v: rectangle.x - envelope.x,
      width: rectangle.depth,
      depth: rectangle.width,
    };
  }
  return {
    u: rectangle.y - envelope.y,
    v: envelope.x + envelope.width - rectangle.x - rectangle.width,
    width: rectangle.depth,
    depth: rectangle.width,
  };
}

function preferredLocalPoint(input: ZonedFloorAllocationInput, roomId: string) {
  const point = input.preferredCentroidByRoom?.get(roomId);
  if (!point) return undefined;
  const local = fromGlobal(
    { x: point.x, y: point.y, width: 0, depth: 0 },
    input.envelope,
    input.entrySide,
  );
  return { u: local.u, v: local.v };
}

function groupPreferredLocalPoint(input: ZonedFloorAllocationInput, group: RoomGroup) {
  const points = group.rooms
    .map((room) => preferredLocalPoint(input, room.id))
    .filter((point): point is { u: number; v: number } => Boolean(point));
  if (points.length === 0) return undefined;
  return {
    u: points.reduce((sum, point) => sum + point.u, 0) / points.length,
    v: points.reduce((sum, point) => sum + point.v, 0) / points.length,
  };
}

function policyFor(input: ZonedFloorAllocationInput, roomId: string) {
  return input.policyByRoom.get(roomId);
}

function roomAreaAtScale(
  input: ZonedFloorAllocationInput,
  room: RoomRequirement,
  scale: number,
) {
  const policy = policyFor(input, room.id);
  if (!policy) return undefined;
  const requested = input.targetByRoom.get(room.id) ?? policy.effectiveTargetAreaMm2;
  return Math.round(policy.minimumAreaMm2 + (requested - policy.minimumAreaMm2) * scale);
}

function anchorWidthCandidates(input: {
  room: RoomRequirement;
  policy: ResolvedRoomAreaPolicy;
  targetAreaMm2: number;
  minimumWallRunMm: number;
  frontage: number;
  inward: number;
}) {
  const minimum = ceilGrid(Math.max(
    minimumClearDimensionMm(input.room.type, input.room.accessible),
    input.minimumWallRunMm,
  ));
  const maximum = Math.min(input.frontage, Math.max(minimum, 4_500));
  const candidates: Array<{ width: number; depth: number }> = [];
  for (let width = minimum; width <= maximum; width += 200) {
    const depth = ceilGrid(Math.max(
      minimumClearDimensionMm(input.room.type, input.room.accessible),
      input.targetAreaMm2 / width,
    ));
    if (depth > input.inward) continue;
    const area = width * depth;
    if (area < input.policy.minimumAreaMm2 || area > input.policy.hardMaximumAreaMm2) continue;
    candidates.push({ width, depth });
  }
  return candidates.sort((left, right) =>
    (left.width / input.frontage + left.depth / input.inward)
    - (right.width / input.frontage + right.depth / input.inward)
    || Math.abs(left.width * left.depth - input.targetAreaMm2)
      - Math.abs(right.width * right.depth - input.targetAreaMm2)
    || left.width - right.width,
  ).slice(0, 12);
}

function permutations<T>(values: readonly T[]) {
  if (values.length <= 1) return [Array.from(values)];
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += 1) {
    const head = values[index];
    const rest = values.filter((_, candidateIndex) => candidateIndex !== index);
    for (const tail of permutations(rest)) result.push([head, ...tail]);
  }
  return result;
}

function attachedGroups(
  rooms: readonly RoomRequirement[],
  attachedBathroomBedroom: ReadonlyMap<string, string>,
  livingRoomId?: string,
  diningRoomId?: string,
): RoomGroup[] {
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const consumed = new Set<string>();
  const groups: RoomGroup[] = [];
  if (livingRoomId && byId.has(livingRoomId)) {
    const groupRooms = [byId.get(livingRoomId)!];
    if (diningRoomId && byId.has(diningRoomId)) {
      groupRooms.push(byId.get(diningRoomId)!);
      consumed.add(diningRoomId);
    }
    consumed.add(livingRoomId);
    groups.push({ id: "public-arrival-sequence", rooms: groupRooms });
  }
  for (const room of rooms) {
    if (consumed.has(room.id) || attachedBathroomBedroom.has(room.id)) continue;
    const attached = [...attachedBathroomBedroom]
      .filter(([, bedroomId]) => bedroomId === room.id)
      .map(([bathroomId]) => byId.get(bathroomId))
      .filter((candidate): candidate is RoomRequirement => Boolean(candidate))
      .sort((left, right) => left.id.localeCompare(right.id));
    groups.push({ id: `group-${room.id}`, rooms: [room, ...attached] });
    consumed.add(room.id);
    attached.forEach((candidate) => consumed.add(candidate.id));
  }
  for (const room of rooms) if (!consumed.has(room.id)) {
    groups.push({ id: `group-${room.id}`, rooms: [room] });
    consumed.add(room.id);
  }
  return groups;
}

function roomRunsForWing(input: {
  allocation: ZonedFloorAllocationInput;
  group: RoomGroup;
  wingWidth: number;
  targetScale: number;
}) {
  const runs: RoomRun[] = [];
  for (const room of input.group.rooms) {
    const policy = policyFor(input.allocation, room.id);
    const targetAreaMm2 = roomAreaAtScale(input.allocation, room, input.targetScale);
    if (!policy || targetAreaMm2 === undefined) return undefined;
    const minimumDimension = Math.max(
      minimumClearDimensionMm(room.type, room.accessible),
      input.allocation.minimumDimensionByRoom?.get(room.id) ?? 0,
    );
    if (input.wingWidth < minimumDimension) return undefined;
    const maximumWidthAtMinimumDepth = Math.floor(
      policy.hardMaximumAreaMm2 / minimumDimension / GRID_MM,
    ) * GRID_MM;
    const width = input.wingWidth * minimumDimension <= policy.hardMaximumAreaMm2
      ? input.wingWidth
      : room.mustBeExterior
        ? input.wingWidth
        : Math.max(minimumDimension, Math.min(input.wingWidth, maximumWidthAtMinimumDepth));
    const depth = ceilGrid(Math.max(minimumDimension, targetAreaMm2 / width));
    const area = width * depth;
    if (area < policy.minimumAreaMm2 || area > policy.hardMaximumAreaMm2) return undefined;
    runs.push({ room, width, depth, targetAreaMm2 });
  }
  return runs;
}

function roomRunsForHorizontalWing(input: {
  allocation: ZonedFloorAllocationInput;
  group: RoomGroup;
  wingDepth: number;
  targetScale: number;
}) {
  const runs: RoomRun[] = [];
  for (const room of input.group.rooms) {
    const policy = policyFor(input.allocation, room.id);
    const targetAreaMm2 = roomAreaAtScale(input.allocation, room, input.targetScale);
    if (!policy || targetAreaMm2 === undefined) return undefined;
    const minimumDimension = Math.max(
      minimumClearDimensionMm(room.type, room.accessible),
      input.allocation.minimumDimensionByRoom?.get(room.id) ?? 0,
    );
    if (input.wingDepth < minimumDimension) return undefined;
    const maximumDepthAtMinimumWidth = Math.floor(
      policy.hardMaximumAreaMm2 / minimumDimension / GRID_MM,
    ) * GRID_MM;
    const depth = input.wingDepth * minimumDimension <= policy.hardMaximumAreaMm2
      ? input.wingDepth
      : room.mustBeExterior
        ? input.wingDepth
        : Math.max(minimumDimension, Math.min(input.wingDepth, maximumDepthAtMinimumWidth));
    const width = ceilGrid(Math.max(minimumDimension, targetAreaMm2 / depth));
    const area = width * depth;
    if (area < policy.minimumAreaMm2 || area > policy.hardMaximumAreaMm2) return undefined;
    runs.push({ room, width, depth, targetAreaMm2 });
  }
  return runs;
}

function rectanglesOverlap(left: LocalRectangle, right: LocalRectangle) {
  return Math.min(left.u + left.width, right.u + right.width) > Math.max(left.u, right.u)
    && Math.min(left.v + left.depth, right.v + right.depth) > Math.max(left.v, right.v);
}

function minimumWingStart(
  wing: LocalRectangle,
  anchors: ReadonlyMap<string, LocalRectangle>,
  corridorStart: number,
) {
  let start = corridorStart;
  for (const rectangle of anchors.values()) {
    const overlapsWing = Math.min(wing.u + wing.width, rectangle.u + rectangle.width)
      > Math.max(wing.u, rectangle.u);
    if (overlapsWing) start = Math.max(start, rectangle.v + rectangle.depth);
  }
  return start;
}

function fixedPlacementsCompatible(
  input: ZonedFloorAllocationInput,
  placements: ReadonlyMap<string, LocalRectangle>,
) {
  if (!input.fixedPlacements?.size) return true;
  for (const [roomId, globalRectangle] of input.fixedPlacements) {
    const local = fromGlobal(globalRectangle, input.envelope, input.entrySide);
    const planned = placements.get(roomId);
    if (!planned
      || planned.u !== local.u
      || planned.v !== local.v
      || planned.width !== local.width
      || planned.depth !== local.depth) return false;
  }
  return true;
}

function forbiddenPlacementsCompatible(
  input: ZonedFloorAllocationInput,
  placements: ReadonlyMap<string, Rectangle>,
) {
  return [...placements.values()].every((rectangle) =>
    (input.forbiddenRectangles ?? []).every((forbidden) =>
      overlapArea(rectangle, forbidden) === 0));
}

/**
 * A deterministic arrival-band plus dual-loaded-spine solver. Candidate legality is shared across
 * partis, while topology-owned room centroids order the bounded search so distinct directions
 * realize distinct physical arrangements instead of inheriting the same first feasible layout.
 */
export function allocateZonedFloor(input: ZonedFloorAllocationInput): ZonedFloorAllocation {
  const rooms = input.rooms.filter((room) => room.floorId === input.floorId);
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const root = roomById.get(input.rootRoomId);
  const foyer = rooms.find((room) => room.type === "foyer");
  const circulation = rooms.find((room) => room.type === "circulation");
  const parking = rooms.find((room) => room.type === "parking");
  const verandah = rooms.find((room) => room.type === "verandah");
  const living = rooms.find((room) => room.type === "living");
  const dining = rooms.find((room) => room.type === "dining");
  const dimensions = localEnvelopeDimensions(input.envelope, input.entrySide);
  const rejections: ZonedAllocationRejection[] = [];
  let evaluatedCandidateCount = 0;

  if (!root || !foyer || !circulation) {
    throw new Error(`ZONED_ALLOCATION_REQUIRED_ROOTS_MISSING:${input.floorId}`);
  }
  const boundaryRooms = [...(input.requiredBoundaryByRoom ?? new Map())];
  const incompatibleBoundary = boundaryRooms.find(([, boundary]) => boundary.side !== input.entrySide);
  if (incompatibleBoundary) {
    throw new Error(`ZONED_ALLOCATION_BOUNDARY_SIDES_INCOMPATIBLE:${incompatibleBoundary[0]}`);
  }

  const anchoredRooms = [parking, verandah, foyer].filter(
    (room): room is RoomRequirement => Boolean(room),
  );
  const anchorsWithoutFoyer = anchoredRooms.filter((room) => room.id !== foyer.id);
  const anchorOrders = permutations(anchorsWithoutFoyer).map((order) => [...order, foyer]);

  for (const [scaleIndex, targetScale] of TARGET_SCALES.entries()) {
    let scaleCandidateBudgetExhausted = false;
    const scaleCandidateStart = evaluatedCandidateCount;
    const scaleCandidateBudget = GROUND_SCALE_CANDIDATE_BUDGETS[scaleIndex];
    const candidatesByAnchor = new Map<string, Array<{ width: number; depth: number }>>();
    let anchorsValid = true;
    for (const room of anchoredRooms) {
      const policy = policyFor(input, room.id);
      const targetAreaMm2 = roomAreaAtScale(input, room, targetScale);
      if (!policy || targetAreaMm2 === undefined) {
        anchorsValid = false;
        break;
      }
      const boundary = input.requiredBoundaryByRoom?.get(room.id);
      const candidates = anchorWidthCandidates({
        room,
        policy,
        targetAreaMm2,
        minimumWallRunMm: boundary?.minimumWallRunMm ?? 0,
        frontage: dimensions.frontage,
        inward: dimensions.inward,
      });
      if (candidates.length === 0) {
        anchorsValid = false;
        break;
      }
      candidatesByAnchor.set(room.id, candidates);
    }
    if (!anchorsValid) continue;

    for (const anchorOrder of anchorOrders) {
      if (scaleCandidateBudgetExhausted) break;
      const chosen: Array<{ room: RoomRequirement; width: number; depth: number }> = [];
      const chooseAnchors = (index: number): ZonedFloorAllocation | undefined => {
        if (scaleCandidateBudgetExhausted) return undefined;
        if (index < anchorOrder.length) {
          const room = anchorOrder[index];
          for (const candidate of candidatesByAnchor.get(room.id) ?? []) {
            chosen.push({ room, ...candidate });
            const usedFrontage = chosen.reduce((sum, item) => sum + item.width, 0);
            if (usedFrontage <= dimensions.frontage) {
              const result = chooseAnchors(index + 1);
              if (result) return result;
            }
            chosen.pop();
          }
          return undefined;
        }

        const totalFrontage = chosen.reduce((sum, item) => sum + item.width, 0);
        const preferredAnchorCentre = chosen.reduce((sum, item) =>
          sum + (preferredLocalPoint(input, item.room.id)?.u ?? dimensions.frontage / 2), 0)
          / Math.max(1, chosen.length);
        const offsets = [...new Set([
          0,
          ceilGrid((dimensions.frontage - totalFrontage) / 2),
          dimensions.frontage - totalFrontage,
        ])].sort((left, right) =>
          Math.abs(left + totalFrontage / 2 - preferredAnchorCentre)
            - Math.abs(right + totalFrontage / 2 - preferredAnchorCentre)
          || left - right);
        for (const offset of offsets) {
          if (offset < 0 || offset + totalFrontage > dimensions.frontage) continue;
          const localAnchors = new Map<string, LocalRectangle>();
          let cursor = offset;
          for (const item of chosen) {
            localAnchors.set(item.room.id, {
              u: cursor,
              v: 0,
              width: item.width,
              depth: item.depth,
            });
            cursor += item.width;
          }
          const foyerRectangle = localAnchors.get(foyer.id)!;
          const circulationPolicy = policyFor(input, circulation.id);
          const circulationTarget = roomAreaAtScale(input, circulation, targetScale);
          if (!circulationPolicy || circulationTarget === undefined) continue;
          const circulationStart = foyerRectangle.depth;
          const availableLength = dimensions.inward - circulationStart;
          if (availableLength < MINIMUM_SHARED_WALL_MM) continue;
          const minimumCorridorWidth = ceilGrid(minimumClearDimensionMm(circulation.type, circulation.accessible));
          const maximumCorridorWidth = Math.floor(circulationPolicy.hardMaximumAreaMm2 / availableLength / GRID_MM) * GRID_MM;
          const corridorWidth = Math.max(
            minimumCorridorWidth,
            Math.min(
              maximumCorridorWidth,
              ceilGrid(circulationTarget / availableLength),
            ),
          );
          if (corridorWidth < minimumCorridorWidth
            || corridorWidth * availableLength < circulationPolicy.minimumAreaMm2
            || corridorWidth * availableLength > circulationPolicy.hardMaximumAreaMm2) continue;

          const corridorStartMin = Math.max(
            foyerRectangle.u,
            foyerRectangle.u + foyerRectangle.width - corridorWidth - Math.max(MINIMUM_SHARED_WALL_MM, foyerRectangle.width / 2),
          );
          const corridorStartMax = Math.min(
            foyerRectangle.u + foyerRectangle.width - corridorWidth,
            dimensions.frontage - corridorWidth,
          );
          const preferredCorridorU = (preferredLocalPoint(input, circulation.id)?.u
            ?? foyerRectangle.u + foyerRectangle.width / 2) - corridorWidth / 2;
          const corridorCandidates: number[] = [];
          for (let corridorU = ceilGrid(corridorStartMin); corridorU <= corridorStartMax; corridorU += GRID_MM) {
            corridorCandidates.push(corridorU);
          }
          corridorCandidates.sort((left, right) =>
            Math.abs(left - preferredCorridorU) - Math.abs(right - preferredCorridorU)
            || left - right);
          for (const corridorU of corridorCandidates) {
            const corridor: LocalRectangle = {
              u: corridorU,
              v: circulationStart,
              width: corridorWidth,
              depth: availableLength,
            };
            const wings: [LocalRectangle, LocalRectangle] = [
              { u: 0, v: 0, width: corridor.u, depth: dimensions.inward },
              {
                u: corridor.u + corridor.width,
                v: 0,
                width: dimensions.frontage - corridor.u - corridor.width,
                depth: dimensions.inward,
              },
            ];
            if (wings.some((wing) => wing.width < GRID_MM)) continue;
            const wingStarts: [number, number] = [
              minimumWingStart(wings[0], localAnchors, circulationStart),
              minimumWingStart(wings[1], localAnchors, circulationStart),
            ];

            const interiorRooms = rooms.filter((room) =>
              !localAnchors.has(room.id)
              && room.id !== circulation.id);
            const groups = attachedGroups(
              interiorRooms,
              input.attachedBathroomBedroom,
              living?.id,
              dining?.id,
            );
            if (groups.length > 20) continue;
            const runCache = new Map<string, RoomRun[]>();
            let runsValid = true;
            for (const group of groups) for (const wing of [0, 1] as const) {
              const runs = roomRunsForWing({
                allocation: input,
                group,
                wingWidth: wings[wing].width,
                targetScale,
              });
              if (runs) runCache.set(`${group.id}:${wing}`, runs);
              else if (group.forceWing === wing) runsValid = false;
            }
            if (!runsValid) continue;

            const assignmentCount = 2 ** groups.length;
            for (let assignment = 0; assignment < assignmentCount; assignment += 1) {
              evaluatedCandidateCount += 1;
              if (evaluatedCandidateCount - scaleCandidateStart >= scaleCandidateBudget) {
                scaleCandidateBudgetExhausted = true;
                return undefined;
              }
              const assigned: [RoomGroup[], RoomGroup[]] = [[], []];
              let assignmentValid = true;
              for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
                const group = groups[groupIndex];
                const wing = group.forceWing ?? ((assignment >> groupIndex) & 1) as 0 | 1;
                if (!runCache.has(`${group.id}:${wing}`)) {
                  assignmentValid = false;
                  break;
                }
                assigned[wing].push(group);
              }
              if (!assignmentValid) continue;
              for (const wing of [0, 1] as const) assigned[wing].sort((left, right) => {
                if (left.id === "public-arrival-sequence") return -1;
                if (right.id === "public-arrival-sequence") return 1;
                const leftExterior = left.rooms.some((room) => room.mustBeExterior || isExteriorPlanningZone(room.type));
                const rightExterior = right.rooms.some((room) => room.mustBeExterior || isExteriorPlanningZone(room.type));
                return Number(rightExterior) - Number(leftExterior)
                  || (groupPreferredLocalPoint(input, left)?.v ?? dimensions.inward / 2)
                    - (groupPreferredLocalPoint(input, right)?.v ?? dimensions.inward / 2)
                  || left.id.localeCompare(right.id);
              });

              const placements = new Map(localAnchors);
              placements.set(circulation.id, corridor);
              let allFit = true;
              for (const wing of [0, 1] as const) {
                let v = wingStarts[wing];
                for (const group of assigned[wing]) {
                  const runs = runCache.get(`${group.id}:${wing}`)!;
                  for (const run of runs) {
                    const rectangle: LocalRectangle = {
                      u: wing === 0
                        ? wings[wing].u + wings[wing].width - run.width
                        : wings[wing].u,
                      v,
                      width: run.width,
                      depth: run.depth,
                    };
                    if (rectangle.v + rectangle.depth > dimensions.inward
                      || [...placements.values()].some((placed) => rectanglesOverlap(placed, rectangle))) {
                      allFit = false;
                      break;
                    }
                    placements.set(run.room.id, rectangle);
                    v += rectangle.depth;
                  }
                  if (!allFit) break;
                }
                if (!allFit) break;
              }
              if (!allFit || placements.size !== rooms.length) continue;
              if (!fixedPlacementsCompatible(input, placements)) continue;

              const globalPlacements = new Map([...placements].map(([roomId, rectangle]) => [
                roomId,
                toGlobal(rectangle, input.envelope, input.entrySide),
              ]));
              if ([...globalPlacements.values()].some((rectangle) =>
                rectangle.x < input.envelope.x
                || rectangle.y < input.envelope.y
                || rectangle.x + rectangle.width > input.envelope.x + input.envelope.width
                || rectangle.y + rectangle.depth > input.envelope.y + input.envelope.depth)) continue;
              if ([...globalPlacements.values()].some((rectangle, index, values) =>
                values.some((other, otherIndex) => otherIndex > index && overlapArea(rectangle, other) > 0))) continue;

              const targetRelaxations = rooms.flatMap((room): ZonedTargetRelaxation[] => {
                const requestedTargetAreaMm2 = input.targetByRoom.get(room.id)
                  ?? policyFor(input, room.id)?.effectiveTargetAreaMm2
                  ?? room.targetAreaMm2;
                const realizedTargetAreaMm2 = rectangleArea(globalPlacements.get(room.id)!);
                return realizedTargetAreaMm2 + GRID_MM * GRID_MM < requestedTargetAreaMm2
                  ? [{
                      roomId: room.id,
                      requestedTargetAreaMm2,
                      realizedTargetAreaMm2,
                      reason: "FIT_WITHIN_HARD_ENVELOPE",
                    }]
                  : [];
              });
              return {
                placements: globalPlacements,
                planningStructure: "dual_loaded_spine",
                circulationCells: [toGlobal(corridor, input.envelope, input.entrySide)],
                targetRelaxations,
                evaluatedCandidateCount,
                rejections,
              };
            }
          }
        }
        return undefined;
      };
      const result = chooseAnchors(0);
      if (result) return result;
    }
  }

  const requirementIds = rooms.map((room) => room.id);
  rejections.push({
    structure: "dual_loaded_spine",
    code: "ROOM_STACK_INFEASIBLE",
    requirementIds,
    reason: "No deterministic frontage-band and dual-loaded-spine candidate satisfied hard room areas, frontage, privacy, and coverage.",
  });
  const error = new Error(`ZONED_ALLOCATION_INFEASIBLE:${input.floorId}`);
  Object.assign(error, { requirementIds, rejections, evaluatedCandidateCount });
  throw error;
}

/**
 * Upper floors reuse the aligned stair as the arrival anchor. A full-depth protected spine is
 * placed immediately beside it, then bedroom suites and other destinations are packed on both
 * sides. This prevents late bedrooms from exhausting the perimeter of one small lobby rectangle.
 */
export function allocateZonedUpperFloor(input: ZonedFloorAllocationInput): ZonedFloorAllocation {
  const rooms = input.rooms.filter((room) => room.floorId === input.floorId);
  const stair = rooms.find((room) => room.type === "stair");
  const circulation = rooms.find((room) => room.type === "circulation");
  const fixedStair = stair ? input.fixedPlacements?.get(stair.id) : undefined;
  if (!stair || !circulation || !fixedStair) {
    throw new Error(`ZONED_UPPER_REQUIRED_ROOTS_MISSING:${input.floorId}`);
  }
  const dimensions = localEnvelopeDimensions(input.envelope, input.entrySide);
  const localStair = fromGlobal(fixedStair, input.envelope, input.entrySide);
  const circulationPolicy = policyFor(input, circulation.id);
  if (!circulationPolicy) throw new Error(`ZONED_UPPER_POLICY_MISSING:${circulation.id}`);
  const rejections: ZonedAllocationRejection[] = [];
  let evaluatedCandidateCount = 0;

  for (const targetScale of TARGET_SCALES) {
    const scaleCandidateLimit = Math.min(
      MAX_EVALUATED_CANDIDATES,
      evaluatedCandidateCount + UPPER_SCALE_STRUCTURE_CANDIDATE_BUDGET,
    );
    const circulationTarget = roomAreaAtScale(input, circulation, targetScale);
    if (circulationTarget === undefined) continue;
    for (let corridorWidth = ceilGrid(minimumClearDimensionMm(circulation.type, circulation.accessible));
      corridorWidth <= 1_400;
      corridorWidth += GRID_MM) {
      const maximumLength = Math.min(
        dimensions.inward,
        Math.floor(circulationPolicy.hardMaximumAreaMm2 / corridorWidth / GRID_MM) * GRID_MM,
      );
      const minimumLength = ceilGrid(Math.max(
        MINIMUM_SHARED_WALL_MM,
        circulationPolicy.minimumAreaMm2 / corridorWidth,
      ));
      if (maximumLength < minimumLength) continue;
      for (const corridorLength of [...new Set([
        maximumLength,
        Math.max(minimumLength, ceilGrid(circulationTarget / corridorWidth)),
      ])]) {
        const v = Math.max(
          0,
          Math.min(dimensions.inward - corridorLength, localStair.v + localStair.depth - corridorLength),
        );
        const corridorUs = [
          localStair.u - corridorWidth,
          localStair.u + localStair.width,
        ].filter((u) => u >= 0 && u + corridorWidth <= dimensions.frontage);
        for (const u of corridorUs) {
          const corridor: LocalRectangle = {
            u,
            v,
            width: corridorWidth,
            depth: corridorLength,
          };
          if (rectanglesOverlap(corridor, localStair)) continue;
          const globalCorridor = toGlobal(corridor, input.envelope, input.entrySide);
          if (overlapArea(globalCorridor, fixedStair) > 0) continue;
          const wings: [LocalRectangle, LocalRectangle] = [
            { u: 0, v, width: corridor.u, depth: corridor.depth },
            {
              u: corridor.u + corridor.width,
              v,
              width: dimensions.frontage - corridor.u - corridor.width,
              depth: corridor.depth,
            },
          ];
          if (wings.some((wing) => wing.width < GRID_MM)) continue;
          const fixedLocal = new Map([[stair.id, localStair]]);
          const wingStarts: [number, number] = [
            minimumWingStart(wings[0], fixedLocal, v),
            minimumWingStart(wings[1], fixedLocal, v),
          ];
          const groups = attachedGroups(
            rooms.filter((room) => room.id !== stair.id && room.id !== circulation.id),
            input.attachedBathroomBedroom,
            rooms.find((room) => room.type === "living")?.id,
            rooms.find((room) => room.type === "dining")?.id,
          );
          if (groups.length > 20) continue;
          const runCache = new Map<string, RoomRun[]>();
          for (const group of groups) for (const wing of [0, 1] as const) {
            const runs = roomRunsForWing({
              allocation: input,
              group,
              wingWidth: wings[wing].width,
              targetScale,
            });
            if (runs) runCache.set(`${group.id}:${wing}`, runs);
          }
          const assignmentCount = 2 ** groups.length;
          for (let assignment = 0; assignment < assignmentCount; assignment += 1) {
            evaluatedCandidateCount += 1;
            if (evaluatedCandidateCount > scaleCandidateLimit) break;
            const assigned: [RoomGroup[], RoomGroup[]] = [[], []];
            let valid = true;
            for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
              const group = groups[groupIndex];
              const wing = ((assignment >> groupIndex) & 1) as 0 | 1;
              if (!runCache.has(`${group.id}:${wing}`)) {
                valid = false;
                break;
              }
              assigned[wing].push(group);
            }
            if (!valid) continue;
            for (const wing of [0, 1] as const) assigned[wing].sort((left, right) => {
              if (left.id === "public-arrival-sequence") return -1;
              if (right.id === "public-arrival-sequence") return 1;
              return left.id.localeCompare(right.id);
            });
            const placements = new Map<string, LocalRectangle>([
              [stair.id, localStair],
              [circulation.id, corridor],
            ]);
            for (const wing of [0, 1] as const) {
              let cursor = wingStarts[wing];
              for (const group of assigned[wing]) {
                for (const run of runCache.get(`${group.id}:${wing}`)!) {
                  const rectangle: LocalRectangle = {
                    u: wing === 0
                      ? wings[wing].u + wings[wing].width - run.width
                      : wings[wing].u,
                    v: cursor,
                    width: run.width,
                    depth: run.depth,
                  };
                  if (rectangle.v + rectangle.depth > corridor.v + corridor.depth
                    || [...placements.values()].some((placed) => rectanglesOverlap(placed, rectangle))) {
                    valid = false;
                    break;
                  }
                  placements.set(run.room.id, rectangle);
                  cursor += rectangle.depth;
                }
                if (!valid) break;
              }
              if (!valid) break;
            }
            if (!valid || placements.size !== rooms.length || !fixedPlacementsCompatible(input, placements)) continue;
            const globalPlacements = new Map([...placements].map(([roomId, rectangle]) => [
              roomId,
              toGlobal(rectangle, input.envelope, input.entrySide),
            ]));
            if (!forbiddenPlacementsCompatible(input, globalPlacements)) continue;
            const targetRelaxations = rooms.flatMap((room): ZonedTargetRelaxation[] => {
              const requestedTargetAreaMm2 = input.targetByRoom.get(room.id)
                ?? policyFor(input, room.id)?.effectiveTargetAreaMm2
                ?? room.targetAreaMm2;
              const realizedTargetAreaMm2 = rectangleArea(globalPlacements.get(room.id)!);
              return realizedTargetAreaMm2 + GRID_MM * GRID_MM < requestedTargetAreaMm2
                ? [{
                    roomId: room.id,
                    requestedTargetAreaMm2,
                    realizedTargetAreaMm2,
                    reason: "FIT_WITHIN_HARD_ENVELOPE",
                  }]
                : [];
            });
            return {
              placements: globalPlacements,
              planningStructure: "dual_loaded_spine",
              circulationCells: [globalCorridor],
              targetRelaxations,
              evaluatedCandidateCount,
              rejections,
            };
          }
        }
      }
    }
  }

  for (const targetScale of TARGET_SCALES) {
    const scaleCandidateLimit = Math.min(
      MAX_EVALUATED_CANDIDATES,
      evaluatedCandidateCount + UPPER_SCALE_STRUCTURE_CANDIDATE_BUDGET,
    );
    const circulationTarget = roomAreaAtScale(input, circulation, targetScale);
    if (circulationTarget === undefined) continue;
    for (let corridorDepth = ceilGrid(minimumClearDimensionMm(circulation.type, circulation.accessible));
      corridorDepth <= 1_400;
      corridorDepth += GRID_MM) {
      const maximumLength = Math.min(
        dimensions.frontage,
        Math.floor(circulationPolicy.hardMaximumAreaMm2 / corridorDepth / GRID_MM) * GRID_MM,
      );
      const minimumLength = ceilGrid(Math.max(
        MINIMUM_SHARED_WALL_MM,
        circulationPolicy.minimumAreaMm2 / corridorDepth,
      ));
      if (maximumLength < minimumLength) continue;
      for (const corridorV of [
        localStair.v + localStair.depth,
        localStair.v - corridorDepth,
      ]) {
        if (corridorV < 0 || corridorV + corridorDepth > dimensions.inward) continue;
        for (const corridorLength of [...new Set([
          maximumLength,
          Math.max(minimumLength, ceilGrid(circulationTarget / corridorDepth)),
        ])]) {
          const corridorU = Math.max(
            0,
            Math.min(
              dimensions.frontage - corridorLength,
              localStair.u + localStair.width - corridorLength,
            ),
          );
          const corridor: LocalRectangle = {
            u: corridorU,
            v: corridorV,
            width: corridorLength,
            depth: corridorDepth,
          };
          if (rectanglesOverlap(corridor, localStair)) continue;
          const sharedWithStair = (
            localStair.v + localStair.depth === corridor.v
            || corridor.v + corridor.depth === localStair.v
          ) && Math.max(
            0,
            Math.min(localStair.u + localStair.width, corridor.u + corridor.width)
              - Math.max(localStair.u, corridor.u),
          ) >= MINIMUM_SHARED_WALL_MM;
          if (!sharedWithStair) continue;
          const wings: [LocalRectangle, LocalRectangle] = [
            { u: corridor.u, v: 0, width: corridor.width, depth: corridor.v },
            {
              u: corridor.u,
              v: corridor.v + corridor.depth,
              width: corridor.width,
              depth: dimensions.inward - corridor.v - corridor.depth,
            },
          ];
          if (wings.some((wing) => wing.depth < GRID_MM)) continue;
          const groups = attachedGroups(
            rooms.filter((room) => room.id !== stair.id && room.id !== circulation.id),
            input.attachedBathroomBedroom,
            rooms.find((room) => room.type === "living")?.id,
            rooms.find((room) => room.type === "dining")?.id,
          );
          const runCache = new Map<string, RoomRun[]>();
          for (const group of groups) for (const wing of [0, 1] as const) {
            const runs = roomRunsForHorizontalWing({
              allocation: input,
              group,
              wingDepth: wings[wing].depth,
              targetScale,
            });
            if (runs) runCache.set(`${group.id}:${wing}`, runs);
          }
          const assignmentCount = 2 ** groups.length;
          for (let assignment = 0; assignment < assignmentCount; assignment += 1) {
            evaluatedCandidateCount += 1;
            if (evaluatedCandidateCount > scaleCandidateLimit) break;
            const assigned: [RoomGroup[], RoomGroup[]] = [[], []];
            let valid = true;
            for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
              const group = groups[groupIndex];
              const wing = ((assignment >> groupIndex) & 1) as 0 | 1;
              if (!runCache.has(`${group.id}:${wing}`)) {
                valid = false;
                break;
              }
              assigned[wing].push(group);
            }
            if (!valid) continue;
            for (const wing of [0, 1] as const) assigned[wing].sort((left, right) =>
              left.id.localeCompare(right.id));
            const placements = new Map<string, LocalRectangle>([
              [stair.id, localStair],
              [circulation.id, corridor],
            ]);
            for (const wing of [0, 1] as const) {
              let cursor = wings[wing].u;
              const stairOverlapsWing = Math.min(
                localStair.v + localStair.depth,
                wings[wing].v + wings[wing].depth,
              ) > Math.max(localStair.v, wings[wing].v);
              if (stairOverlapsWing) cursor = Math.max(cursor, localStair.u + localStair.width);
              for (const group of assigned[wing]) {
                for (const run of runCache.get(`${group.id}:${wing}`)!) {
                  const rectangle: LocalRectangle = {
                    u: cursor,
                    v: wing === 0
                      ? corridor.v - run.depth
                      : corridor.v + corridor.depth,
                    width: run.width,
                    depth: run.depth,
                  };
                  if (rectangle.u + rectangle.width > corridor.u + corridor.width
                    || [...placements.values()].some((placed) => rectanglesOverlap(placed, rectangle))) {
                    valid = false;
                    break;
                  }
                  placements.set(run.room.id, rectangle);
                  cursor += rectangle.width;
                }
                if (!valid) break;
              }
              if (!valid) break;
            }
            if (!valid || placements.size !== rooms.length || !fixedPlacementsCompatible(input, placements)) continue;
            const globalPlacements = new Map([...placements].map(([roomId, rectangle]) => [
              roomId,
              toGlobal(rectangle, input.envelope, input.entrySide),
            ]));
            if (!forbiddenPlacementsCompatible(input, globalPlacements)) continue;
            return {
              placements: globalPlacements,
              planningStructure: "branched_t_spine",
              circulationCells: [toGlobal(corridor, input.envelope, input.entrySide)],
              targetRelaxations: rooms.flatMap((room): ZonedTargetRelaxation[] => {
                const requestedTargetAreaMm2 = input.targetByRoom.get(room.id)
                  ?? policyFor(input, room.id)?.effectiveTargetAreaMm2
                  ?? room.targetAreaMm2;
                const realizedTargetAreaMm2 = rectangleArea(globalPlacements.get(room.id)!);
                return realizedTargetAreaMm2 + GRID_MM * GRID_MM < requestedTargetAreaMm2
                  ? [{
                      roomId: room.id,
                      requestedTargetAreaMm2,
                      realizedTargetAreaMm2,
                      reason: "FIT_WITHIN_HARD_ENVELOPE",
                    }]
                  : [];
              }),
              evaluatedCandidateCount,
              rejections,
            };
          }
        }
      }
    }
  }

  const requirementIds = rooms.map((room) => room.id);
  rejections.push({
    structure: "dual_loaded_spine",
    code: "ROOM_STACK_INFEASIBLE",
    requirementIds,
    reason: "No aligned-stair dual-loaded upper-floor candidate satisfied hard room areas and protected circulation.",
  });
  const error = new Error(`ZONED_UPPER_ALLOCATION_INFEASIBLE:${input.floorId}`);
  Object.assign(error, { requirementIds, rejections, evaluatedCandidateCount });
  throw error;
}
