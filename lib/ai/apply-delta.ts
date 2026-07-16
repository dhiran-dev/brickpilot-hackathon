import { requirementDeltaSchema, type RequirementDelta } from "@/lib/ai/schema";
import { roomAreaDefaultsMm2 } from "@/lib/building/room-defaults";
import { buildingRequirementsSchema, hasMinimumResidentialRoomProgram, type BuildingRequirements } from "@/lib/building/requirements";

export class InvalidRequirementDeltaError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "InvalidRequirementDeltaError";
  }
}

const RESIZE_FACTOR = { increase: 1.2, decrease: 0.85 } as const;

function validateResult(value: BuildingRequirements) {
  const parsed = buildingRequirementsSchema.safeParse(value);
  if (!parsed.success) throw new InvalidRequirementDeltaError("The proposed change does not produce valid building requirements.", parsed.error);
  if (!hasMinimumResidentialRoomProgram(parsed.data)) throw new InvalidRequirementDeltaError("A residential brief must retain at least one bedroom and one bathroom.");
  return parsed.data;
}

export function applyRequirementDelta(requirements: BuildingRequirements, input: RequirementDelta): BuildingRequirements {
  const parsedDelta = requirementDeltaSchema.safeParse(input);
  if (!parsedDelta.success) throw new InvalidRequirementDeltaError("The AI suggestion is incomplete or malformed.", parsedDelta.error);
  const delta = parsedDelta.data;

  if (delta.op === "resize_room") {
    if (!requirements.rooms.some((room) => room.id === delta.roomId)) throw new InvalidRequirementDeltaError(`Unknown room id: ${delta.roomId}`);
    const factor = RESIZE_FACTOR[delta.resizeDirection];
    return validateResult({
      ...requirements,
      rooms: requirements.rooms.map((room) => room.id === delta.roomId
        ? { ...room, minAreaMm2: Math.round(room.minAreaMm2 * factor), targetAreaMm2: Math.round(room.targetAreaMm2 * factor) }
        : room),
    });
  }

  if (delta.op === "remove_room") {
    if (!requirements.rooms.some((room) => room.id === delta.roomId)) throw new InvalidRequirementDeltaError(`Unknown room id: ${delta.roomId}`);
    return validateResult({
      ...requirements,
      rooms: requirements.rooms.filter((room) => room.id !== delta.roomId),
      relationships: requirements.relationships.filter((relation) => relation.fromRoomId !== delta.roomId && relation.toRoomId !== delta.roomId),
    });
  }

  if (requirements.rooms.some((room) => room.id === delta.newRoom.id)) throw new InvalidRequirementDeltaError(`Room id already exists: ${delta.newRoom.id}`);
  return validateResult({
    ...requirements,
    rooms: [...requirements.rooms, {
      id: delta.newRoom.id,
      name: delta.newRoom.name,
      type: delta.newRoom.type,
      floorId: delta.newRoom.floorId,
      privacy: delta.newRoom.privacy,
      preferredZone: "any",
      mustBeExterior: false,
      accessible: false,
      ...roomAreaDefaultsMm2(delta.newRoom.type),
    }],
  });
}
