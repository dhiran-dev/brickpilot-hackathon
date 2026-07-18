import type { CurrentBuildingRequirements, RoomRequirement, RoomType } from "@/lib/building/requirements";

export const ROOM_AREA_POLICY_VERSION = "room-area-policy-v3.0.0" as const;

export type AreaFlexibilityClass = "fixed_service" | "normal" | "flexible_combined" | "parking" | "outdoor";

export type ResolvedRoomAreaPolicy = {
  requirementId: string;
  roomType: RoomType;
  flexibilityClass: AreaFlexibilityClass;
  minimumAreaMm2: number;
  effectiveTargetAreaMm2: number;
  warningMaximumAreaMm2: number;
  hardMaximumAreaMm2: number;
};

const FIXED_SERVICE = new Set<RoomType>(["bathroom", "utility", "store", "pooja", "foyer"]);
const NORMAL = new Set<RoomType>(["bedroom", "kitchen", "study"]);
const FLEXIBLE = new Set<RoomType>(["living", "dining", "circulation", "stair", "courtyard", "terrace"]);

function roundArea(value: number) {
  return Math.round(value);
}

function outdoorRequirement(requirements: CurrentBuildingRequirements, room: RoomRequirement) {
  return requirements.outdoorAreas.find((outdoor) => outdoor.floorId === room.floorId && outdoor.type === room.type);
}

export function resolveRoomAreaPolicy(input: {
  requirements: CurrentBuildingRequirements;
  room: RoomRequirement;
  usableFloorAreaMm2: number;
}): ResolvedRoomAreaPolicy {
  const { requirements, room, usableFloorAreaMm2 } = input;
  if (room.type === "parking") {
    const userTarget = requirements.parking.targetAreaMm2 ?? room.targetAreaMm2;
    const effectiveTargetAreaMm2 = Math.max(userTarget, requirements.parking.vehicleCount * 15_000_000);
    return {
      requirementId: room.id,
      roomType: room.type,
      flexibilityClass: "parking",
      minimumAreaMm2: Math.max(room.minAreaMm2, requirements.parking.minimumAreaMm2 ?? 0),
      effectiveTargetAreaMm2,
      warningMaximumAreaMm2: roundArea(effectiveTargetAreaMm2 * 1.25),
      hardMaximumAreaMm2: Math.min(
        roundArea(effectiveTargetAreaMm2 * 1.5),
        requirements.parking.maximumAreaMm2 ?? Number.POSITIVE_INFINITY,
      ),
    };
  }
  if (room.type === "balcony" || room.type === "verandah") {
    const outdoor = outdoorRequirement(requirements, room);
    if (!outdoor) return {
      requirementId: room.id,
      roomType: room.type,
      flexibilityClass: "outdoor",
      minimumAreaMm2: 0,
      effectiveTargetAreaMm2: 0,
      warningMaximumAreaMm2: 0,
      hardMaximumAreaMm2: 0,
    };
    const derivedTarget = Math.max(6_000_000, Math.min(12_000_000, roundArea(usableFloorAreaMm2 * 0.08)));
    const effectiveTargetAreaMm2 = outdoor.targetAreaMm2 ?? derivedTarget;
    return {
      requirementId: room.id,
      roomType: room.type,
      flexibilityClass: "outdoor",
      minimumAreaMm2: outdoor.minimumAreaMm2 ?? room.minAreaMm2,
      effectiveTargetAreaMm2,
      warningMaximumAreaMm2: roundArea(effectiveTargetAreaMm2 * 1.5),
      hardMaximumAreaMm2: Math.min(
        outdoor.maximumAreaMm2 ?? Number.POSITIVE_INFINITY,
        roundArea(effectiveTargetAreaMm2 * 2),
        roundArea(usableFloorAreaMm2 * 0.15),
      ),
    };
  }
  if (FIXED_SERVICE.has(room.type)) {
    return {
      requirementId: room.id,
      roomType: room.type,
      flexibilityClass: "fixed_service",
      minimumAreaMm2: room.minAreaMm2,
      effectiveTargetAreaMm2: room.targetAreaMm2,
      warningMaximumAreaMm2: roundArea(room.targetAreaMm2 * 1.25),
      hardMaximumAreaMm2: Math.max(roundArea(room.targetAreaMm2 * 1.5), room.targetAreaMm2 + 4_000_000),
    };
  }
  if (NORMAL.has(room.type)) {
    return {
      requirementId: room.id,
      roomType: room.type,
      flexibilityClass: "normal",
      minimumAreaMm2: room.minAreaMm2,
      effectiveTargetAreaMm2: room.targetAreaMm2,
      warningMaximumAreaMm2: roundArea(room.targetAreaMm2 * 1.3),
      hardMaximumAreaMm2: roundArea(room.targetAreaMm2 * 1.6),
    };
  }
  if (!FLEXIBLE.has(room.type)) throw new Error(`ROOM_AREA_POLICY_UNSUPPORTED:${room.type}`);
  return {
    requirementId: room.id,
    roomType: room.type,
    flexibilityClass: "flexible_combined",
    minimumAreaMm2: room.minAreaMm2,
    effectiveTargetAreaMm2: room.targetAreaMm2,
    warningMaximumAreaMm2: roundArea(room.targetAreaMm2 * 1.4),
    hardMaximumAreaMm2: roundArea(room.targetAreaMm2 * 1.75),
  };
}

export function floorAreaPolicies(requirements: CurrentBuildingRequirements, floorId: string, usableFloorAreaMm2: number) {
  return requirements.rooms
    .filter((room) => room.floorId === floorId)
    .map((room) => resolveRoomAreaPolicy({ requirements, room, usableFloorAreaMm2 }));
}
