import { MINIMUM_ACCESS_SHARED_WALL_MM, minimumClearDimensionMm } from "@/lib/building/dimensions";
import { splitOversizedBalconies } from "@/lib/building/candidates/balcony-remainder";
import type { RoomRequirement } from "@/lib/building/requirements";
import type { Rectangle } from "@/lib/building/schema";
import { candidateRoom, reservedRegionConflicts, type CandidateGeneratorOptions, type CandidateRoom, type FloorCandidate } from "@/lib/building/candidates/types";
import { MAIN_ENTRY_CLEAR_WIDTH_MM } from "@/lib/building/openings";
import { accessSharedWallViolations } from "@/lib/building/access-contract";
import { PARTI_GRAMMARS, shouldQuarterTurnParti } from "@/lib/building/partis";

type RoomGroup = { rooms: RoomRequirement[]; weight: number; kind: "suite" | "social" | "pair" | "single" };
type WingSide = "left" | "right";
type PartiCandidateGeneratorOptions = CandidateGeneratorOptions & { quarterTurned?: boolean };
const COORDINATED_COURT_MIN_AREA_MM2 = 8_000_000;

function enforcePartiContract(result: FloorCandidate, options: CandidateGeneratorOptions): FloorCandidate {
  const accessSpineSpaceIds = result.accessSpineSpaceIds ?? [];
  const reservedConflicts = reservedRegionConflicts(result.cells, result.appliedReservedRegions ?? []);
  if (reservedConflicts.length > 0) {
    const first = reservedConflicts[0];
    throw new Error(`PARTI_RESERVED_REGION_OVERLAP:${first.regionId}:${first.cellId}`);
  }
  const accessViolations = accessSharedWallViolations(
    result.cells,
    accessSpineSpaceIds,
    options.requiredConnections,
    new Set(PARTI_GRAMMARS[options.partiId ?? "t_hub"].innerCellTypes),
  );
  if (accessViolations.length > 0) {
    const first = accessViolations[0];
    throw new Error(`PARTI_ACCESS_SHARED_WALL:${first.code}:${first.cellIds.join("|")}:${first.measuredMm}`);
  }
  return result;
}

function generateNarrowCompactCandidate(options: CandidateGeneratorOptions): FloorCandidate {
  if (options.stairCore) throw new Error("PARTI_COMPACT_STAIR_UNSUPPORTED");
  const byType = (type: RoomRequirement["type"]) => options.rooms.filter((room) => room.type === type);
  const bedrooms = byType("bedroom");
  const [living] = byType("living");
  const [kitchen] = byType("kitchen");
  const [bathroom] = byType("bathroom");
  const [foyer] = byType("foyer");
  const [circulation] = byType("circulation");
  const recognizedIds = new Set([living, kitchen, bathroom, foyer, circulation, ...bedrooms].filter(Boolean).map((room) => room.id));
  if (
    bedrooms.length !== 2 || !living || !kitchen || !bathroom || !foyer || !circulation
    || recognizedIds.size !== options.rooms.length
  ) throw new Error("PARTI_COMPACT_PROGRAM_UNSUPPORTED");

  const { envelope } = options;
  const halfWidth = Math.floor(envelope.width / 2);
  const otherHalfWidth = envelope.width - halfWidth;
  const hubWidth = 2 * MINIMUM_ACCESS_SHARED_WALL_MM;
  const hubDepth = Math.max(900, Math.ceil(circulation.minAreaMm2 / hubWidth));
  const sideWidth = envelope.width - hubWidth;
  const bathroomWidth = Math.max(
    minimumClearDimensionMm(bathroom.type, bathroom.accessible),
    Math.ceil(bathroom.minAreaMm2 / hubDepth),
    Math.ceil(hubDepth / (shapeAspectLimit(bathroom) ?? Number.POSITIVE_INFINITY)),
  );
  const foyerWidth = sideWidth - bathroomWidth;
  if (foyerWidth < minimumClearDimensionMm(foyer.type, foyer.accessible) || foyerWidth * hubDepth < foyer.minAreaMm2) {
    throw new Error("PARTI_COMPACT_MIDDLE_CAPACITY");
  }
  const northEntry = options.entranceSide === "north";
  const topRooms = northEntry ? [bedrooms[0], living] : bedrooms;
  const bottomRooms = northEntry ? [kitchen, bedrooms[1]] : [kitchen, living];
  const topDepth = Math.max(...topRooms.map((room, index) => {
    const width = index === 0 ? halfWidth : otherHalfWidth;
    return Math.max(
      minimumClearDimensionMm(room.type, room.accessible),
      Math.ceil(room.minAreaMm2 / width),
      Math.ceil(width / (shapeAspectLimit(room) ?? Number.POSITIVE_INFINITY)),
    );
  }));
  const bottomY = envelope.y + topDepth + hubDepth;
  const bottomDepth = envelope.y + envelope.depth - bottomY;
  if (bottomDepth <= 0 || bottomRooms.some((room, index) => {
    const width = index === 0 ? halfWidth : otherHalfWidth;
    const aspect = shapeAspectLimit(room);
    return width * bottomDepth < room.minAreaMm2
      || Math.min(width, bottomDepth) < minimumClearDimensionMm(room.type, room.accessible)
      || Boolean(aspect && Math.max(width, bottomDepth) / Math.min(width, bottomDepth) > aspect);
  })) throw new Error("PARTI_COMPACT_BOTTOM_CAPACITY");

  const eastEntry = options.entranceSide !== "west";
  const leftMiddle = eastEntry ? bathroom : foyer;
  const rightMiddle = eastEntry ? foyer : bathroom;
  const leftMiddleWidth = eastEntry ? bathroomWidth : foyerWidth;
  const rightMiddleWidth = envelope.width - hubWidth - leftMiddleWidth;
  const [leftBottom, rightBottom] = northEntry
    ? bottomRooms
    : eastEntry ? [kitchen, living] : [living, kitchen];
  const cells: CandidateRoom[] = [
    candidateRoom(topRooms[0], { x: envelope.x, y: envelope.y, width: halfWidth, depth: topDepth }),
    candidateRoom(topRooms[1], { x: envelope.x + halfWidth, y: envelope.y, width: otherHalfWidth, depth: topDepth }),
    candidateRoom(leftMiddle, { x: envelope.x, y: envelope.y + topDepth, width: leftMiddleWidth, depth: hubDepth }),
    candidateRoom(circulation, { x: envelope.x + leftMiddleWidth, y: envelope.y + topDepth, width: hubWidth, depth: hubDepth }),
    candidateRoom(rightMiddle, { x: envelope.x + leftMiddleWidth + hubWidth, y: envelope.y + topDepth, width: rightMiddleWidth, depth: hubDepth }),
    candidateRoom(leftBottom, { x: envelope.x, y: bottomY, width: halfWidth, depth: bottomDepth }),
    candidateRoom(rightBottom, { x: envelope.x + halfWidth, y: bottomY, width: otherHalfWidth, depth: bottomDepth }),
  ];
  return enforcePartiContract({
    floor: options.floor,
    cells,
    appliedReservedRegions: options.reservedRegions ?? [],
    accessSpineSpaceIds: [circulation.id, foyer.id, living.id],
  }, options);
}

function shapeAspectLimit(room: Pick<RoomRequirement, "type">) {
  if (["bedroom", "living", "dining", "kitchen", "study"].includes(room.type)) return 1.8;
  if (["bathroom", "utility", "foyer", "pooja", "store"].includes(room.type)) return 2.2;
  return undefined;
}

function minimumRoomDepth(room: RoomRequirement, width: number) {
  const aspect = shapeAspectLimit(room);
  return Math.max(
    MINIMUM_ACCESS_SHARED_WALL_MM,
    minimumClearDimensionMm(room.type, room.accessible),
    Math.ceil(room.minAreaMm2 / width),
    aspect ? Math.ceil(width / aspect) : 0,
  );
}

function pairWidthsForDepth(group: RoomGroup, totalWidth: number, depth: number) {
  if (group.kind !== "pair" || group.rooms.length !== 2) return undefined;
  const [left, right] = group.rooms;
  for (let leftWidth = minimumClearDimensionMm(left.type, left.accessible); leftWidth <= totalWidth - minimumClearDimensionMm(right.type, right.accessible); leftWidth += 50) {
    const rightWidth = totalWidth - leftWidth;
    const fits = [
      { room: left, width: leftWidth },
      { room: right, width: rightWidth },
    ].every(({ room, width }) => {
      const aspect = shapeAspectLimit(room);
      return width * depth >= room.minAreaMm2
        && (!aspect || Math.max(width, depth) / Math.min(width, depth) <= aspect);
    });
    if (fits) return [leftWidth, rightWidth] as const;
  }
  return undefined;
}

function minimumPairDepth(group: RoomGroup, width: number) {
  if (group.kind !== "pair") return undefined;
  for (let depth = MINIMUM_ACCESS_SHARED_WALL_MM; depth <= 8_000; depth += 50) {
    if (pairWidthsForDepth(group, width, depth)) return depth;
  }
  return undefined;
}

function minimumGroupDepth(group: RoomGroup, width: number) {
  const pairDepth = minimumPairDepth(group, width);
  if (pairDepth) return pairDepth;
  if (["social", "suite", "pair"].includes(group.kind)) {
    return group.rooms.reduce((sum, room) => sum + minimumRoomDepth(room, width), 0);
  }
  return minimumRoomDepth(group.rooms[0], width);
}

function groupRooms(options: CandidateGeneratorOptions): RoomGroup[] {
  const used = new Set<string>();
  const groups: RoomGroup[] = [];
  const byId = new Map(options.rooms.map((room) => [room.id, room]));
  const add = (rooms: RoomRequirement[], kind: RoomGroup["kind"]) => {
    const members = rooms.filter((room) => !used.has(room.id));
    if (members.length === 0) return;
    members.forEach((room) => used.add(room.id));
    groups.push({ rooms: members, kind, weight: members.reduce((sum, room) => sum + room.targetAreaMm2, 0) });
  };
  if (options.projectCourtVoid) {
    const court = options.rooms.find((room) => room.type === "courtyard");
    if (court) used.add(court.id);
  }

  const requiredNeighbors = new Map<string, Set<string>>();
  for (const [leftId, rightId] of options.requiredConnections ?? []) {
    if (!byId.has(leftId) || !byId.has(rightId)) continue;
    requiredNeighbors.set(leftId, new Set([...(requiredNeighbors.get(leftId) ?? []), rightId]));
    requiredNeighbors.set(rightId, new Set([...(requiredNeighbors.get(rightId) ?? []), leftId]));
  }
  const visitedRequired = new Set<string>();
  for (const startId of [...requiredNeighbors.keys()].sort()) {
    if (visitedRequired.has(startId)) continue;
    const queue = [startId];
    const component: RoomRequirement[] = [];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      if (visitedRequired.has(id)) continue;
      visitedRequired.add(id);
      const room = byId.get(id);
      if (room) component.push(room);
      for (const neighbor of [...(requiredNeighbors.get(id) ?? [])].sort()) {
        if (!visitedRequired.has(neighbor)) queue.push(neighbor);
      }
    }
    if (component.length < 2) continue;
    const types = new Set(component.map((room) => room.type));
    const kind: RoomGroup["kind"] = component.length === 2 && types.has("bedroom") && types.has("bathroom")
      ? "suite"
      : types.has("living") || types.has("dining") || types.has("foyer")
        ? "social"
        : "pair";
    add(component, kind);
  }
  const foyer = options.rooms.find((room) => room.type === "foyer" && !used.has(room.id));
  const living = options.rooms.find((room) => room.type === "living" && !used.has(room.id));
  const dining = options.rooms.find((room) => room.type === "dining" && !used.has(room.id));
  if (living) add([...(foyer ? [foyer] : []), living, ...(dining ? [dining] : [])], "social");
  const kitchen = options.rooms.find((room) => room.type === "kitchen" && !used.has(room.id));
  const utility = options.rooms.find((room) => room.type === "utility" && !used.has(room.id));
  if (kitchen && utility) add([kitchen, utility], "pair");

  for (const room of [...options.rooms]
    .filter((candidate) => !used.has(candidate.id) && candidate.type !== "circulation")
    .sort((left, right) => {
      const terminal = (candidate: RoomRequirement) => Number(candidate.type === "parking" || candidate.type === "balcony" || candidate.type === "terrace");
      return terminal(left) - terminal(right) || right.targetAreaMm2 - left.targetAreaMm2 || left.id.localeCompare(right.id);
    })) add([room], "single");
  return groups;
}

function proportionalLengths(groups: RoomGroup[], total: number, minimum = MINIMUM_ACCESS_SHARED_WALL_MM) {
  if (groups.length === 0) return [];
  const minimums = groups.map((group) => Math.max(
    minimum,
    ...group.rooms.map((room) => Math.min(minimumClearDimensionMm(room.type, room.accessible), 2_700)),
  ));
  const minimumTotal = minimums.reduce((sum, value) => sum + value, 0);
  if (minimumTotal > total) throw new Error("PARTI_WING_CAPACITY");
  const weightTotal = groups.reduce((sum, group) => sum + group.weight, 0);
  let remaining = total;
  return groups.map((group, index) => {
    if (index === groups.length - 1) return remaining;
    const laterMinimum = minimums.slice(index + 1).reduce((sum, value) => sum + value, 0);
    const proportional = Math.round(total * group.weight / Math.max(1, weightTotal));
    const length = Math.max(minimums[index], Math.min(remaining - laterMinimum, proportional));
    remaining -= length;
    return length;
  });
}

function syntheticCirculation(source: RoomRequirement, id: string, name: string, bounds: Rectangle): CandidateRoom {
  return {
    ...candidateRoom(source, bounds),
    id,
    name,
    type: "circulation",
    minAreaMm2: bounds.width * bounds.depth,
    targetAreaMm2: bounds.width * bounds.depth,
    occupied: true,
  };
}

function splitGroup(group: RoomGroup, bounds: Rectangle, accessSide: WingSide): CandidateRoom[] {
  if (group.rooms.length === 1) return [candidateRoom(group.rooms[0], bounds)];
  const pairWidths = pairWidthsForDepth(group, bounds.width, bounds.depth);
  if (pairWidths) {
    const firstX = accessSide === "left" ? bounds.x + pairWidths[1] : bounds.x;
    const secondX = accessSide === "left" ? bounds.x : bounds.x + pairWidths[0];
    const first = candidateRoom(group.rooms[0], { x: firstX, y: bounds.y, width: pairWidths[0], depth: bounds.depth });
    const second = candidateRoom(group.rooms[1], {
      x: secondX,
      y: bounds.y,
      width: pairWidths[1],
      depth: bounds.depth,
    });
    return [first, second];
  }
  if (group.kind === "social" || group.kind === "suite" || group.kind === "pair") {
    const minimums = group.rooms.map((room) => minimumRoomDepth(room, bounds.width));
    const minimumTotal = minimums.reduce((sum, value) => sum + value, 0);
    if (minimumTotal > bounds.depth) throw new Error("PARTI_SOCIAL_CLUSTER_CAPACITY");
    const extra = bounds.depth - minimumTotal;
    const weightTotal = group.rooms.reduce((sum, room) => sum + room.targetAreaMm2, 0);
    let y = bounds.y;
    return group.rooms.map((room, index) => {
      const depth = index === group.rooms.length - 1
        ? bounds.y + bounds.depth - y
        : minimums[index] + Math.floor(extra * room.targetAreaMm2 / Math.max(1, weightTotal));
      const cell = candidateRoom(room, { x: bounds.x, y, width: bounds.width, depth });
      y += depth;
      return cell;
    });
  }
  throw new Error(`PARTI_GROUP_KIND_UNSUPPORTED:${group.kind}:${accessSide}`);
}

function tileWing(
  groups: RoomGroup[],
  bounds: Rectangle,
  accessSide: WingSide,
  surplusKind: "terrace" | "verandah" = "terrace",
): CandidateRoom[] {
  if (groups.length === 0) throw new Error("PARTI_EMPTY_WING");
  if (groups.length === 1 && groups[0].rooms.length === 1) {
    const room = groups[0].rooms[0];
    const maximum = shapeAspectLimit(room);
    if (maximum && bounds.depth > bounds.width * maximum) {
      const roomDepth = Math.max(
        minimumClearDimensionMm(room.type, room.accessible),
        Math.ceil(room.minAreaMm2 / bounds.width),
        Math.ceil(bounds.width / maximum),
        Math.min(Math.ceil(room.targetAreaMm2 / bounds.width), Math.floor(bounds.width * maximum)),
      );
      const surplusBounds = { ...bounds, y: bounds.y + roomDepth, depth: bounds.depth - roomDepth };
      return [
        candidateRoom(room, { ...bounds, depth: roomDepth }),
        {
          ...candidateRoom(room, surplusBounds),
          id: `${room.floorId}-parti-setback-${accessSide}`,
          name: surplusKind === "terrace"
            ? Math.min(surplusBounds.width, surplusBounds.depth) <= 2_400 && surplusBounds.width * surplusBounds.depth <= 13_000_000
              ? "Sectioned setback terrace"
              : "Open terrace / unbuilt"
            : "Covered compact verandah",
          type: surplusKind,
          minAreaMm2: surplusBounds.width * surplusBounds.depth,
          targetAreaMm2: surplusBounds.width * surplusBounds.depth,
          occupied: false,
        },
      ];
    }
  }
  const minimums = groups.map((group) => minimumGroupDepth(group, bounds.width));
  const minimumTotal = minimums.reduce((sum, value) => sum + value, 0);
  if (minimumTotal > bounds.depth) throw new Error(
    `PARTI_WING_CAPACITY:${bounds.width}x${bounds.depth}:minimum=${minimumTotal}:groups=${groups.map((group) => group.rooms.map((room) => room.id).join("+")).join(",")}`,
  );
  const extra = bounds.depth - minimumTotal;
  const weightTotal = groups.reduce((sum, group) => sum + group.weight, 0);
  let remaining = bounds.depth;
  const depths = groups.map((group, index) => {
    if (index === groups.length - 1) return remaining;
    const laterMinimum = minimums.slice(index + 1).reduce((sum, value) => sum + value, 0);
    const depth = Math.max(minimums[index], Math.min(
      remaining - laterMinimum,
      minimums[index] + Math.floor(extra * group.weight / Math.max(1, weightTotal)),
    ));
    remaining -= depth;
    return depth;
  });
  let y = bounds.y;
  return groups.flatMap((group, index) => {
    const groupBounds = { x: bounds.x, y, width: bounds.width, depth: depths[index] };
    y += depths[index];
    return splitGroup(group, groupBounds, accessSide);
  });
}

/**
 * Sparse upper floors can turn most surplus into open terrace, which shrinks the constructed
 * denominator beneath an otherwise compact lobby. Transfer only the required strip of an
 * adjacent parti setback back into its room, staying within that room type's hard aspect cap.
 */
function meetCirculationBudget(cells: CandidateRoom[]) {
  const chargeable = (cell: CandidateRoom) => !["stair", "courtyard", "terrace", "verandah"].includes(cell.type);
  const circulationArea = cells
    .filter((cell) => cell.type === "circulation")
    .reduce((sum, cell) => sum + cell.bounds.width * cell.bounds.depth, 0);
  const otherConstructedArea = cells
    .filter((cell) => chargeable(cell) && cell.type !== "circulation")
    .reduce((sum, cell) => sum + cell.bounds.width * cell.bounds.depth, 0);
  let deficit = Math.max(0, Math.ceil(circulationArea / 0.15 - circulationArea - otherConstructedArea));
  if (deficit === 0) return cells;

  const adjusted = cells.map((cell) => ({ ...cell, bounds: { ...cell.bounds } }));
  for (const surplus of adjusted
    .filter((cell) => ["terrace", "verandah"].includes(cell.type) && cell.id.includes("parti-setback"))
    .sort((left, right) => right.bounds.width * right.bounds.depth - left.bounds.width * left.bounds.depth || left.id.localeCompare(right.id))) {
    const room = adjusted.find((cell) => (
      chargeable(cell)
      && cell.type !== "circulation"
      && cell.bounds.x === surplus.bounds.x
      && cell.bounds.width === surplus.bounds.width
      && cell.bounds.y + cell.bounds.depth === surplus.bounds.y
    ));
    const aspectLimit = room ? shapeAspectLimit(room) : undefined;
    if (!room || !aspectLimit) continue;
    const availableDepth = Math.min(
      surplus.bounds.depth,
      Math.max(0, Math.floor(room.bounds.width * aspectLimit) - room.bounds.depth),
    );
    const transferDepth = Math.min(availableDepth, Math.ceil(deficit / room.bounds.width));
    if (transferDepth <= 0) continue;
    room.bounds.depth += transferDepth;
    surplus.bounds.y += transferDepth;
    surplus.bounds.depth -= transferDepth;
    deficit -= transferDepth * room.bounds.width;
    if (deficit <= 0) break;
  }
  // A rounding-sized remainder can be absorbed by the normalized balcony while keeping it
  // inside the shared splitter's +2m² target tolerance.
  for (const terrace of adjusted
    .filter((cell) => cell.type === "terrace" && cell.id.endsWith("-open-terrace"))
    .sort((left, right) => left.id.localeCompare(right.id))) {
    if (deficit <= 0) break;
    const balcony = adjusted.find((cell) => cell.type === "balcony" && terrace.id === `${cell.id}-open-terrace`);
    if (!balcony) continue;
    const availableArea = Math.max(0, balcony.targetAreaMm2 + 2_000_000 - balcony.bounds.width * balcony.bounds.depth);
    if (availableArea <= 0) continue;
    if (terrace.bounds.x === balcony.bounds.x && terrace.bounds.width === balcony.bounds.width) {
      const transferDepth = Math.min(terrace.bounds.depth, Math.ceil(Math.min(deficit, availableArea) / balcony.bounds.width));
      if (terrace.bounds.y < balcony.bounds.y) {
        balcony.bounds.y -= transferDepth;
        terrace.bounds.depth -= transferDepth;
      } else {
        terrace.bounds.y += transferDepth;
        terrace.bounds.depth -= transferDepth;
      }
      balcony.bounds.depth += transferDepth;
      deficit -= transferDepth * balcony.bounds.width;
    } else if (terrace.bounds.y === balcony.bounds.y && terrace.bounds.depth === balcony.bounds.depth) {
      const transferWidth = Math.min(terrace.bounds.width, Math.ceil(Math.min(deficit, availableArea) / balcony.bounds.depth));
      if (terrace.bounds.x < balcony.bounds.x) {
        balcony.bounds.x -= transferWidth;
        terrace.bounds.width -= transferWidth;
      } else {
        terrace.bounds.x += transferWidth;
        terrace.bounds.width -= transferWidth;
      }
      balcony.bounds.width += transferWidth;
      deficit -= transferWidth * balcony.bounds.depth;
    }
  }
  // Floating arithmetic around the 15% boundary may leave a sub-grid residual even though all
  // rectangles are integral millimetres. The validator applies the same 100mm² numeric guard.
  if (deficit > 100) throw new Error(`PARTI_CIRCULATION_BUDGET:${deficit}`);
  return adjusted.filter((cell) => cell.bounds.width > 0 && cell.bounds.depth > 0);
}

function tileTop(groups: RoomGroup[], bounds: Rectangle): CandidateRoom[] {
  if (groups.length === 0) return [];
  const rotated = groups.map((group) => ({ ...group }));
  const roomMinimumWidth = (room: RoomRequirement) => Math.max(
    MINIMUM_ACCESS_SHARED_WALL_MM,
    minimumClearDimensionMm(room.type, room.accessible),
    Math.ceil(room.minAreaMm2 / bounds.depth),
    shapeAspectLimit(room) ? Math.ceil(bounds.depth / (shapeAspectLimit(room) as number)) : 0,
  );
  const groupMinimums = rotated.map((group) => group.rooms.reduce((sum, room) => sum + roomMinimumWidth(room), 0));
  const minimumTotal = groupMinimums.reduce((sum, value) => sum + value, 0);
  if (minimumTotal > bounds.width) throw new Error("PARTI_TOP_CAPACITY");
  const groupExtra = bounds.width - minimumTotal;
  const groupWeight = rotated.reduce((sum, group) => sum + group.weight, 0);
  let remainingGroupWidth = bounds.width;
  const groupWidths = rotated.map((group, index) => {
    if (index === rotated.length - 1) return remainingGroupWidth;
    const laterMinimum = groupMinimums.slice(index + 1).reduce((sum, value) => sum + value, 0);
    const width = Math.max(groupMinimums[index], Math.min(
      remainingGroupWidth - laterMinimum,
      groupMinimums[index] + Math.floor(groupExtra * group.weight / Math.max(1, groupWeight)),
    ));
    remainingGroupWidth -= width;
    return width;
  });
  let x = bounds.x;
  return rotated.flatMap((group, index) => {
    const groupBounds = { x, y: bounds.y, width: groupWidths[index], depth: bounds.depth };
    x += groupWidths[index];
    // Every member is split across the width so each keeps direct contact with the main gallery
    // on the zone's south edge. Suite members also share the full zone depth with each other.
    if (group.rooms.length === 1) return [candidateRoom(group.rooms[0], groupBounds)];
    const roomMinimums = group.rooms.map(roomMinimumWidth);
    const roomMinimumTotal = roomMinimums.reduce((sum, value) => sum + value, 0);
    const roomExtra = groupBounds.width - roomMinimumTotal;
    const roomWeight = group.rooms.reduce((sum, room) => sum + room.targetAreaMm2, 0);
    let remainingRoomWidth = groupBounds.width;
    const roomWidths = group.rooms.map((room, roomIndex) => {
      if (roomIndex === group.rooms.length - 1) return remainingRoomWidth;
      const laterMinimum = roomMinimums.slice(roomIndex + 1).reduce((sum, value) => sum + value, 0);
      const width = Math.max(roomMinimums[roomIndex], Math.min(
        remainingRoomWidth - laterMinimum,
        roomMinimums[roomIndex] + Math.floor(roomExtra * room.targetAreaMm2 / Math.max(1, roomWeight)),
      ));
      remainingRoomWidth -= width;
      return width;
    });
    let roomX = groupBounds.x;
    return group.rooms.map((room, roomIndex) => {
      const cell = candidateRoom(room, { x: roomX, y: groupBounds.y, width: roomWidths[roomIndex], depth: groupBounds.depth });
      roomX += roomWidths[roomIndex];
      return cell;
    });
  });
}

function chooseTopGroups(
  groups: RoomGroup[],
  topBounds: Rectangle,
  leftWingWidth: number,
  rightWingWidth: number,
  leftWingDepth: number,
  rightWingDepth: number,
  parkingSide?: WingSide,
) {
  if (topBounds.width < 1_200 || topBounds.depth < 1_200 || groups.length < 3) return { top: [] as RoomGroup[], remaining: groups };
  const minimumRoomWidth = (room: RoomRequirement) => Math.max(
    MINIMUM_ACCESS_SHARED_WALL_MM,
    minimumClearDimensionMm(room.type, room.accessible),
    Math.ceil(room.minAreaMm2 / topBounds.depth),
    shapeAspectLimit(room) ? Math.ceil(topBounds.depth / (shapeAspectLimit(room) as number)) : 0,
  );
  const minimumGroupWidth = (group: RoomGroup) => group.rooms.reduce((sum, room) => sum + minimumRoomWidth(room), 0);
  let selected: { top: RoomGroup[]; score: number; width: number } | undefined;
  for (let mask = 1; mask < 2 ** groups.length; mask += 1) {
    const top = groups.filter((group, index) => Boolean(mask & (1 << index)));
    if (top.some((group) => group.rooms.some((room) => room.type === "parking"))) continue;
    const width = top.reduce((sum, group) => sum + minimumGroupWidth(group), 0);
    if (width > topBounds.width) continue;
    const remaining = groups.filter((group) => !top.includes(group));
    if (!hasFeasibleWingBalance(remaining, leftWingWidth, rightWingWidth, leftWingDepth, rightWingDepth, parkingSide)) continue;
    const score = top.reduce((sum, group) => sum + minimumGroupDepth(group, Math.min(leftWingWidth, rightWingWidth)), 0);
    if (!selected || score > selected.score || (score === selected.score && width > selected.width)) selected = { top, score, width };
  }
  if (!selected) throw new Error(`PARTI_TOP_FEASIBILITY:${topBounds.width}x${topBounds.depth}:${groups.map((group) => `${group.rooms.map((room) => room.id).join("+")}=${minimumGroupWidth(group)}`).join(",")}`);
  const top = selected.top;
  return { top, remaining: groups.filter((group) => !top.includes(group)) };
}

function hasFeasibleWingBalance(
  groups: RoomGroup[],
  leftWidth: number,
  rightWidth: number,
  leftDepth: number,
  rightDepth: number,
  parkingSide?: WingSide,
) {
  for (let mask = 0; mask < 2 ** groups.length; mask += 1) {
    const left: RoomGroup[] = [];
    const right: RoomGroup[] = [];
    let allowed = true;
    for (const [index, group] of groups.entries()) {
      const goesRight = Boolean(mask & (1 << index));
      if (parkingSide && group.rooms.some((room) => room.type === "parking") && goesRight !== (parkingSide === "right")) {
        allowed = false;
        break;
      }
      (goesRight ? right : left).push(group);
    }
    if (!allowed) continue;
    const leftMinimum = left.reduce((sum, group) => sum + minimumGroupDepth(group, leftWidth), 0);
    const rightMinimum = right.reduce((sum, group) => sum + minimumGroupDepth(group, rightWidth), 0);
    if (leftMinimum <= leftDepth && rightMinimum <= rightDepth) return true;
  }
  return false;
}

function balanceWings(
  groups: RoomGroup[],
  leftWidth: number,
  rightWidth: number,
  leftDepth: number,
  rightDepth: number,
  parkingSide?: WingSide,
) {
  let selected: { left: RoomGroup[]; right: RoomGroup[]; score: number } | undefined;
  for (let mask = 0; mask < 2 ** groups.length; mask += 1) {
    const left: RoomGroup[] = [];
    const right: RoomGroup[] = [];
    let allowed = true;
    for (const [index, group] of groups.entries()) {
      const goesRight = Boolean(mask & (1 << index));
      if (parkingSide && group.rooms.some((room) => room.type === "parking") && goesRight !== (parkingSide === "right")) {
        allowed = false;
        break;
      }
      (goesRight ? right : left).push(group);
    }
    if (!allowed) continue;
    const leftMinimum = left.reduce((sum, group) => sum + minimumGroupDepth(group, leftWidth), 0);
    const rightMinimum = right.reduce((sum, group) => sum + minimumGroupDepth(group, rightWidth), 0);
    if (leftMinimum > leftDepth || rightMinimum > rightDepth) continue;
    const leftWeight = left.reduce((sum, group) => sum + group.weight, 0);
    const rightWeight = right.reduce((sum, group) => sum + group.weight, 0);
    const densityDelta = Math.abs(
      leftWeight / Math.max(1, leftWidth * leftDepth) - rightWeight / Math.max(1, rightWidth * rightDepth),
    );
    const emptyPenalty = Number(left.length === 0 || right.length === 0);
    const score = emptyPenalty * 100 + densityDelta;
    if (!selected || score < selected.score) selected = { left, right, score };
  }
  if (!selected) throw new Error(
    `PARTI_WING_ASSIGNMENT_IMPOSSIBLE:${leftWidth}x${leftDepth}|${rightWidth}x${rightDepth}:${groups.map((group) => `${group.rooms.map((room) => room.id).join("+")}=${minimumGroupDepth(group, Math.min(leftWidth, rightWidth))}`).join(",")}`,
  );
  const { left, right } = selected;
  const terminalLast = (items: RoomGroup[]) => items.sort((leftGroup, rightGroup) => {
    const terminal = (group: RoomGroup) => Number(group.rooms.some((room) => room.type === "parking" || room.type === "balcony" || room.type === "terrace"));
    return terminal(leftGroup) - terminal(rightGroup);
  });
  terminalLast(left);
  terminalLast(right);
  return { left, right };
}

/**
 * Deterministic T-hub composition. Every destination group touches the short gallery by
 * construction; service leaves may sit behind their bedroom/kitchen and share >=1m of wall.
 */
function generateAlignedPartiCandidate(options: PartiCandidateGeneratorOptions): FloorCandidate {
  if (options.envelope.width < 7_000) return generateNarrowCompactCandidate(options);
  const programmedCirculation = options.rooms.find((room) => room.type === "circulation");
  const circulation = programmedCirculation
    ?? options.rooms.find((room) => room.type === "foyer")
    ?? options.rooms.find((room) => room.type === "living")
    ?? options.rooms[0];
  if (!circulation) throw new Error("PARTI_REQUIRES_ROOM_PROGRAM");
  const circulationId = programmedCirculation?.id ?? `${options.floor.id}-circulation`;
  if ((options.reservedRegions ?? []).some((region) => region.kind === "setback")) throw new Error("PARTI_RESERVED_SETBACK_UNSUPPORTED");

  const envelope = options.envelope;
  const partiId = options.partiId ?? "t_hub";
  const accessibleFloor = options.rooms.some((room) => room.accessible);
  const accessBranchBaseline = accessibleFloor || options.projectCourtVoid || options.rooms.filter((room) => room.type !== "circulation").length >= 6
    ? MINIMUM_ACCESS_SHARED_WALL_MM
    : 900;
  const baseBranchWidth = options.floor.level === 0 && !options.projectCourtVoid
    ? Math.max(accessBranchBaseline, MAIN_ENTRY_CLEAR_WIDTH_MM)
    : accessBranchBaseline;
  const galleryRunCap = Math.floor((options.quarterTurned ? envelope.width : envelope.depth) * 0.4);
  const branchWidth = options.quarterTurned
    ? Math.max(baseBranchWidth, envelope.width - 2 * galleryRunCap)
    : baseBranchWidth;
  const branchAlignment = options.quarterTurned
    ? 0.5
    : partiId === "l_court" ? 0.44 : partiId === "verandah_bungalow" ? 0.48 : 0.5;
  const branchX = envelope.x + Math.floor((envelope.width - branchWidth) * branchAlignment);
  const leftWidth = branchX - envelope.x;
  const rightX = branchX + branchWidth;
  const rightWidth = envelope.x + envelope.width - rightX;
  if (Math.min(leftWidth, rightWidth) < 2_700) throw new Error("PARTI_ENVELOPE_TOO_NARROW");
  const galleryDepth = Math.max(
    accessibleFloor ? MINIMUM_ACCESS_SHARED_WALL_MM : 900,
    programmedCirculation ? Math.ceil(programmedCirculation.minAreaMm2 / leftWidth) : 0,
  );
  if (galleryDepth > galleryRunCap) {
    throw new Error(`PARTI_CIRCULATION_GALLERY_EXCEEDS_CAP:${galleryDepth}:${galleryRunCap}`);
  }
  const noStairTopDepthRatio = options.rooms.length <= 6 ? 0.2 : 0.1836;
  const mainY = options.stairCore
    ? options.stairCore.bounds.y + options.stairCore.bounds.depth
    : envelope.y + Math.max(2_700, Math.min(Math.round(envelope.depth * noStairTopDepthRatio), Math.round(envelope.depth * 0.4) - galleryDepth));
  const southY = mainY + galleryDepth;
  const southDepth = envelope.y + envelope.depth - southY;
  if (southDepth < 3_000) throw new Error("PARTI_ENVELOPE_TOO_SHALLOW");
  const mainLeft = { x: envelope.x, y: mainY, width: leftWidth, depth: galleryDepth };
  const mainCenter = { x: branchX, y: mainY, width: branchWidth, depth: galleryDepth };
  // The open entry recess keeps the compact internal gallery below its 15% hard cap, including
  // sparse upper court floors whose balcony remainder becomes open-to-sky terrace.
  const minimumGalleryRun = accessibleFloor
    ? MINIMUM_ACCESS_SHARED_WALL_MM
    : 900;
  const entryNotchWidth = rightWidth >= 3_500
    ? partiId === "compact"
      ? 0
      : partiId === "verandah_bungalow"
        ? rightWidth
        : options.projectCourtVoid ? rightWidth : rightWidth - minimumGalleryRun
    : 0;
  const entryNotchDepth = entryNotchWidth > 0 && options.floor.level === 0 && !options.projectCourtVoid
    ? Math.max(galleryDepth, MAIN_ENTRY_CLEAR_WIDTH_MM)
    : galleryDepth;
  const entryNotchExtension = entryNotchDepth - galleryDepth;
  const mainRight = {
    x: rightX,
    y: mainY,
    width: rightWidth - entryNotchWidth,
    depth: entryNotchDepth,
  };
  const entryNotch = { x: rightX + mainRight.width, y: mainY, width: entryNotchWidth, depth: entryNotchDepth };
  const maximumBranchDepth = Math.floor(envelope.depth * 0.4);
  // A programmed ground court is projected as the same open-to-sky wing recess on every upper floor.
  // The separate covered verandah remains the access continuation, so the void is never used as
  // a pedestrian relay. A fixed baseline keeps the projection deterministic across independently
  // generated floors; larger custom courts require reserved-region sequencing by the orchestrator.
  const programmedCourt = options.rooms.find((room) => room.type === "courtyard");
  const reservedCourt = options.reservedRegions?.find((region) => region.kind === "court_void");
  const projectsCourt = Boolean(options.projectCourtVoid || reservedCourt || partiId === "l_court" || partiId === "courtyard");
  const singleRoadEdge = options.roadEdges?.length === 1 ? options.roadEdges[0] : undefined;
  const courtSide: WingSide = reservedCourt
    ? reservedCourt.bounds.x === envelope.x ? "left" : "right"
    : options.roadEdges?.includes("east") && !options.roadEdges.includes("west") ? "left" : "right";
  const courtWidth = courtSide === "left" ? leftWidth : rightWidth;
  const requestedCourtArea = options.simplifiedCourt
    ? programmedCourt?.minAreaMm2
    : programmedCourt?.targetAreaMm2;
  const courtDepth = reservedCourt?.bounds.depth ?? (projectsCourt
    ? Math.max(900, Math.ceil(Math.max(COORDINATED_COURT_MIN_AREA_MM2, requestedCourtArea ?? 0) / courtWidth))
    : 0);
  if (programmedCourt && programmedCourt.minAreaMm2 > courtWidth * courtDepth) {
    throw new Error(`PARTI_COURT_REQUIRES_RESERVED_REGION:${programmedCourt.minAreaMm2}`);
  }
  const defaultCourt = {
    x: courtSide === "left" ? envelope.x : rightX,
    y: envelope.y + envelope.depth - courtDepth,
    width: courtWidth,
    depth: courtDepth,
  };
  const coordinatedCourt = reservedCourt?.bounds ?? defaultCourt;
  if (projectsCourt && (
    coordinatedCourt.width !== courtWidth
    || coordinatedCourt.x !== (courtSide === "left" ? envelope.x : rightX)
    || coordinatedCourt.y + coordinatedCourt.depth !== envelope.y + envelope.depth
  )) throw new Error("PARTI_RESERVED_COURT_MISALIGNED");
  const leftWingDepth = projectsCourt && courtSide === "left" ? coordinatedCourt.y - southY : southDepth;
  const rightWingDepth = projectsCourt && courtSide === "right"
    ? coordinatedCourt.y - (southY + entryNotchExtension)
    : southDepth - entryNotchExtension;
  if (Math.min(leftWingDepth, rightWingDepth) < 3_000) throw new Error("PARTI_COURT_REDUCES_WING_CAPACITY");
  const branchDepth = Math.min(southDepth, maximumBranchDepth);
  const branch = { x: branchX, y: southY, width: branchWidth, depth: branchDepth };
  const coveredGallery = {
    x: branchX,
    y: southY + branchDepth,
    width: branchWidth,
    depth: southDepth - branchDepth,
  };
  const cells: CandidateRoom[] = [
    ...(options.stairCore ? [options.stairCore] : []),
    syntheticCirculation(circulation, circulationId, "Stair lobby gallery", mainLeft),
    syntheticCirculation(circulation, `${circulationId}-hub`, "Villa junction hub", mainCenter),
    ...(mainRight.width > 0 ? [syntheticCirculation(circulation, `${circulationId}-gallery`, "Short gallery", mainRight)] : []),
    ...(entryNotch.width > 0 ? [{
      ...candidateRoom(circulation, entryNotch),
      id: `${options.floor.id}-entry-verandah`,
      name: "Entry verandah recess",
      type: "verandah" as const,
      minAreaMm2: entryNotch.width * entryNotch.depth,
      targetAreaMm2: entryNotch.width * entryNotch.depth,
      occupied: false,
      perimeterOpen: options.floor.level === 0,
    }] : []),
    {
      ...syntheticCirculation(circulation, `${circulationId}-branch`, "Open-sided private wing gallery", branch),
      type: "verandah" as const,
      occupied: false,
      perimeterOpen: options.floor.level === 0,
    },
    ...(coveredGallery.depth > 0 ? [{
      ...candidateRoom(circulation, coveredGallery),
      id: `${options.floor.id}-covered-gallery`,
      name: "Open-sided covered gallery",
      type: "verandah" as const,
      minAreaMm2: coveredGallery.width * coveredGallery.depth,
      targetAreaMm2: coveredGallery.width * coveredGallery.depth,
      occupied: false,
      perimeterOpen: options.floor.level === 0,
    }] : []),
    ...(projectsCourt ? [{
      ...candidateRoom(programmedCourt ?? circulation, coordinatedCourt),
      id: programmedCourt?.id ?? `${options.floor.id}-court-void`,
      name: programmedCourt?.name ?? "Coordinated court void",
      type: "courtyard" as const,
      minAreaMm2: programmedCourt?.minAreaMm2 ?? COORDINATED_COURT_MIN_AREA_MM2,
      targetAreaMm2: programmedCourt?.targetAreaMm2 ?? COORDINATED_COURT_MIN_AREA_MM2,
      occupied: Boolean(programmedCourt),
    }] : []),
  ];
  const topBounds: Rectangle = options.stairCore
    ? {
        x: options.stairCore.bounds.x + options.stairCore.bounds.width,
        y: envelope.y,
        width: envelope.x + envelope.width - options.stairCore.bounds.x - options.stairCore.bounds.width,
        depth: mainY - envelope.y,
      }
    : { x: envelope.x, y: envelope.y, width: envelope.width, depth: mainY - envelope.y };
  const grouped = groupRooms(options);
  const parkingSide = singleRoadEdge === "east"
    ? "right"
    : singleRoadEdge === "west"
      ? "left"
      : projectsCourt
        ? courtSide === "left" ? "right" : "left"
        : undefined;
  const { top, remaining } = chooseTopGroups(
    grouped,
    topBounds,
    leftWidth,
    rightWidth,
    leftWingDepth,
    rightWingDepth,
    parkingSide,
  );
  cells.push(...tileTop(top, topBounds));

  // If the stair occupies the north-west corner, the north-east top zone is exact. Without a
  // stair the whole top is tiled. Any impossible top allocation is rejected rather than gapped.
  if (top.length === 0 && topBounds.width * topBounds.depth > 0) {
    const smallest = [...remaining].sort((a, b) => a.weight - b.weight)[0];
    if (!smallest) throw new Error("PARTI_TOP_ZONE_EMPTY");
    cells.push(...tileTop([smallest], topBounds));
    remaining.splice(remaining.indexOf(smallest), 1);
  }

  const { left, right } = balanceWings(
    remaining,
    leftWidth,
    rightWidth,
    leftWingDepth,
    rightWingDepth,
    parkingSide,
  );
  const surplusKind = options.formStrategy !== "compact" && options.allowOpenSetback ? "terrace" : "verandah";
  const addWing = (groups: RoomGroup[], bounds: Rectangle, side: WingSide) => {
    if (groups.length > 0) {
      cells.push(...tileWing(groups, bounds, side, surplusKind));
      return;
    }
    cells.push({
      ...candidateRoom(circulation, bounds),
      id: `${options.floor.id}-parti-open-wing-${side}`,
      name: surplusKind === "terrace" ? "Open court / setback wing" : "Covered compact verandah wing",
      type: surplusKind,
      minAreaMm2: bounds.width * bounds.depth,
      targetAreaMm2: bounds.width * bounds.depth,
      occupied: false,
    });
  };
  addWing(left, { x: envelope.x, y: southY, width: leftWidth, depth: leftWingDepth }, "left");
  addWing(right, { x: rightX, y: southY + entryNotchExtension, width: rightWidth, depth: rightWingDepth }, "right");

  const finalCells = meetCirculationBudget(splitOversizedBalconies(cells, options.envelope));
  const result = {
    floor: options.floor,
    cells: finalCells,
    appliedReservedRegions: options.reservedRegions ?? [],
    accessSpineSpaceIds: finalCells
      .filter((cell) => cell.type === "circulation" || cell.type === "stair" || cell.type === "verandah")
      .map((cell) => cell.id),
  };
  return enforcePartiContract(result, options);
}

type Direction = NonNullable<CandidateGeneratorOptions["entranceSide"]>;

const WORLD_TO_QUARTER_TURN_DIRECTION: Readonly<Record<Direction, Direction>> = Object.freeze({
  north: "east",
  east: "south",
  south: "west",
  west: "north",
});

function worldToQuarterTurnedBounds(bounds: Rectangle, worldEnvelope: Rectangle): Rectangle {
  return {
    x: worldEnvelope.x + worldEnvelope.depth - (bounds.y - worldEnvelope.y) - bounds.depth,
    y: worldEnvelope.y + bounds.x - worldEnvelope.x,
    width: bounds.depth,
    depth: bounds.width,
  };
}

function quarterTurnedToWorldBounds(bounds: Rectangle, worldEnvelope: Rectangle): Rectangle {
  return {
    x: worldEnvelope.x + bounds.y - worldEnvelope.y,
    y: worldEnvelope.y + worldEnvelope.depth - (bounds.x - worldEnvelope.x) - bounds.width,
    width: bounds.depth,
    depth: bounds.width,
  };
}

/** Mirror the proven south/east compositions for their opposite road orientations. */
function generateOrientedPartiCandidate(options: PartiCandidateGeneratorOptions): FloorCandidate {
  if (!options.quarterTurned && shouldQuarterTurnParti(options.envelope)) {
    const worldEnvelope = options.envelope;
    const localEnvelope = {
      x: worldEnvelope.x,
      y: worldEnvelope.y,
      width: worldEnvelope.depth,
      depth: worldEnvelope.width,
    };
    const localCandidate = generateOrientedPartiCandidate({
      ...options,
      envelope: localEnvelope,
      stairCore: options.stairCore
        ? { ...options.stairCore, bounds: worldToQuarterTurnedBounds(options.stairCore.bounds, worldEnvelope) }
        : undefined,
      reservedRegions: options.reservedRegions?.map((region) => ({
        ...region,
        bounds: worldToQuarterTurnedBounds(region.bounds, worldEnvelope),
      })),
      entranceSide: options.entranceSide ? WORLD_TO_QUARTER_TURN_DIRECTION[options.entranceSide] : undefined,
      roadEdges: options.roadEdges?.map((side) => WORLD_TO_QUARTER_TURN_DIRECTION[side]),
      quarterTurned: true,
    });
    return {
      ...localCandidate,
      cells: localCandidate.cells.map((cell) => ({
        ...cell,
        bounds: quarterTurnedToWorldBounds(cell.bounds, worldEnvelope),
      })),
      appliedReservedRegions: localCandidate.appliedReservedRegions?.map((region) => ({
        ...region,
        bounds: quarterTurnedToWorldBounds(region.bounds, worldEnvelope),
      })) ?? [],
    };
  }

  if (!options.entranceSide || !["north", "west"].includes(options.entranceSide) || options.envelope.width < 7_000) {
    return generateAlignedPartiCandidate(options);
  }

  const northRoad = options.entranceSide === "north";
  const mirror = (bounds: Rectangle): Rectangle => northRoad ? ({
      ...bounds,
      y: options.envelope.y + options.envelope.depth - (bounds.y - options.envelope.y) - bounds.depth,
    }) : ({
      ...bounds,
      x: options.envelope.x + options.envelope.width - (bounds.x - options.envelope.x) - bounds.width,
    });
  const mirroredSource = generateAlignedPartiCandidate({
    ...options,
    entranceSide: northRoad ? "south" : "east",
    stairCore: options.stairCore
      ? { ...options.stairCore, bounds: mirror(options.stairCore.bounds) }
      : undefined,
    reservedRegions: options.reservedRegions?.map((region) => ({
      ...region,
      bounds: mirror(region.bounds),
    })),
    roadEdges: options.roadEdges?.map((side) => northRoad
      ? side === "north" ? "south" : side === "south" ? "north" : side
      : side === "west" ? "east" : side === "east" ? "west" : side),
  });
  return {
    ...mirroredSource,
    floor: options.floor,
    cells: mirroredSource.cells.map((cell) => ({ ...cell, bounds: mirror(cell.bounds) })),
    appliedReservedRegions: mirroredSource.appliedReservedRegions?.map((region) => ({ ...region, bounds: mirror(region.bounds) })) ?? [],
  };
}

export function generatePartiCandidate(options: CandidateGeneratorOptions): FloorCandidate {
  return generateOrientedPartiCandidate(options);
}
