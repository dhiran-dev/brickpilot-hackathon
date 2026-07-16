import { describe, expect, test } from "bun:test";

import { createRequirements, DEFAULT_INTAKE_DRAFT } from "@/components/guided-intake/model";
import { generateBuilding } from "@/lib/building/generate";
import { STRUCTURAL_CONCEPT_DISCLAIMER } from "@/lib/building/structure";
import { validateBuilding } from "@/lib/validation";

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
