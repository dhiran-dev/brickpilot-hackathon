import { describe, expect, test } from "bun:test";

import { createRequirements, DEFAULT_INTAKE_DRAFT } from "@/components/guided-intake/model";
import { generateBuilding } from "@/lib/building/generate";
import { rectanglePolygon, type Floor, type Rectangle, type Space } from "@/lib/building/schema";
import { buildStructuralConcept, structuralColumnBounds, STRUCTURAL_CONCEPT_DISCLAIMER } from "@/lib/building/structure";
import { validateBuilding } from "@/lib/validation";

function structuralSpace(id: string, floorId: string, type: Space["type"], bounds: Rectangle): Space {
  return {
    id,
    floorId,
    name: id,
    type,
    planningCellPolygon: rectanglePolygon(bounds),
    bounds,
    areaMm2: bounds.width * bounds.depth,
    occupied: type !== "courtyard" && type !== "terrace",
    accessible: false,
  };
}

function boundaryVoidFloor(id: string, level: number, voidType: "courtyard" | "terrace"): Floor {
  return {
    id,
    label: `Floor ${level}`,
    level,
    elevationMm: level * 3_100,
    floorHeightMm: 3_100,
    envelope: { x: 0, y: 0, width: 9_000, depth: 9_000 },
    spaces: [
      structuralSpace(`${id}-west`, id, "living", { x: 0, y: 0, width: 4_500, depth: 9_000 }),
      structuralSpace(`${id}-north-east`, id, "bedroom", { x: 4_500, y: 0, width: 4_500, depth: 4_500 }),
      structuralSpace(`${id}-void`, id, voidType, { x: 4_500, y: 4_500, width: 4_500, depth: 4_500 }),
    ],
    walls: [{
      id: `${id}-court-edge`,
      floorId: id,
      start: { x: 4_500, y: 4_500 },
      end: { x: 4_500, y: 9_000 },
      thicknessMm: 230,
      type: "exterior",
      adjacentSpaceIds: [`${id}-west`, `${id}-void`],
    }],
    openings: [],
  };
}

function threeFloorStudy() {
  const requirements = createRequirements({
    ...DEFAULT_INTAKE_DRAFT,
    projectName: "Three-floor structural concept regression",
    floorCount: 3,
    liftProvision: true,
    formStrategy: "stepped_terraces",
    seed: 2871937447,
  });
  return { requirements, ...generateBuilding(requirements) };
}

describe("preliminary structural concept coordination", () => {
  test("omits a column whose footprint crosses an open-to-sky boundary", () => {
    for (const voidType of ["courtyard", "terrace"] as const) {
      const floors = [boundaryVoidFloor("F0", 0, voidType), boundaryVoidFloor("F1", 1, voidType)];
      const concept = buildStructuralConcept(floors);

      expect(concept.columns.some((column) => column.center.x === 4_500 && column.center.y === 4_500)).toBe(false);
      for (const column of concept.columns) {
        const bounds = structuralColumnBounds(column);
        expect(floors.every((floor) => floor.spaces
          .filter((space) => space.type === "courtyard" || space.type === "terrace")
          .every((space) => (
            Math.min(bounds.x + bounds.width, space.bounds.x + space.bounds.width) <= Math.max(bounds.x, space.bounds.x)
            || Math.min(bounds.y + bounds.depth, space.bounds.y + space.bounds.depth) <= Math.max(bounds.y, space.bounds.y)
          )))).toBe(true);
      }
    }
  });

  test("adds stable, continuous column stacks clear of stairs and openings", () => {
    const { building, validation } = threeFloorStudy();
    const concept = building.structuralConcept;
    expect(concept).toBeDefined();
    expect(concept?.disclaimer).toBe(STRUCTURAL_CONCEPT_DISCLAIMER);
    expect(concept?.columns.length).toBeGreaterThan(0);
    expect(concept?.axes.some((axis) => axis.direction === "x")).toBe(true);
    expect(concept?.axes.some((axis) => axis.direction === "y")).toBe(true);
    const floorIds = building.floors.map((floor) => floor.id);
    expect(concept?.columns.every((column) => floorIds.every((floorId) => column.servedFloorIds.includes(floorId)))).toBe(true);
    expect(validation.findings.some((finding) => finding.ruleId === "STRUCTURE_COLUMN_CLEARANCE" && finding.severity === "error")).toBe(false);
    expect(validation.valid).toBe(true);
  });

  test("rejects a discontinuous conceptual pillar stack before display", () => {
    const { building, requirements } = threeFloorStudy();
    const broken = structuredClone(building);
    const column = broken.structuralConcept?.columns[0];
    if (!column) throw new Error("Expected a conceptual column");
    column.servedFloorIds = ["F1", "F2"];
    const report = validateBuilding(broken, requirements);
    expect(report.valid).toBe(false);
    expect(report.findings).toContainEqual(expect.objectContaining({
      ruleId: "STRUCTURE_COLUMN_CONTINUOUS",
      severity: "error",
      category: "structure",
    }));
  });

  test("labels long bays as a coordination advisory, not structural approval", () => {
    const { building, requirements } = threeFloorStudy();
    const adjusted = structuredClone(building);
    if (!adjusted.structuralConcept) throw new Error("Expected a structural concept");
    adjusted.structuralConcept.axes = [
      { id: "grid-x-a", direction: "x", coordinateMm: 0 },
      { id: "grid-x-b", direction: "x", coordinateMm: 9000 },
    ];
    const finding = validateBuilding(adjusted, requirements).findings.find((item) => item.ruleId === "STRUCTURE_BAY_SPAN_BASELINE");
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("not a structural span calculation");
  });
});
