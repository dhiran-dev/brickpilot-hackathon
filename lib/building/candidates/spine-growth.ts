import type { RoomRequirement } from "@/lib/building/requirements";
import type { Rectangle } from "@/lib/building/schema";
import { candidateRoom, type CandidateGeneratorOptions, type CandidateRoom, type FloorCandidate } from "@/lib/building/candidates/types";
import { splitOversizedBalconies } from "@/lib/building/candidates/balcony-remainder";

type RoomGroup = { rooms: RoomRequirement[]; weight: number; preferredSide?: "left" | "right" };

function roomWeight(room: RoomRequirement) {
  return Math.max(room.minAreaMm2, room.targetAreaMm2);
}

function attachedBedroomFor(bathroom: RoomRequirement, rooms: RoomRequirement[]) {
  if (bathroom.type !== "bathroom" || !/^attached bathroom/i.test(bathroom.name)) return undefined;
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
    groups.push({
      rooms: roomsInGroup,
      weight: roomsInGroup.reduce((sum, room) => sum + roomWeight(room), 0),
      preferredSide: east === west ? undefined : east ? "right" : "left",
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
  const remaining = rooms
    .filter((room) => !used.has(room.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (remaining.length > 0) {
    const offset = variant % remaining.length;
    for (const room of [...remaining.slice(offset), ...remaining.slice(0, offset)]) add([room]);
  }
  return groups;
}

function distributeGroups(groups: RoomGroup[], leftArea: number, rightArea: number, variant: number) {
  const left: RoomGroup[] = [];
  const right: RoomGroup[] = [];
  let leftWeight = 0;
  let rightWeight = 0;
  for (const [index, group] of groups.entries()) {
    const forced = group.preferredSide;
    const side = forced ?? (
      leftWeight / Math.max(1, leftArea) < rightWeight / Math.max(1, rightArea)
        ? "left"
        : leftWeight / Math.max(1, leftArea) > rightWeight / Math.max(1, rightArea)
          ? "right"
          : (index + variant) % 2 === 0 ? "left" : "right"
    );
    if (side === "left" && leftArea > 0 || rightArea <= 0) {
      left.push(group);
      leftWeight += group.weight;
    } else {
      right.push(group);
      rightWeight += group.weight;
    }
  }
  return { left, right };
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

function partitionWing(groups: RoomGroup[], bounds: Rectangle, output: CandidateRoom[]) {
  if (groups.length === 0 || bounds.width <= 0 || bounds.depth <= 0) return;
  const groupMinimums = groups.map((group) => group.rooms.length * 1200);
  const groupDepths = proportionalLengths(groups.map((group) => group.weight), bounds.depth, groupMinimums);
  let y = bounds.y;
  groups.forEach((group, groupIndex) => {
    const groupDepth = groupDepths[groupIndex];
    const roomDepths = proportionalLengths(group.rooms.map(roomWeight), groupDepth, group.rooms.map(() => 1200));
    let roomY = y;
    group.rooms.forEach((room, roomIndex) => {
      const depth = roomDepths[roomIndex];
      output.push(candidateRoom(room, { x: bounds.x, y: roomY, width: bounds.width, depth }));
      roomY += depth;
    });
    y += groupDepth;
  });
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
  const minimumSpineWidth = 1200;
  const desiredSpineWidth = Math.round(roomWeight(primarySpine) / envelope.depth);
  const spineWidth = Math.max(minimumSpineWidth, Math.min(1800, desiredSpineWidth));
  const spineX = stairCore ? stairCore.bounds.x + stairCore.bounds.width : Math.round(envelope.x + (envelope.width - spineWidth) / 2);
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

  const groups = roomGroups(options.rooms.filter((room) => room.id !== primarySpine.id), options.variant);
  const distributed = distributeGroups(
    groups,
    leftBounds.width * leftBounds.depth,
    rightBounds.width * rightBounds.depth,
    options.variant,
  );
  const output: CandidateRoom[] = [];
  if (stairCore) output.push(stairCore);
  output.push(candidateRoom(primarySpine, spineBounds));
  partitionWing(distributed.left, leftBounds, output);
  partitionWing(distributed.right, rightBounds, output);
  return { floor: options.floor, cells: splitOversizedBalconies(output, options.envelope) };
}
