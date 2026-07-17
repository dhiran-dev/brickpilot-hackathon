import { describe, expect, test } from "bun:test";

import type { BuildingRequirements } from "@/lib/building/requirements";
import type { Building } from "@/lib/building/schema";
import type { CostEstimate } from "@/lib/cost/schema";
import { studyToDesignResult, type RecentStudy } from "@/lib/design/study-result";
import type { ValidationReport } from "@/lib/validation";

function studyFixture(overrides: Partial<RecentStudy> = {}): RecentStudy {
  return {
    projectId: "project-1",
    designId: "design-1",
    version: 3,
    title: "Courtyard house",
    status: "completed",
    createdAt: "2026-07-17T00:00:00.000Z",
    requirements: { rooms: [] } as unknown as BuildingRequirements,
    building: { id: "building-1" } as unknown as Building,
    validation: { score: 92 } as unknown as ValidationReport,
    costEstimate: { status: "available" } as unknown as CostEstimate,
    aiReview: null,
    schemes: [],
    selectedSchemeId: "scheme-1",
    ...overrides,
  };
}

describe("studyToDesignResult", () => {
  test("maps a completed study into the workspace result shape", () => {
    const building = { id: "building-1" } as unknown as Building;
    const validation = { score: 92 } as unknown as ValidationReport;
    const costEstimate = { status: "available" } as unknown as CostEstimate;
    const result = studyToDesignResult(studyFixture({ building, validation, costEstimate }));

    expect(result).toMatchObject({
      projectId: "project-1",
      designId: "design-1",
      version: 3,
      title: "Courtyard house",
      selectedSchemeId: "scheme-1",
    });
    expect(result?.building).toBe(building);
    expect(result?.validation).toBe(validation);
    expect(result?.costEstimate).toBe(costEstimate);
  });

  test("refuses studies whose evidence is not complete yet", () => {
    expect(studyToDesignResult(studyFixture({ building: null }))).toBeNull();
    expect(studyToDesignResult(studyFixture({ validation: null }))).toBeNull();
    expect(studyToDesignResult(studyFixture({ costEstimate: null }))).toBeNull();
  });
});
