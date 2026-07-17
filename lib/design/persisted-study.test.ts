import { describe, expect, test } from "bun:test";

import { classifyPersistedStudy, type PersistedStudyRow } from "@/lib/design/persisted-study";

const requirements = {
  requirementSchemaVersion: 2,
  projectName: "Saved study",
  buildingType: "detached_house",
  region: { countryCode: "IN", adminArea: "Kerala", locality: "Kochi", locale: "en-IN", currency: "INR" },
  displayUnit: "metric",
  site: { widthMm: 12_000, depthMm: 18_000, facing: "south", roadEdges: ["south"], irregular: false, setbacksMm: { north: 1000, east: 1000, south: 1000, west: 1000 } },
  floors: [{ id: "F0", label: "Ground", level: 0, floorHeightMm: 3000 }],
  rooms: [{ id: "living", name: "Living", type: "living", floorId: "F0", minAreaMm2: 10_000_000, targetAreaMm2: 15_000_000, privacy: "public", preferredZone: "any", mustBeExterior: true, accessible: false }],
  relationships: [],
  household: { occupants: 2, accessibilityRequired: false },
  vertical: { stairFamily: "dog_leg", stairWidthMm: 1000, liftProvision: false },
  budget: { qualityTier: "standard", contingencyPercent: 7.5, taxPercent: 0 },
  seed: 42,
};

const building = {
  buildingSchemaVersion: 2,
  algorithmVersion: "test-v1",
  rulePackVersion: "rules-v1",
  rendererVersion: "cad-svg-v2",
  seed: 42,
  candidate: { generatorId: "fixture", index: 0, score: 100, geometryHash: "hash" },
  site: { widthMm: 12_000, depthMm: 18_000, facing: "south", roadEdges: ["south"], buildableEnvelope: { x: 1000, y: 1000, width: 10_000, depth: 16_000 } },
  floors: [{
    id: "F0", label: "Ground", level: 0, elevationMm: 0, floorHeightMm: 3000,
    envelope: { x: 1000, y: 1000, width: 10_000, depth: 16_000 },
    spaces: [{ id: "living", floorId: "F0", name: "Living", type: "living", planningCellPolygon: { points: [{ x: 1000, y: 1000 }, { x: 11_000, y: 1000 }, { x: 11_000, y: 17_000 }, { x: 1000, y: 17_000 }] }, bounds: { x: 1000, y: 1000, width: 10_000, depth: 16_000 }, areaMm2: 160_000_000, occupied: true, accessible: false }],
    walls: [], openings: [],
  }],
  verticalConnectors: [],
};

const validation = { rulePackVersion: "rules-v1", valid: true, score: 100, counts: { error: 0, warning: 0, info: 0 }, findings: [] };
const costEstimate = { estimateSchemaVersion: 1, generatedAt: "2026-07-16T00:00:00.000Z", currency: "INR", locale: "en-IN", warnings: [], status: "unavailable", confidence: "unavailable", reason: "no_rate_pack", improveConfidenceActions: [] };
const diagnostics = { watchdogMs: 8000, candidateCeiling: 3000, plannedCandidateCount: 16, constructedCandidateCount: 4, evaluatedCandidateCount: 3, quotaUsage: [{ partiId: "t_hub", rung: 0, relaxationId: "preferred", simplifiedCourt: false, quota: 1, attempted: 1 }] };
const row: PersistedStudyRow = { projectId: "project", designId: "design", version: 1, title: "Saved study", status: "completed", createdAt: new Date("2026-07-16T00:00:00.000Z"), requirements, building, validation, costEstimate, aiReview: null, intent: { generationDiagnostics: diagnostics } };

describe("persisted study compatibility", () => {
  test("returns only schema-valid completed payloads as openable", () => {
    const result = classifyPersistedStudy(row);
    expect(result.compatible).toBe(true);
    if (result.compatible) {
      expect(result.study.building?.buildingSchemaVersion).toBe(2);
      expect(result.study.schemes).toHaveLength(1);
      expect(result.study.selectedSchemeId).toBe(`legacy-${building.candidate.geometryHash}`);
      expect((result.study.intent as { generationDiagnostics: typeof diagnostics }).generationDiagnostics).toEqual(diagnostics);
    }
  });

  test("hydrates stored schemes and rejects a selected id outside the payload", () => {
    const scheme = {
      schemeId: "scheme-a",
      partiId: "t_hub",
      name: "T Hub · Scheme A",
      rationale: "A short public hub keeps every room within two cells of circulation.",
      building,
      validation,
      evidence: ["Entry meets the road edge."],
      ladderRung: 0,
    };
    expect(classifyPersistedStudy({ ...row, schemes: [scheme], selectedSchemeId: "scheme-a" })).toMatchObject({
      compatible: true,
      study: { selectedSchemeId: "scheme-a", schemes: [{ schemeId: "scheme-a" }] },
    });
    expect(classifyPersistedStudy({ ...row, schemes: [scheme], selectedSchemeId: "missing" })).toMatchObject({
      compatible: false,
      study: { reason: "INVALID_SCHEMES" },
    });
    expect(classifyPersistedStudy({
      ...row,
      schemes: [{ ...scheme, schemeId: "scheme-b", building: { ...building, candidate: { ...building.candidate, geometryHash: "other" } } }],
      selectedSchemeId: "scheme-b",
    })).toMatchObject({ compatible: false, study: { reason: "INVALID_SCHEMES" } });
  });

  test("marks legacy building JSON instead of returning it as openable", () => {
    const result = classifyPersistedStudy({ ...row, building: { buildingSchemaVersion: 1 } });
    expect(result).toMatchObject({ compatible: false, study: { version: 1, compatibility: "legacy_incompatible", reason: "INVALID_BUILDING" } });
  });

  test("marks invalid requirements and keeps unfinished valid rows non-openable", () => {
    expect(classifyPersistedStudy({ ...row, requirements: { requirementSchemaVersion: 1 } })).toMatchObject({ compatible: false, study: { reason: "INVALID_REQUIREMENTS" } });
    const pending = classifyPersistedStudy({ ...row, status: "planning", building: { invalid: true } });
    expect(pending.compatible).toBe(true);
    if (pending.compatible) expect(pending.study.building).toBeNull();
  });

  test("round-trips valid stored reviews and rejects invalid review payloads", () => {
    const reviewed = classifyPersistedStudy({
      ...row,
      aiReview: { status: "reviewed", review: { concurs: true, confidence: "high", citedConcerns: [], requirementDeltas: [] } },
    });
    expect(reviewed).toMatchObject({ compatible: true, study: { aiReview: { status: "reviewed" } } });
    expect(classifyPersistedStudy({ ...row, aiReview: { status: "reviewed", review: { concurs: "yes" } } })).toMatchObject({
      compatible: false,
      study: { reason: "INVALID_AI_REVIEW" },
    });
  });
});
