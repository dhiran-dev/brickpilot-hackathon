import { describe, expect, test } from "bun:test";

import type { BuildingRequirements } from "@/lib/building/requirements";
import { rectanglePolygon, type Building, type Floor, type Opening, type Space } from "@/lib/building/schema";
import { buildCanonicalWalls } from "@/lib/building/topology";
import { validateBuilding } from "@/lib/validation/validate";

function linearBuilding(types: [Space["type"], Space["type"], Space["type"]]): Building {
  const spaces: Space[] = types.map((type, index) => ({
    id: `${type}-${index}`,
    floorId: "F0",
    name: `${type[0].toUpperCase()}${type.slice(1)} ${index + 1}`,
    type,
    planningCellPolygon: rectanglePolygon({ x: index * 3000, y: 0, width: 3000, depth: 3000 }),
    bounds: { x: index * 3000, y: 0, width: 3000, depth: 3000 },
    areaMm2: 9_000_000,
    occupied: true,
    accessible: false,
  }));
  const envelope = { x: 0, y: 0, width: 9000, depth: 3000 };
  const walls = buildCanonicalWalls("F0", envelope, spaces);
  const exteriorWall = walls.find((wall) => wall.adjacentSpaceIds.length === 1 && wall.adjacentSpaceIds.includes(spaces[0].id) && wall.start.x === 0);
  const firstWall = walls.find((wall) => wall.adjacentSpaceIds.includes(spaces[0].id) && wall.adjacentSpaceIds.includes(spaces[1].id));
  const secondWall = walls.find((wall) => wall.adjacentSpaceIds.includes(spaces[1].id) && wall.adjacentSpaceIds.includes(spaces[2].id));
  if (!exteriorWall || !firstWall || !secondWall) throw new Error("Fixture walls were not generated.");
  const opening = (id: string, wallId: string, connects: [string, string]): Opening => ({
    id,
    floorId: "F0",
    wallId,
    kind: "door",
    offsetMm: 1000,
    widthMm: 900,
    heightMm: 2100,
    sillHeightMm: 0,
    connects,
    hinge: "start",
    swing: "clockwise",
  });
  const floor: Floor = {
    id: "F0",
    label: "Ground",
    level: 0,
    elevationMm: 0,
    floorHeightMm: 3000,
    envelope,
    spaces,
    walls,
    openings: [
      opening("entry", exteriorWall.id, ["EXTERIOR", spaces[0].id]),
      opening("door-1", firstWall.id, [spaces[0].id, spaces[1].id]),
      opening("door-2", secondWall.id, [spaces[1].id, spaces[2].id]),
    ],
  };
  return {
    buildingSchemaVersion: 2,
    algorithmVersion: "test",
    rulePackVersion: "test",
    rendererVersion: "test",
    seed: 1,
    candidate: { generatorId: "test", index: 0, score: 0, geometryHash: "test" },
    site: { widthMm: 9000, depthMm: 3000, facing: "north", roadEdges: ["west"], buildableEnvelope: envelope },
    floors: [floor],
    verticalConnectors: [],
  };
}

describe("architecture-aware circulation validation", () => {
  test("rejects a destination that can only be reached through a private room", () => {
    const building = linearBuilding(["foyer", "bedroom", "study"]);
    const report = validateBuilding(building);
    const conflict = report.findings.find((item) => item.ruleId === "CIRCULATION_PRIVACY_CONFLICT" && item.objectIds[0] === "study-2");

    expect(report.valid).toBe(false);
    expect(conflict?.severity).toBe("error");
    expect(conflict?.message).toContain("only reachable through Bedroom 2");
    expect(conflict?.suggestedAction).toContain("foyer, circulation space, living area or dining area");
  });

  test("rejects bedroom access through a kitchen or another service room", () => {
    for (const passageType of ["kitchen", "utility", "bathroom"] as const) {
      const building = linearBuilding(["foyer", passageType, "bedroom"]);
      const report = validateBuilding(building);
      const conflict = report.findings.find((item) =>
        item.ruleId === "CIRCULATION_PRIVACY_CONFLICT" && item.objectIds[0] === "bedroom-2",
      );
      expect(conflict?.severity).toBe("error");
      expect(conflict?.objectIds).toContain(`${passageType}-1`);
    }
  });

  test("does not treat a declared attached bathroom as a route conflict", () => {
    const building = linearBuilding(["foyer", "bedroom", "bathroom"]);
    const requirements = {
      rooms: [],
      relationships: [{ type: "must_connect", fromRoomId: "bedroom-1", toRoomId: "bathroom-2" }],
    } as unknown as BuildingRequirements;
    const report = validateBuilding(building, requirements);

    expect(report.findings.some((item) => item.ruleId === "CIRCULATION_PRIVACY_CONFLICT" && item.objectIds[0] === "bathroom-2")).toBe(false);
  });

  test("does not warn when a clean alternative route exists", () => {
    const building = linearBuilding(["foyer", "bedroom", "study"]);
    const floor = building.floors[0];
    const study = floor.spaces[2];
    const exteriorWall = floor.walls.find((wall) =>
      wall.adjacentSpaceIds.length === 1 && wall.adjacentSpaceIds.includes(study.id) && wall.start.x === 9000,
    );
    if (!exteriorWall) throw new Error("Study exterior wall was not generated.");
    floor.openings.push({
      id: "study-entry",
      floorId: "F0",
      wallId: exteriorWall.id,
      kind: "door",
      offsetMm: 1000,
      widthMm: 900,
      heightMm: 2100,
      sillHeightMm: 0,
      connects: ["EXTERIOR", study.id],
      hinge: "start",
      swing: "clockwise",
    });
    const report = validateBuilding(building);

    expect(report.findings.some((item) => item.ruleId === "CIRCULATION_PRIVACY_CONFLICT" && item.objectIds[0] === study.id)).toBe(false);
  });

  test("keeps unreachable rooms as a hard topology error rather than a route-quality warning", () => {
    const building = linearBuilding(["foyer", "living", "study"]);
    building.floors[0].openings = building.floors[0].openings.filter((opening) => opening.id !== "door-2");
    const report = validateBuilding(building);

    expect(report.valid).toBe(false);
    expect(report.findings.some((item) => item.ruleId === "CIRCULATION_REACHABLE" && item.objectIds.includes("study-2"))).toBe(true);
    expect(report.findings.some((item) => item.ruleId === "CIRCULATION_PRIVACY_CONFLICT" && item.objectIds[0] === "study-2")).toBe(false);
  });

  test("rejects a narrow generated open connection instead of treating a wall gap as circulation", () => {
    const building = linearBuilding(["foyer", "living", "study"]);
    const passage = building.floors[0].openings.find((opening) => opening.id === "door-1");
    if (!passage) throw new Error("Passage fixture is missing.");
    passage.kind = "open_connection";
    passage.widthMm = 699;
    passage.hinge = "none";
    passage.swing = "none";

    const report = validateBuilding(building);
    const widthFinding = report.findings.find((item) => item.ruleId === "OPENING_MIN_PASSAGE_WIDTH");

    expect(report.valid).toBe(false);
    expect(widthFinding?.severity).toBe("error");
    expect(widthFinding?.measured).toEqual({ value: 699, unit: "mm" });
    expect(widthFinding?.required).toEqual({ min: 700, unit: "mm" });
    expect(widthFinding?.suggestedAction).toContain("proper door or passage");
  });
});
