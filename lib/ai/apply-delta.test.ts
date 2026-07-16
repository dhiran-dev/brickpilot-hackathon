import { describe, expect, test } from "bun:test";

import { applyRequirementDelta, InvalidRequirementDeltaError } from "@/lib/ai/apply-delta";
import { BUILDING_FIXTURES } from "@/lib/building/fixtures";

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
});
