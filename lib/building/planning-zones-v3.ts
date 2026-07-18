import type {
  CurrentBuildingRequirements,
  RoomRequirement,
  RoomType,
} from "@/lib/building/requirements";
import type { ResolvedRoomAreaPolicy } from "@/lib/building/area-policy-v3";

export const PLANNING_ZONE_CLASSES = [
  "interior_relay",
  "interior_destination",
  "covered_outdoor",
  "open_to_sky",
] as const;

export type PlanningZoneClass = (typeof PLANNING_ZONE_CLASSES)[number];

const ROOM_ZONE_CLASS: Readonly<Record<RoomType, PlanningZoneClass>> = Object.freeze({
  foyer: "interior_relay",
  circulation: "interior_relay",
  living: "interior_relay",
  dining: "interior_relay",
  stair: "interior_relay",
  bedroom: "interior_destination",
  bathroom: "interior_destination",
  kitchen: "interior_destination",
  utility: "interior_destination",
  study: "interior_destination",
  pooja: "interior_destination",
  store: "interior_destination",
  parking: "covered_outdoor",
  balcony: "covered_outdoor",
  verandah: "covered_outdoor",
  courtyard: "open_to_sky",
  terrace: "open_to_sky",
});

export function planningZoneClass(roomType: RoomType): PlanningZoneClass {
  return ROOM_ZONE_CLASS[roomType];
}

export function isInteriorRelayRoomType(roomType: RoomType) {
  return planningZoneClass(roomType) === "interior_relay";
}

export function isInteriorDestinationRoomType(roomType: RoomType) {
  return planningZoneClass(roomType) === "interior_destination";
}

export function isExteriorPlanningZone(roomType: RoomType) {
  const zone = planningZoneClass(roomType);
  return zone === "covered_outdoor" || zone === "open_to_sky";
}

export type PlanningConstraint = {
  id: string;
  kind:
    | "area"
    | "boundary"
    | "adjacency"
    | "privacy"
    | "vertical_alignment"
    | "zone"
    | "coverage";
  hardness: "hard" | "soft";
  requirementIds: string[];
  floorId: string;
  measured?: number;
  required?: number;
};

export type PlanningRoomCluster = {
  id: string;
  floorId: string;
  kind: "single" | "relay" | "attached_suite" | "covered_outdoor" | "open_to_sky";
  zoneClass: PlanningZoneClass;
  memberIds: string[];
  primaryRoomId: string;
  attachedBathroomIds: string[];
  minimumAreaMm2: number;
  effectiveTargetAreaMm2: number;
  hardMaximumAreaMm2: number;
};

type Relationship = CurrentBuildingRequirements["relationships"][number];

function relationshipPair(relationship: Relationship) {
  return [relationship.fromRoomId, relationship.toRoomId] as const;
}

/**
 * Finds only explicit bedroom/bathroom must-connect pairs. General must-connect relationships are
 * constraints, not permission to turn either room into a circulation relay.
 */
export function attachedBathroomBedroomPairs(input: {
  rooms: readonly RoomRequirement[];
  relationships: readonly Relationship[];
}) {
  const roomById = new Map(input.rooms.map((room) => [room.id, room]));
  const pairs = new Map<string, string>();
  for (const relationship of input.relationships) {
    if (relationship.type !== "must_connect") continue;
    const [fromId, toId] = relationshipPair(relationship);
    const from = roomById.get(fromId);
    const to = roomById.get(toId);
    if (from?.type === "bathroom" && to?.type === "bedroom") pairs.set(from.id, to.id);
    if (to?.type === "bathroom" && from?.type === "bedroom") pairs.set(to.id, from.id);
  }
  return new Map([...pairs].sort(([left], [right]) => left.localeCompare(right)));
}

function clusterKind(zoneClass: PlanningZoneClass, memberRooms: readonly RoomRequirement[]) {
  if (memberRooms.length > 1) return "attached_suite" as const;
  if (zoneClass === "interior_relay") return "relay" as const;
  if (zoneClass === "covered_outdoor") return "covered_outdoor" as const;
  if (zoneClass === "open_to_sky") return "open_to_sky" as const;
  return "single" as const;
}

export function createPlanningRoomClusters(input: {
  floorId: string;
  rooms: readonly RoomRequirement[];
  policies: readonly ResolvedRoomAreaPolicy[];
  relationships: readonly Relationship[];
}): PlanningRoomCluster[] {
  const rooms = input.rooms
    .filter((room) => room.floorId === input.floorId)
    .sort((left, right) => left.id.localeCompare(right.id));
  const policyByRoomId = new Map(input.policies.map((policy) => [policy.requirementId, policy]));
  const bathroomToBedroom = attachedBathroomBedroomPairs({
    rooms,
    relationships: input.relationships,
  });
  const bathroomsByBedroom = new Map<string, string[]>();
  for (const [bathroomId, bedroomId] of bathroomToBedroom) {
    const values = bathroomsByBedroom.get(bedroomId) ?? [];
    values.push(bathroomId);
    bathroomsByBedroom.set(bedroomId, values);
  }
  const consumed = new Set<string>();
  const clusters: PlanningRoomCluster[] = [];
  for (const room of rooms) {
    if (consumed.has(room.id)) continue;
    const attachedBathroomIds = room.type === "bedroom"
      ? [...(bathroomsByBedroom.get(room.id) ?? [])].sort()
      : [];
    const memberIds = [room.id, ...attachedBathroomIds];
    const memberRooms = memberIds.map((id) => rooms.find((candidate) => candidate.id === id)!);
    memberIds.forEach((id) => consumed.add(id));
    const zoneClass = planningZoneClass(room.type);
    const policies = memberIds.map((id) => policyByRoomId.get(id)).filter(
      (policy): policy is ResolvedRoomAreaPolicy => Boolean(policy),
    );
    clusters.push({
      id: attachedBathroomIds.length ? `cluster-suite-${room.id}` : `cluster-${room.id}`,
      floorId: input.floorId,
      kind: clusterKind(zoneClass, memberRooms),
      zoneClass,
      memberIds,
      primaryRoomId: room.id,
      attachedBathroomIds,
      minimumAreaMm2: policies.reduce((sum, policy) => sum + policy.minimumAreaMm2, 0),
      effectiveTargetAreaMm2: policies.reduce((sum, policy) => sum + policy.effectiveTargetAreaMm2, 0),
      hardMaximumAreaMm2: policies.reduce((sum, policy) => sum + policy.hardMaximumAreaMm2, 0),
    });
  }
  return clusters.sort((left, right) =>
    left.zoneClass.localeCompare(right.zoneClass)
    || left.primaryRoomId.localeCompare(right.primaryRoomId),
  );
}

export function createPlanningConstraints(input: {
  floorId: string;
  rooms: readonly RoomRequirement[];
  policies: readonly ResolvedRoomAreaPolicy[];
  relationships: readonly Relationship[];
}): PlanningConstraint[] {
  const floorRooms = input.rooms
    .filter((room) => room.floorId === input.floorId)
    .sort((left, right) => left.id.localeCompare(right.id));
  const roomIds = new Set(floorRooms.map((room) => room.id));
  const constraints: PlanningConstraint[] = [];
  for (const room of floorRooms) {
    const policy = input.policies.find((candidate) => candidate.requirementId === room.id);
    if (!policy) continue;
    constraints.push(
      {
        id: `area-min:${room.id}`,
        kind: "area",
        hardness: "hard",
        requirementIds: [policy.requirementId],
        floorId: input.floorId,
        required: policy.minimumAreaMm2,
      },
      {
        id: `area-max:${room.id}`,
        kind: "area",
        hardness: "hard",
        requirementIds: [policy.requirementId],
        floorId: input.floorId,
        required: policy.hardMaximumAreaMm2,
      },
      {
        id: `area-target:${room.id}`,
        kind: "area",
        hardness: "soft",
        requirementIds: [policy.requirementId],
        floorId: input.floorId,
        required: policy.effectiveTargetAreaMm2,
      },
      {
        id: `zone:${room.id}:${planningZoneClass(room.type)}`,
        kind: "zone",
        hardness: "hard",
        requirementIds: [room.id],
        floorId: input.floorId,
      },
    );
    if (room.preferredZone !== "any") constraints.push({
      id: `preferred-zone:${room.id}:${room.preferredZone}`,
      kind: "zone",
      hardness: "soft",
      requirementIds: [room.id],
      floorId: input.floorId,
    });
  }
  for (const relationship of input.relationships
    .filter((candidate) => candidate.type === "must_connect")
    .filter((candidate) => roomIds.has(candidate.fromRoomId) && roomIds.has(candidate.toRoomId))
    .sort((left, right) =>
      left.fromRoomId.localeCompare(right.fromRoomId)
      || left.toRoomId.localeCompare(right.toRoomId),
    )) {
    const from = floorRooms.find((room) => room.id === relationship.fromRoomId);
    const to = floorRooms.find((room) => room.id === relationship.toRoomId);
    const attachedPair = (from?.type === "bedroom" && to?.type === "bathroom")
      || (from?.type === "bathroom" && to?.type === "bedroom");
    constraints.push({
      id: `${attachedPair ? "privacy" : "adjacency"}:${relationship.fromRoomId}:${relationship.toRoomId}`,
      kind: attachedPair ? "privacy" : "adjacency",
      hardness: "hard",
      requirementIds: [relationship.fromRoomId, relationship.toRoomId].sort(),
      floorId: input.floorId,
    });
  }
  constraints.push({
    id: `coverage:${input.floorId}`,
    kind: "coverage",
    hardness: "hard",
    requirementIds: floorRooms.map((room) => room.id),
    floorId: input.floorId,
  });
  return constraints.sort((left, right) => left.id.localeCompare(right.id));
}
