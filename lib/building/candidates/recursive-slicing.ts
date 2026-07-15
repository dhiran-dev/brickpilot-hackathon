import type { PreferredZone, RoomRequirement } from "@/lib/building/requirements";
import type { Rectangle } from "@/lib/building/schema";
import { candidateRoom, type CandidateGeneratorOptions, type CandidateRoom, type FloorCandidate } from "@/lib/building/candidates/types";
import { splitOversizedBalconies } from "@/lib/building/candidates/balcony-remainder";

const zonePosition: Record<PreferredZone, readonly [number, number]> = {
  northwest: [0, 0], north: [0.5, 0], northeast: [1, 0], west: [0, 0.5], center: [0.5, 0.5],
  any: [0.5, 0.5], east: [1, 0.5], southwest: [0, 1], south: [0.5, 1], southeast: [1, 1],
};

function mix(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function roomWeight(room: RoomRequirement) {
  return Math.max(room.minAreaMm2, room.targetAreaMm2);
}

function orderRooms(rooms: RoomRequirement[], axis: "x" | "y", jitter: Map<string, number>) {
  const coordinate = axis === "x" ? 0 : 1;
  return [...rooms].sort((left, right) => {
    const position = zonePosition[left.preferredZone][coordinate] - zonePosition[right.preferredZone][coordinate];
    if (position !== 0) return position;
    const randomOrder = (jitter.get(left.id) ?? 0) - (jitter.get(right.id) ?? 0);
    return randomOrder || left.id.localeCompare(right.id);
  });
}

function splitIndex(rooms: RoomRequirement[]) {
  const total = rooms.reduce((sum, room) => sum + roomWeight(room), 0);
  let running = 0;
  let best = 1;
  let delta = Number.POSITIVE_INFINITY;
  for (let index = 1; index < rooms.length; index += 1) {
    running += roomWeight(rooms[index - 1]);
    const nextDelta = Math.abs(total / 2 - running);
    if (nextDelta < delta) {
      delta = nextDelta;
      best = index;
    }
  }
  return best;
}

function partition(
  rooms: RoomRequirement[],
  bounds: Rectangle,
  output: CandidateRoom[],
  jitter: Map<string, number>,
  variant: number,
  depth = 0,
) {
  if (rooms.length === 0) return;
  if (rooms.length === 1) {
    output.push(candidateRoom(rooms[0], bounds));
    return;
  }

  const vertical = bounds.width > bounds.depth
    ? true
    : bounds.depth > bounds.width
      ? false
      : (depth + variant) % 2 === 0;
  const ordered = orderRooms(rooms, vertical ? "x" : "y", jitter);
  const index = splitIndex(ordered);
  const firstRooms = ordered.slice(0, index);
  const secondRooms = ordered.slice(index);
  const totalWeight = ordered.reduce((sum, room) => sum + roomWeight(room), 0);
  const firstWeight = firstRooms.reduce((sum, room) => sum + roomWeight(room), 0);

  if (vertical) {
    const firstWidth = Math.max(1, Math.min(bounds.width - 1, Math.round(bounds.width * firstWeight / totalWeight)));
    partition(firstRooms, { ...bounds, width: firstWidth }, output, jitter, variant, depth + 1);
    partition(secondRooms, { x: bounds.x + firstWidth, y: bounds.y, width: bounds.width - firstWidth, depth: bounds.depth }, output, jitter, variant, depth + 1);
  } else {
    const firstDepth = Math.max(1, Math.min(bounds.depth - 1, Math.round(bounds.depth * firstWeight / totalWeight)));
    partition(firstRooms, { ...bounds, depth: firstDepth }, output, jitter, variant, depth + 1);
    partition(secondRooms, { x: bounds.x, y: bounds.y + firstDepth, width: bounds.width, depth: bounds.depth - firstDepth }, output, jitter, variant, depth + 1);
  }
}

function distributeAroundCore(options: CandidateGeneratorOptions, jitter: Map<string, number>) {
  const { envelope, stairCore, rooms, variant } = options;
  if (!stairCore) {
    const output: CandidateRoom[] = [];
    partition(rooms, envelope, output, jitter, variant);
    return output;
  }

  const right: Rectangle = {
    x: stairCore.bounds.x + stairCore.bounds.width,
    y: envelope.y,
    width: envelope.width - stairCore.bounds.width,
    depth: stairCore.bounds.depth,
  };
  const lower: Rectangle = {
    x: envelope.x,
    y: envelope.y + stairCore.bounds.depth,
    width: envelope.width,
    depth: envelope.depth - stairCore.bounds.depth,
  };
  if (right.width < 900 || lower.depth < 900) throw new Error("STAIR_CORE_EXCEEDS_ENVELOPE");

  const ordered = orderRooms(rooms, "y", jitter);
  const desiredRight = Math.max(1, Math.min(ordered.length - 1, Math.round(ordered.length * (right.width * right.depth) / (envelope.width * envelope.depth))));
  const rightRooms = ordered.length === 1 ? [] : ordered.slice(0, desiredRight);
  const lowerRooms = ordered.length === 1 ? ordered : ordered.slice(desiredRight);
  const output: CandidateRoom[] = [stairCore];

  if (rightRooms.length > 0) partition(rightRooms, right, output, jitter, variant + 1);
  else {
    output.push({
      id: `${options.floor.id}-landing`, name: "Stair landing", type: "circulation", floorId: options.floor.id,
      minAreaMm2: right.width * right.depth, targetAreaMm2: right.width * right.depth,
      accessible: false, bounds: right, occupied: true,
    });
  }
  partition(lowerRooms, lower, output, jitter, variant);
  return output;
}

export function generateRecursiveSlicingCandidate(options: CandidateGeneratorOptions): FloorCandidate {
  const random = mix((options.seed ^ Math.imul(options.variant + 1, 0x9e3779b1)) >>> 0);
  const jitter = new Map(options.rooms.map((room) => [room.id, random()]));
  return { floor: options.floor, cells: splitOversizedBalconies(distributeAroundCore(options, jitter), options.envelope) };
}
