import { describe, expect, test } from "bun:test";

import { ROOM_AREAS, roomAreaDefaultsMm2 } from "@/lib/building/room-defaults";

describe("room area defaults", () => {
  test("returns the min/target area in mm2 for every room type", () => {
    const kitchen = roomAreaDefaultsMm2("kitchen");
    expect(kitchen.minAreaMm2).toBe(8_000_000);
    expect(kitchen.targetAreaMm2).toBe(12_000_000);
  });

  test("covers every room type used by the requirements schema", () => {
    const types = Object.keys(ROOM_AREAS);
    expect(types).toContain("courtyard");
    expect(types).toContain("terrace");
    expect(types.length).toBe(16);
  });
});
