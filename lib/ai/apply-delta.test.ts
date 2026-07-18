import { describe, expect, test } from "bun:test";

import { applyRequirementDelta, InvalidRequirementDeltaError } from "@/lib/ai/apply-delta";
import { BUILDING_FIXTURES } from "@/lib/building/fixtures";
import { createCurrentRequirements, DEFAULT_INTAKE_DRAFT } from "@/components/guided-intake/model";

const requirements = BUILDING_FIXTURES[1].requirements;

describe("applyRequirementDelta", () => {
  test("resizes both room area targets by the bounded server factor", () => {
    const original = requirements.rooms.find((room) => room.id === "kitchen")!;
    const next = applyRequirementDelta(requirements, { op: "resize_room", roomId: "kitchen", resizeDirection: "increase", summary: "Bigger kitchen" });
    const updated = next.rooms.find((room) => room.id === "kitchen")!;
    expect(updated.targetAreaMm2).toBe(Math.round(original.targetAreaMm2 * 1.2));
    expect(updated.minAreaMm2).toBe(Math.round(original.minAreaMm2 * 1.2));
    expect(requirements.rooms.find((room) => room.id === "kitchen")?.targetAreaMm2).toBe(original.targetAreaMm2);
  });

  test("removes a room and its relationships", () => {
    const next = applyRequirementDelta(requirements, { op: "remove_room", roomId: "pooja", summary: "No pooja room" });
    expect(next.rooms.some((room) => room.id === "pooja")).toBe(false);
    expect(next.relationships.some((relation) => relation.fromRoomId === "pooja" || relation.toRoomId === "pooja")).toBe(false);
  });

  test("adds a room with server-owned area defaults", () => {
    const next = applyRequirementDelta(requirements, {
      op: "add_room",
      summary: "Add a study",
      newRoom: { id: "study-1", name: "Study", type: "study", floorId: "F0", privacy: "private" },
    });
    expect(next.rooms.find((room) => room.id === "study-1")).toMatchObject({ minAreaMm2: 7_000_000, targetAreaMm2: 10_000_000 });
  });

  test("rejects malformed or unknown targets", () => {
    expect(() => applyRequirementDelta(requirements, { op: "resize_room", roomId: "not-a-room", resizeDirection: "increase", summary: "x" })).toThrow(InvalidRequirementDeltaError);
    expect(() => applyRequirementDelta(requirements, { op: "add_room", summary: "x" } as never)).toThrow(InvalidRequirementDeltaError);
  });

  test("rejects a delta that removes the final bedroom", () => {
    const bedroom = requirements.rooms.find((room) => room.type === "bedroom")!;
    const rooms = requirements.rooms.filter((room) => room.type !== "bedroom" || room.id === bedroom.id);
    const roomIds = new Set(rooms.map((room) => room.id));
    const oneBedroom = { ...requirements, rooms, relationships: requirements.relationships.filter((relation) => roomIds.has(relation.fromRoomId) && roomIds.has(relation.toRoomId)) };
    expect(() => applyRequirementDelta(oneBedroom, { op: "remove_room", roomId: bedroom.id, summary: "Remove the bedroom" })).toThrow("at least one bedroom and one bathroom");
  });

  test("applies a v3 delta without changing additive intent or provenance", () => {
    const current = createCurrentRequirements({
      ...DEFAULT_INTAKE_DRAFT,
      roofCharacter: "sloped",
      includeCourtyard: true,
      includeVerandah: true,
      currentEntry: {
        primarySide: { value: "south", source: "user" },
        secondaryEntry: { value: "rear", source: "user" },
        primaryDoorClearWidthMm: 1400,
      },
      shadeStructures: [
        { id: "front-open-pergola", type: "open_pergola", location: "front_entry", targetAreaM2: 12, source: "user" },
        { id: "parking-canopy", type: "solid_canopy", location: "parking", targetAreaM2: 28, source: "inferred" },
      ],
      aboveParkingUse: { value: "occupied_rooms", source: "user" },
      maxExteriorPedestrianEntryCount: 1,
    });
    const immutableV3Intent = {
      entry: current.entry,
      parking: current.parking,
      outdoorAreas: current.outdoorAreas,
      courtyard: current.courtyard,
      roof: current.roof,
      shadeStructures: current.shadeStructures,
      aboveParkingUse: current.aboveParkingUse,
      maxExteriorPedestrianEntryCount: current.maxExteriorPedestrianEntryCount,
    };
    const kitchen = current.rooms.find((room) => room.type === "kitchen")!;

    const next = applyRequirementDelta(current, {
      op: "resize_room",
      roomId: kitchen.id,
      resizeDirection: "increase",
      summary: "Increase kitchen area",
    });

    expect(next.requirementSchemaVersion).toBe(3);
    expect({
      entry: next.entry,
      parking: next.parking,
      outdoorAreas: next.outdoorAreas,
      courtyard: next.courtyard,
      roof: next.roof,
      shadeStructures: next.shadeStructures,
      aboveParkingUse: next.aboveParkingUse,
      maxExteriorPedestrianEntryCount: next.maxExteriorPedestrianEntryCount,
    }).toEqual(immutableV3Intent);
    expect(next.rooms.find((room) => room.id === kitchen.id)?.targetAreaMm2).toBe(Math.round(kitchen.targetAreaMm2 * 1.2));
  });

  test("rejects a v3 room removal that conflicts with immutable parking intent", () => {
    const current = createCurrentRequirements(DEFAULT_INTAKE_DRAFT);
    const parking = current.rooms.find((room) => room.type === "parking")!;

    expect(() => applyRequirementDelta(current, {
      op: "remove_room",
      roomId: parking.id,
      summary: "Remove parking",
    })).toThrow(InvalidRequirementDeltaError);
    expect(current.parking.vehicleCount).toBe(1);
  });
});
