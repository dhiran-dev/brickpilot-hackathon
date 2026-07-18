import { describe, expect, test } from "bun:test";

import { createCurrentRequirements, DEFAULT_INTAKE_DRAFT } from "@/components/guided-intake/model";
import { AiProviderError } from "@/lib/ai/client";
import { BUILDING_FIXTURES } from "@/lib/building/fixtures";
import { REFERENCE_ARTICULATED_SLOPED_REQUIREMENTS } from "@/lib/building/fixtures/reference-articulated-sloped";
import { currentBuildingRequirementsSchema } from "@/lib/building/requirements";
import { estimateBuildingCost } from "@/lib/cost/estimate";
import { classifyReadablePersistedStudy } from "@/lib/design/persisted-study";
import {
  DesignPipelineContractError,
  runDesignPipeline,
  runDesignPipelineForContract,
  runDesignPipelineV2,
} from "@/lib/server/design-pipeline";
import { validateV3SchemeStage } from "@/lib/validation/validate-v3";

const requirements = BUILDING_FIXTURES[0].requirements;

function exactReferenceV3Requirements() {
  const legacy = REFERENCE_ARTICULATED_SLOPED_REQUIREMENTS;
  const parking = legacy.rooms.find((room) => room.type === "parking")!;
  return currentBuildingRequirementsSchema.parse({
    ...legacy,
    requirementSchemaVersion: 3,
    entry: { primarySide: { value: "south", source: "user" }, secondaryEntry: { value: "auto", source: "default" }, primaryDoorClearWidthMm: 1200 },
    parking: { vehicleCount: 1, targetAreaMm2: parking.targetAreaMm2, minimumAreaMm2: parking.minAreaMm2, maximumAreaMm2: parking.targetAreaMm2 * 1.5, preferredSide: { value: "south", source: "user" } },
    outdoorAreas: legacy.rooms.filter((room) => room.type === "balcony" || room.type === "verandah").map((room) => ({
      id: `outdoor-${room.id}`, floorId: room.floorId, type: room.type, targetAreaMm2: room.targetAreaMm2, minimumAreaMm2: room.minAreaMm2, maximumAreaMm2: room.targetAreaMm2 * 2, source: "user",
    })),
    courtyard: { value: "open_to_sky", source: "user" },
    roof: { value: "sloped", source: "user" },
    shadeStructures: [{ id: "upper-open-pergola", type: "open_pergola", location: "terrace", targetAreaM2: 7, source: "user" }],
    aboveParkingUse: { value: "occupied_rooms", source: "user" },
    maxExteriorPedestrianEntryCount: 2,
  });
}

describe("runDesignPipeline", () => {
  test("keeps the historical entry point pinned to v2 and dispatches v2 explicitly", async () => {
    expect(runDesignPipeline).toBe(runDesignPipelineV2);
    const result = await runDesignPipelineForContract("v2", requirements, {
      reviewComplete: async () => ({ concurs: true, confidence: "high", citedConcerns: [], requirementDeltas: [] }),
    });
    expect(result.status).toBe("generated");
    if (result.status !== "generated") throw new Error("expected generated");
    expect(result.building.buildingSchemaVersion).toBe(2);
    expect(result.intent).toMatchObject({ requirementSchemaVersion: 2, buildingSchemaVersion: 2 });
    expect(result.selectedSchemeId).toBe(result.schemes[0].schemeId);
  });

  test("rejects contract mismatches and promotes only an authoritative selected v3 scheme", async () => {
    await expect(runDesignPipelineForContract("v2", { requirementSchemaVersion: 3 })).rejects.toMatchObject({
      name: "DesignPipelineContractError",
      code: "REQUIREMENTS_CONTRACT_MISMATCH",
    });
    await expect(runDesignPipelineForContract("v3", { requirementSchemaVersion: 3 })).rejects.toMatchObject({
      name: "DesignPipelineContractError",
      code: "REQUIREMENTS_CONTRACT_MISMATCH",
    });
    let reviewCalls = 0;
    const stageOrder: string[] = [];
    const currentRequirements = createCurrentRequirements(DEFAULT_INTAKE_DRAFT);
    const current = await runDesignPipelineForContract("v3", currentRequirements, {
      v3ValidateSchemes: (...args) => {
        stageOrder.push("validation");
        return validateV3SchemeStage(...args);
      },
      v3EstimateCost: (...args) => {
        stageOrder.push("cost");
        return estimateBuildingCost(...args);
      },
      reviewComplete: async () => {
        stageOrder.push("review");
        reviewCalls += 1;
        return { concurs: true, confidence: "high", citedConcerns: [], requirementDeltas: [] };
      },
    });
    expect(current.status).toBe("generated");
    if (current.status !== "generated") throw new Error(`expected generated v3 result, received ${current.code}`);
    expect(current).toMatchObject({
        requirementSchemaVersion: 3,
        physicalContractVersion: "physical-stage-v3",
        validationContractVersion: "validation-stage-v3",
        building: { buildingSchemaVersion: 3 },
        validation: { schemaVersion: "validation-report-v3", valid: true },
        costEstimate: { estimateSchemaVersion: 1 },
        aiReview: { status: "reviewed" },
        intent: { buildingSchemaVersion: 3, physicalContractVersion: "physical-stage-v3", validationContractVersion: "validation-stage-v3" },
    });
    expect(current.schemes.length).toBeGreaterThan(0);
    const selected = current.schemes.find((scheme) => scheme.schemeId === current.selectedSchemeId);
    expect(selected?.building.candidate.geometryHash).toBe(current.building.candidate.geometryHash);
    expect(selected?.validation).toEqual(current.validation);
    expect(current.diagnostics.validation.acceptedSchemeCount).toBe(current.schemes.length);
    expect(reviewCalls).toBe(1);
    expect(stageOrder).toEqual(["validation", "cost", "review"]);
    expect(classifyReadablePersistedStudy({
      projectId: "project-v3-pipeline",
      designId: "design-v3-pipeline",
      version: 1,
      title: "Generated v3 pipeline",
      status: "completed",
      createdAt: new Date("2026-07-18T00:00:00.000Z"),
      requirements: currentRequirements,
      building: current.building,
      validation: current.validation,
      costEstimate: current.costEstimate,
      aiReview: current.aiReview,
      intent: current.intent,
      schemes: current.schemes,
      selectedSchemeId: current.selectedSchemeId,
    }).compatible).toBe(true);
  });

  test("does not call v3 cost or review before authoritative hard validation succeeds", async () => {
    const currentRequirements = createCurrentRequirements(DEFAULT_INTAKE_DRAFT);
    let costCalled = false;
    let reviewCalled = false;
    const result = await runDesignPipelineForContract("v3", currentRequirements, {
      v3ValidateSchemes: (schemes, requirements, options) => validateV3SchemeStage(schemes.map((scheme) => ({
        ...scheme,
        building: { ...scheme.building, roofSupportReferences: [] },
      })), requirements, options),
      v3EstimateCost: (...args) => {
        costCalled = true;
        return estimateBuildingCost(...args);
      },
      reviewComplete: async () => {
        reviewCalled = true;
        return { concurs: true, confidence: "high", citedConcerns: [], requirementDeltas: [] };
      },
    });
    expect(result.status).toBe("failed");
    expect(costCalled).toBe(false);
    expect(reviewCalled).toBe(false);
  });

  test("keeps an authoritative v3 result when the advisory reviewer is unavailable", async () => {
    const result = await runDesignPipelineForContract("v3", createCurrentRequirements(DEFAULT_INTAKE_DRAFT), {
      reviewComplete: async () => { throw new AiProviderError("timeout", "timed out"); },
    });
    expect(result.status).toBe("generated");
    if (result.status !== "generated") throw new Error("expected generated v3 result");
    expect(result.validation.valid).toBe(true);
    expect(result.aiReview).toEqual({ status: "unavailable", reason: "timeout" });
    expect(result.costEstimate).toMatchObject({ estimateSchemaVersion: 1 });
  });

  test("runs the exact three-floor reference through a hard-valid production pipeline", async () => {
    const brief = exactReferenceV3Requirements();
    const result = await runDesignPipelineForContract("v3", brief, {
      reviewComplete: async () => ({ concurs: true, confidence: "high", citedConcerns: [], requirementDeltas: [] }),
    });
    expect(result.status).toBe("generated");
    if (result.status !== "generated") throw new Error(`expected exact reference to generate, received ${result.code}`);
    expect(result.validation.valid).toBe(true);
    expect(result.validation.findings.filter((finding) => finding.severity === "error")).toEqual([]);
    expect(result.building.floors.flatMap((floor) => floor.spaces).filter((space) => space.type === "stair")).toHaveLength(3);
    expect(result.building.verticalConnectors).toHaveLength(1);
    const connector = result.building.verticalConnectors[0];
    expect(connector.servedFloorIds).toEqual(["F0", "F1", "F2"]);
    expect(new Set(Object.values(connector.boundsByFloor).map((bounds) => JSON.stringify(bounds))).size).toBe(1);
    const windows = result.building.floors.flatMap((floor) => floor.openings).filter((opening) => opening.kind === "window" && opening.usage === "daylight");
    expect(windows.length).toBeGreaterThan(0);
    for (const room of brief.rooms.filter((candidate) => candidate.mustBeExterior && !["parking", "balcony", "verandah", "courtyard", "terrace", "circulation", "stair"].includes(candidate.type))) {
      expect(windows.some((window) => window.floorId === room.floorId && window.connects.includes(room.id) && window.connects.includes("EXTERIOR"))).toBe(true);
    }
    expect(result.validation.findings.some((finding) => finding.ruleId === "SUPPORT_CLEARANCE_CONFLICT")).toBe(false);
  });

  test("returns deterministic evidence, cost and a reviewed result", async () => {
    let reviewCalls = 0;
    const result = await runDesignPipeline(requirements, {
      reviewComplete: async () => {
        reviewCalls += 1;
        return { concurs: true, confidence: "high", citedConcerns: [], requirementDeltas: [] };
      },
    });
    expect(result.status).toBe("generated");
    if (result.status !== "generated") throw new Error("expected generated");
    expect(result.validation.valid).toBe(true);
    expect(result.aiReview.status).toBe("reviewed");
    expect(result.schemes.length).toBeGreaterThan(0);
    expect(result.schemes.length).toBeLessThanOrEqual(3);
    expect(result.selectedSchemeId).toBe(result.schemes[0].schemeId);
    expect(result.building.candidate.geometryHash).toBe(result.schemes[0].building.candidate.geometryHash);
    expect(result.intent.generationDiagnostics).toEqual(result.diagnostics);
    expect(result.diagnostics.constructedCandidateCount).toBeLessThanOrEqual(result.diagnostics.plannedCandidateCount);
    expect(result.diagnostics.quotaUsage.some((usage) => usage.attempted > 0)).toBe(true);
    expect(reviewCalls).toBe(1);
  });

  test("fails open when the advisory provider times out", async () => {
    const result = await runDesignPipeline(requirements, {
      reviewComplete: async () => { throw new AiProviderError("timeout", "timed out"); },
    });
    expect(result.status).toBe("generated");
    if (result.status !== "generated") throw new Error("expected generated");
    expect(result.aiReview).toEqual({ status: "unavailable", reason: "timeout" });
  });

  test("does not call the reviewer when deterministic generation fails", async () => {
    const impossible = {
      ...requirements,
      rooms: requirements.rooms.map((room) => ({ ...room, minAreaMm2: room.minAreaMm2 * 50, targetAreaMm2: room.targetAreaMm2 * 50 })),
    };
    let reviewCalled = false;
    const result = await runDesignPipeline(impossible, {
      reviewComplete: async () => {
        reviewCalled = true;
        return { concurs: true, confidence: "high", citedConcerns: [], requirementDeltas: [] };
      },
    });
    expect(result.status).toBe("failed");
    expect(reviewCalled).toBe(false);
  });
});
