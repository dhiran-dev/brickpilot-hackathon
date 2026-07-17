import { describe, expect, test } from "bun:test";

import { candidateRoom, reservedRegionConflicts, type ReservedRegion } from "@/lib/building/candidates/types";
import type { RoomRequirement } from "@/lib/building/requirements";

const base: RoomRequirement = {
  id: "room",
  name: "Room",
  type: "bedroom",
  floorId: "F1",
  minAreaMm2: 9_000_000,
  targetAreaMm2: 12_000_000,
  privacy: "private",
  preferredZone: "any",
  mustBeExterior: true,
  accessible: false,
};

describe("parti reserved regions", () => {
  test("allows the exact semantic void but rejects an occupied intrusion", () => {
    const region: ReservedRegion = {
      id: "court",
      sourceFloorId: "F0",
      kind: "court_void",
      buildability: "open_to_sky",
      bounds: { x: 4_000, y: 8_000, width: 3_000, depth: 3_000 },
    };
    const voidCell = { ...candidateRoom({ ...base, id: "void", type: "courtyard" }, region.bounds), occupied: false };
    expect(reservedRegionConflicts([voidCell], [region])).toEqual([]);

    const room = candidateRoom(base, { x: 3_000, y: 8_000, width: 2_000, depth: 3_000 });
    expect(reservedRegionConflicts([voidCell, room], [region])).toEqual([{ regionId: "court", cellId: "room" }]);
  });
});
