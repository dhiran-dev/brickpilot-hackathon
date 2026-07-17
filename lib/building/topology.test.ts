import { describe, expect, test } from "bun:test";

import { entranceRoadSide } from "@/lib/building/topology";

describe("entranceRoadSide", () => {
  test("uses facing when it borders a road", () => {
    expect(entranceRoadSide({ facing: "south", roadEdges: ["south", "east"] })).toBe("south");
  });

  test("falls back to the first road edge when facing has no road", () => {
    expect(entranceRoadSide({ facing: "north", roadEdges: ["south"] })).toBe("south");
    expect(entranceRoadSide({ facing: "west", roadEdges: ["east", "north"] })).toBe("east");
  });

  test("degrades to facing when no road edges exist", () => {
    expect(entranceRoadSide({ facing: "east", roadEdges: [] })).toBe("east");
  });
});
