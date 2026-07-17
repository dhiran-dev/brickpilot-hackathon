import type { RoomRequirement } from "@/lib/building/requirements";
import type { Rectangle } from "@/lib/building/schema";
import { candidateRoom, type CandidateGeneratorOptions, type CandidateRoom, type FloorCandidate } from "@/lib/building/candidates/types";
import { splitOversizedBalconies } from "@/lib/building/candidates/balcony-remainder";
import { minimumClearDimensionMm } from "@/lib/building/dimensions";

type RoomGroup = {
  rooms: RoomRequirement[];
  weight: number;
  preferredSide?: "left" | "right";
  preferredEnd?: "north" | "south";
};

function roomWeight(room: RoomRequirement) {
  return Math.max(room.minAreaMm2, room.targetAreaMm2);
}

function minimumClearDimension(room: RoomRequirement) {
  return minimumClearDimensionMm(room.type, room.accessible);
}

function minimumRoomDepth(room: RoomRequirement, width: number) {
  if (room.type === "parking") {
    if (width >= 4_800) return Math.max(2_400, Math.ceil(room.minAreaMm2 / width));
    if (width >= 2_400) return Math.max(4_800, Math.ceil(room.minAreaMm2 / width));
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(minimumClearDimension(room), Math.ceil(room.minAreaMm2 / width));
}

function minimumGroupDepth(group: RoomGroup, bounds: Rectangle) {
  const minimumArea = group.rooms.reduce((sum, room) => sum + room.minAreaMm2, 0);
  const bedroom = group.rooms.find((room) => room.type === "bedroom");
  const bathroom = group.rooms.find((room) => room.type === "bathroom");
  if (group.rooms.length === 2 && bedroom && bathroom && /attached bathroom/i.test(bathroom.name)) {
    for (let roomDepth = minimumClearDimension(bedroom); roomDepth <= bounds.depth - 1_200; roomDepth += 50) {
      const bedroomWidth = Math.max(2_700, Math.ceil(bedroom.minAreaMm2 / roomDepth));
      const bathroomWidth = Math.max(1_200, Math.ceil(bathroom.minAreaMm2 / roomDepth));
      if (bedroomWidth + bathroomWidth <= bounds.width) return 1_200 + roomDepth;
    }
    return Number.POSITIVE_INFINITY;
  }
  const living = group.rooms.find((room) => room.type === "living");
  const outer = group.rooms.filter((room) => room.id !== living?.id);
  if (living && outer.length > 0) {
    return Math.max(
      minimumClearDimension(living),
      outer.reduce((sum, room) => sum + minimumClearDimension(room), 0),
      Math.ceil(minimumArea / bounds.width),
    );
  }
  if (group.rooms.length === 2 && group.rooms.every((room) => !["parking", "balcony", "courtyard", "terrace", "verandah"].includes(room.type))) {
    const branchRoomWidth = bounds.width - 900;
    if (branchRoomWidth >= 1_200) return group.rooms.reduce((sum, room) => sum + minimumRoomDepth(room, branchRoomWidth), 0);
  }
  return group.rooms.reduce((sum, room) => sum + minimumRoomDepth(room, bounds.width), 0);
}

function attachedBedroomFor(bathroom: RoomRequirement, rooms: RoomRequirement[]) {
  if (bathroom.type !== "bathroom" || !/attached bathroom/i.test(bathroom.name)) return undefined;
  const suffix = bathroom.id.match(/(?:bathroom|bath)-(.+)$/)?.[1];
  if (!suffix) return undefined;
  return rooms.find((room) => room.type === "bedroom" && (
    room.id === `bedroom-${suffix}` || room.id === `bed-${suffix}`
  ));
}

function roomGroups(rooms: RoomRequirement[], variant: number) {
  const used = new Set<string>();
  const groups: RoomGroup[] = [];
  const add = (members: RoomRequirement[]) => {
    const roomsInGroup = members.filter((room) => !used.has(room.id));
    if (roomsInGroup.length === 0) return;
    roomsInGroup.forEach((room) => used.add(room.id));
    const east = roomsInGroup.some((room) => ["east", "northeast", "southeast"].includes(room.preferredZone));
    const west = roomsInGroup.some((room) => ["west", "northwest", "southwest"].includes(room.preferredZone));
    const north = roomsInGroup.some((room) => ["north", "northeast", "northwest"].includes(room.preferredZone));
    const south = roomsInGroup.some((room) => ["south", "southeast", "southwest"].includes(room.preferredZone));
    groups.push({
      rooms: roomsInGroup,
      weight: roomsInGroup.reduce((sum, room) => sum + roomWeight(room), 0),
      preferredSide: east === west ? undefined : east ? "right" : "left",
      preferredEnd: north === south ? undefined : north ? "north" : "south",
    });
  };

  const foyer = rooms.find((room) => room.type === "foyer");
  const living = rooms.find((room) => room.type === "living");
  const dining = rooms.find((room) => room.type === "dining");
  if (foyer && living) add([foyer, living, ...(dining ? [dining] : [])]);
  for (const bathroom of rooms.filter((room) => room.type === "bathroom")) {
    const bedroom = attachedBedroomFor(bathroom, rooms);
    if (bedroom) add([bedroom, bathroom]);
  }
  const kitchen = rooms.find((room) => room.type === "kitchen" && !used.has(room.id));
  const utility = rooms.find((room) => room.type === "utility" && !used.has(room.id));
  if (kitchen && utility) add([kitchen, utility]);
  const study = rooms.find((room) => room.type === "study" && !used.has(room.id));
  const pooja = rooms.find((room) => room.type === "pooja" && !used.has(room.id));
  if (study && pooja) add([study, pooja]);
  const upperLounge = rooms.find((room) => room.type === "living" && !used.has(room.id));
  const upperStudy = rooms.find((room) => room.type === "study" && !used.has(room.id));
  if (upperLounge) add([upperLounge, ...(upperStudy ? [upperStudy] : [])]);
  const ungroupedBedrooms = rooms.filter((room) => room.type === "bedroom" && !used.has(room.id));
  const ungroupedBathrooms = rooms.filter((room) => room.type === "bathroom" && !used.has(room.id));
  while (ungroupedBedrooms.length > 0 && ungroupedBathrooms.length > 0) {
    add([ungroupedBedrooms.shift() as RoomRequirement, ungroupedBathrooms.shift() as RoomRequirement]);
  }
  const remaining = rooms
    .filter((room) => !used.has(room.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (remaining.length > 0) {
    const offset = variant % remaining.length;
    const rotated = [...remaining.slice(offset), ...remaining.slice(0, offset)];
    for (const room of rotated) add([room]);
  }
  return groups;
}

function distributeGroups(groups: RoomGroup[], leftBounds: Rectangle, rightBounds: Rectangle, variant: number) {
  let best: { left: RoomGroup[]; right: RoomGroup[]; score: number } | undefined;
  const assignmentCount = 2 ** groups.length;
  for (let mask = 0; mask < assignmentCount; mask += 1) {
    const left: RoomGroup[] = [];
    const right: RoomGroup[] = [];
    let leftDepth = 0;
    let rightDepth = 0;
    let allowed = true;
    let preferencePenalty = 0;
    for (const [index, group] of groups.entries()) {
      const side = mask & (1 << index) ? "right" : "left";
      const parking = group.rooms.some((room) => room.type === "parking");
      if (parking && group.preferredSide && group.preferredSide !== side) {
        allowed = false;
        break;
      }
      const bounds = side === "left" ? leftBounds : rightBounds;
      if (parking && group.preferredEnd && bounds.width < 2900) {
        allowed = false;
        break;
      }
      if (group.preferredSide && group.preferredSide !== side) preferencePenalty += 1;
      if (side === "left") {
        left.push(group);
        leftDepth += minimumGroupDepth(group, leftBounds);
      } else {
        right.push(group);
        rightDepth += minimumGroupDepth(group, rightBounds);
      }
    }
    if (!allowed || leftDepth > leftBounds.depth || rightDepth > rightBounds.depth) continue;
    const leftWeight = left.reduce((sum, group) => sum + group.weight, 0);
    const rightWeight = right.reduce((sum, group) => sum + group.weight, 0);
    const densityDelta = Math.abs(
      leftWeight / Math.max(1, leftBounds.width * leftBounds.depth) -
      rightWeight / Math.max(1, rightBounds.width * rightBounds.depth),
    );
    const stableTieBreak = ((mask ^ variant) >>> 0) / 0xffff_ffff_ffff;
    const score = densityDelta * 100 + preferencePenalty * 0.01 + stableTieBreak * 1e-6;
    if (!best || score < best.score) best = { left, right, score };
  }
  if (!best) throw new Error("CIRCULATION_WING_ASSIGNMENT_IMPOSSIBLE");
  return best;
}

function proportionalLengths(weights: number[], total: number, minimums = weights.map(() => 1)) {
  const minimumTotal = minimums.reduce((sum, value) => sum + value, 0);
  if (minimumTotal > total) throw new Error("CIRCULATION_WING_TOO_SHORT");
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const distributable = total - minimumTotal;
  let remaining = total;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return remaining;
    const laterMinimum = minimums.slice(index + 1).reduce((sum, value) => sum + value, 0);
    const length = Math.max(
      minimums[index],
      Math.min(remaining - laterMinimum, minimums[index] + Math.round(distributable * weight / weightTotal)),
    );
    remaining -= length;
    return length;
  });
}

function pushSuiteCluster(group: RoomGroup, bounds: Rectangle, spineEdge: "left" | "right", output: CandidateRoom[]) {
  if (group.rooms.length !== 2) return false;
  const bedroom = group.rooms.find((room) => room.type === "bedroom");
  const bathroom = group.rooms.find((room) => room.type === "bathroom");
  if (!bedroom || !bathroom || !/attached bathroom/i.test(bathroom.name)) return false;
  const galleryDepth = 900;
  const roomDepth = bounds.depth - galleryDepth;
  if (roomDepth < 2_700) return false;
  const minimumBedroomWidth = Math.max(2_700, Math.ceil(bedroom.minAreaMm2 / roomDepth));
  const minimumBathroomWidth = Math.max(1_200, Math.ceil(bathroom.minAreaMm2 / roomDepth));
  if (minimumBedroomWidth + minimumBathroomWidth > bounds.width) return false;
  const targetBathroomWidth = Math.round(bathroom.targetAreaMm2 / roomDepth);
  const bathroomWidth = Math.max(minimumBathroomWidth, Math.min(bounds.width - minimumBedroomWidth, targetBathroomWidth));
  const bedroomWidth = bounds.width - bathroomWidth;
  const bedroomX = spineEdge === "right" ? bounds.x : bounds.x + bathroomWidth;
  const bathroomX = spineEdge === "right" ? bounds.x + bedroomWidth : bounds.x;
  output.push({
    ...candidateRoom(bedroom, { x: bounds.x, y: bounds.y, width: bounds.width, depth: galleryDepth }),
    id: `${bedroom.floorId}-suite-gallery-${bedroom.id}`,
    name: "Bedroom vestibule",
    type: "circulation",
    minAreaMm2: bounds.width * galleryDepth,
    targetAreaMm2: bounds.width * galleryDepth,
    occupied: true,
  });
  output.push(candidateRoom(bedroom, { x: bedroomX, y: bounds.y + galleryDepth, width: bedroomWidth, depth: roomDepth }));
  output.push(candidateRoom(bathroom, { x: bathroomX, y: bounds.y + galleryDepth, width: bathroomWidth, depth: roomDepth }));
  return true;
}

function pushSocialCluster(group: RoomGroup, bounds: Rectangle, spineEdge: "left" | "right", output: CandidateRoom[]) {
  const living = group.rooms.find((room) => room.type === "living");
  const outerRooms = group.rooms.filter((room) => room.id !== living?.id);
  if (!living || outerRooms.length < 1) return false;
  let selectedOuterWidth: number | undefined;
  let selectedOuterDepths: number[] | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  const minimumOuterWidth = Math.max(...outerRooms.map(minimumClearDimension));
  for (let outerWidth = minimumOuterWidth; outerWidth <= bounds.width - minimumClearDimension(living); outerWidth += 100) {
    const livingWidth = bounds.width - outerWidth;
    if (livingWidth * bounds.depth < living.minAreaMm2) continue;
    const minimumDepths = outerRooms.map((room) => minimumRoomDepth(room, outerWidth));
    if (minimumDepths.reduce((sum, depth) => sum + depth, 0) > bounds.depth) continue;
    const depths = proportionalLengths(outerRooms.map(roomWeight), bounds.depth, minimumDepths);
    const livingDelta = Math.abs(livingWidth * bounds.depth - living.targetAreaMm2) / Math.max(1, living.targetAreaMm2);
    const outerDelta = outerRooms.reduce((sum, room, index) => sum + Math.abs(outerWidth * depths[index] - room.targetAreaMm2) / Math.max(1, room.targetAreaMm2), 0);
    const score = livingDelta + outerDelta;
    if (score < bestScore) {
      bestScore = score;
      selectedOuterWidth = outerWidth;
      selectedOuterDepths = depths;
    }
  }
  if (!selectedOuterWidth || !selectedOuterDepths) return false;
  const livingWidth = bounds.width - selectedOuterWidth;
  // Keep the main living volume on the outer facade and the smaller foyer/dining stack on the
  // gallery side. This preserves direct social-room connections without burying living in the
  // middle of the plan.
  const livingX = spineEdge === "right" ? bounds.x : bounds.x + selectedOuterWidth;
  const outerX = spineEdge === "right" ? bounds.x + livingWidth : bounds.x;
  output.push(candidateRoom(living, { x: livingX, y: bounds.y, width: livingWidth, depth: bounds.depth }));
  let roomY = bounds.y;
  outerRooms.forEach((room, index) => {
    const depth = selectedOuterDepths?.[index] ?? 0;
    output.push(candidateRoom(room, { x: outerX, y: roomY, width: selectedOuterWidth as number, depth }));
    roomY += depth;
  });
  return true;
}

function maximumSetbackDepth(level: number, bounds: Rectangle, spineEdge: "left" | "right", variant: number) {
  if (level === 0) return Math.min(1_000, Math.floor(bounds.depth * 0.08));
  const deeperWing = (level + variant) % 2 === (spineEdge === "left" ? 0 : 1);
  const depthRatio = deeperWing ? 0.18 : 0.10;
  return Math.min(deeperWing ? 2_400 : 1_400, Math.floor(bounds.depth * depthRatio));
}

function partitionWing(
  groups: RoomGroup[],
  bounds: Rectangle,
  spineEdge: "left" | "right",
  output: CandidateRoom[],
  options: { allowSurplusTerrace: boolean; floorLevel: number; variant: number },
) {
  if (groups.length === 0 || bounds.width <= 0 || bounds.depth <= 0) return;
  const ordered = [...groups].sort((left, right) => {
    const endRank = (group: RoomGroup) => group.preferredEnd === "north" ? 0 : group.preferredEnd === "south" ? 2 : 1;
    const endOrder = endRank(left) - endRank(right);
    if (endOrder !== 0) return endOrder;
    if (left.preferredEnd === "south" && right.preferredEnd === "south") {
      const leftParking = left.rooms.some((room) => room.type === "parking") ? 1 : 0;
      const rightParking = right.rooms.some((room) => room.type === "parking") ? 1 : 0;
      if (leftParking !== rightParking) return leftParking - rightParking;
    }
    return 0;
  });
  const groupMinimums = ordered.map((group) => minimumGroupDepth(group, bounds));
  const desiredDepths = ordered.map((group, index) => Math.max(groupMinimums[index], Math.ceil(group.weight / bounds.width)));
  const desiredTotal = desiredDepths.reduce((sum, depth) => sum + depth, 0);
  const rawSurplus = Math.max(0, bounds.depth - desiredTotal);
  const terraceCap = maximumSetbackDepth(options.floorLevel, bounds, spineEdge, options.variant);
  const hasDesignedOutdoorSpace = ordered.some((group) => group.rooms.some((room) => ["balcony", "courtyard", "parking", "terrace", "verandah"].includes(room.type)));
  // A villa setback should be a deliberate outdoor bay, not every square metre left after the
  // minimum room targets. Keep one wing deeper than the other and return the balance to usable
  // rooms. Sub-900 mm slivers are absorbed completely because they are neither useful terraces nor
  // convincing architectural articulation.
  const terraceDepth = options.allowSurplusTerrace && !hasDesignedOutdoorSpace && rawSurplus >= 900 && terraceCap >= 900
    ? Math.max(900, Math.min(rawSurplus, terraceCap))
    : 0;
  const occupiedDepth = bounds.depth - terraceDepth;
  const groupDepths = proportionalLengths(ordered.map((group) => group.weight), occupiedDepth, groupMinimums);
  const firstSouthIndex = ordered.findIndex((group) => group.preferredEnd === "south");
  const terraceBeforeIndex = terraceDepth > 0 ? (firstSouthIndex >= 0 ? firstSouthIndex : ordered.length) : -1;
  let y = bounds.y;
  ordered.forEach((group, groupIndex) => {
    if (groupIndex === terraceBeforeIndex) {
      const source = ordered[0]?.rooms[0];
      if (source) output.push({
        ...candidateRoom(source, { x: bounds.x, y, width: bounds.width, depth: terraceDepth }),
        id: `${source.floorId}-villa-terrace-${bounds.x}`,
        name: source.floorId === "F0" ? "Entry / side court" : "Sectioned setback terrace",
        type: "terrace",
        minAreaMm2: bounds.width * terraceDepth,
        targetAreaMm2: bounds.width * terraceDepth,
        occupied: false,
      });
      y += terraceDepth;
    }
    const groupDepth = groupDepths[groupIndex];
    const groupBounds = { x: bounds.x, y, width: bounds.width, depth: groupDepth };
    const clustered = pushSuiteCluster(group, groupBounds, spineEdge, output)
      || pushSocialCluster(group, groupBounds, spineEdge, output);
    if (!clustered) {
      // Legacy generator diagnostics retain their historical deterministic subdivision, but this
      // path is no longer reachable from production generation after T3's parti-only cutover.
      const roomDepths = proportionalLengths(
        group.rooms.map(roomWeight),
        groupBounds.depth,
        group.rooms.map((room) => minimumRoomDepth(room, groupBounds.width)),
      );
      let roomY = groupBounds.y;
      group.rooms.forEach((room, roomIndex) => {
        const depth = roomDepths[roomIndex];
        output.push(candidateRoom(room, { x: groupBounds.x, y: roomY, width: groupBounds.width, depth }));
        roomY += depth;
      });
    }
    y += groupDepth;
  });
  if (terraceDepth > 0 && terraceBeforeIndex === ordered.length) {
    const source = ordered[0]?.rooms[0];
    if (source) output.push({
      ...candidateRoom(source, { x: bounds.x, y, width: bounds.width, depth: terraceDepth }),
      id: `${source.floorId}-villa-terrace-${bounds.x}`,
      name: source.floorId === "F0" ? "Entry / side court" : "Sectioned setback terrace",
      type: "terrace",
      minAreaMm2: bounds.width * terraceDepth,
      targetAreaMm2: bounds.width * terraceDepth,
      occupied: false,
    });
  }
}

/**
 * Builds a real common-access spine: every ordinary room borders the circulation strip, while
 * attached bedroom/bathroom and foyer/living pairs also share a wall. This makes privacy-safe door
 * topology achievable by construction rather than hoping a generic treemap happens to expose it.
 */
export function generateSpineGrowthCandidate(options: CandidateGeneratorOptions): FloorCandidate {
  const primarySpine = options.rooms.find((room) => room.type === "circulation")
    ?? options.rooms.find((room) => room.type === "foyer")
    ?? options.rooms.find((room) => room.type === "living" || room.type === "dining");
  if (!primarySpine) throw new Error("CIRCULATION_SPINE_REQUIRED");

  const { envelope, stairCore } = options;
  const groups = roomGroups(options.rooms.filter((room) => room.id !== primarySpine.id), options.variant);
  const minimumSpineWidth = primarySpine.accessible ? 1_200 : 1_000;
  const desiredSpineWidth = Math.round(roomWeight(primarySpine) / envelope.depth);
  const spineWidth = Math.max(minimumSpineWidth, Math.min(1800, desiredSpineWidth));
  const centeredSpineX = Math.round(envelope.x + (envelope.width - spineWidth) / 2);
  const spineX = stairCore
    ? Math.max(
      stairCore.bounds.x + stairCore.bounds.width,
      Math.min(centeredSpineX, stairCore.bounds.x + stairCore.bounds.width + 900),
    )
    : centeredSpineX;
  if (spineX + spineWidth >= envelope.x + envelope.width) throw new Error("CIRCULATION_SPINE_EXCEEDS_ENVELOPE");

  const spineBounds: Rectangle = { x: spineX, y: envelope.y, width: spineWidth, depth: envelope.depth };
  const leftBounds: Rectangle = {
    x: envelope.x,
    y: stairCore ? stairCore.bounds.y + stairCore.bounds.depth : envelope.y,
    width: spineX - envelope.x,
    depth: envelope.depth - (stairCore?.bounds.depth ?? 0),
  };
  const rightBounds: Rectangle = {
    x: spineX + spineWidth,
    y: envelope.y,
    width: envelope.x + envelope.width - spineX - spineWidth,
    depth: envelope.depth,
  };

  const distributed = distributeGroups(
    groups,
    leftBounds,
    rightBounds,
    options.variant,
  );
  const output: CandidateRoom[] = [];
  if (stairCore) output.push(stairCore);
  output.push(candidateRoom(primarySpine, spineBounds));
  if (stairCore && spineX > stairCore.bounds.x + stairCore.bounds.width) {
    output.push({
      ...candidateRoom(primarySpine, {
        x: stairCore.bounds.x + stairCore.bounds.width,
        y: stairCore.bounds.y,
        width: spineX - stairCore.bounds.x - stairCore.bounds.width,
        depth: stairCore.bounds.depth,
      }),
      id: `${primarySpine.id}-stair-lobby`,
      name: "Stair lobby / gallery",
    });
  }
  // Articulated-wing candidates are recessed later by applyFormStrategy. Creating another full
  // surplus terrace here double-counts outdoor area and makes the upper floors look hollow.
  const allowSurplusTerrace = options.floor.level > 0 && options.formStrategy === "stepped_terraces";
  const partitionOptions = { allowSurplusTerrace, floorLevel: options.floor.level, variant: options.variant };
  partitionWing(distributed.left, leftBounds, "right", output, partitionOptions);
  partitionWing(distributed.right, rightBounds, "left", output, partitionOptions);
  return { floor: options.floor, cells: splitOversizedBalconies(output, options.envelope) };
}
