import type { RoomRequirement } from "@/lib/building/requirements";
import type { Rectangle } from "@/lib/building/schema";
import { candidateRoom, type CandidateGeneratorOptions, type CandidateRoom, type FloorCandidate } from "@/lib/building/candidates/types";
import { splitOversizedBalconies } from "@/lib/building/candidates/balcony-remainder";

type RoomGroup = {
  rooms: RoomRequirement[];
  weight: number;
  preferredSide?: "left" | "right";
  preferredEnd?: "north" | "south";
};

function roomWeight(room: RoomRequirement) {
  return Math.max(room.minAreaMm2, room.targetAreaMm2);
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
  const remaining = rooms
    .filter((room) => !used.has(room.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (remaining.length > 0) {
    const offset = variant % remaining.length;
    for (const room of [...remaining.slice(offset), ...remaining.slice(0, offset)]) add([room]);
  }
  return groups;
}

function distributeGroups(groups: RoomGroup[], leftBounds: Rectangle, rightBounds: Rectangle, variant: number) {
  const minimumDepth = (group: RoomGroup, bounds: Rectangle) => group.rooms.reduce(
    (sum, room) => sum + Math.max(room.accessible ? 1200 : 900, Math.ceil(room.minAreaMm2 / bounds.width)),
    0,
  );
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
        leftDepth += minimumDepth(group, leftBounds);
      } else {
        right.push(group);
        rightDepth += minimumDepth(group, rightBounds);
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

function partitionWing(groups: RoomGroup[], bounds: Rectangle, output: CandidateRoom[]) {
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
  const minimumDepth = (room: RoomRequirement) => Math.max(room.accessible ? 1200 : 900, Math.ceil(room.minAreaMm2 / bounds.width));
  const groupMinimums = ordered.map((group) => group.rooms.reduce((sum, room) => sum + minimumDepth(room), 0));
  const groupDepths = proportionalLengths(ordered.map((group) => group.weight), bounds.depth, groupMinimums);
  let y = bounds.y;
  ordered.forEach((group, groupIndex) => {
    const groupDepth = groupDepths[groupIndex];
    const roomDepths = proportionalLengths(group.rooms.map(roomWeight), groupDepth, group.rooms.map(minimumDepth));
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
  const groups = roomGroups(options.rooms.filter((room) => room.id !== primarySpine.id), options.variant);
  const minimumSpineWidth = 1200;
  const desiredSpineWidth = Math.round(roomWeight(primarySpine) / envelope.depth);
  const spineWidth = Math.max(minimumSpineWidth, Math.min(1800, desiredSpineWidth));
  const centeredSpineX = Math.round(envelope.x + (envelope.width - spineWidth) / 2);
  const spineX = stairCore ? stairCore.bounds.x + stairCore.bounds.width : centeredSpineX;
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
  partitionWing(distributed.left, leftBounds, output);
  partitionWing(distributed.right, rightBounds, output);
  return { floor: options.floor, cells: splitOversizedBalconies(output, options.envelope) };
}
