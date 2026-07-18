import { describe, expect, test } from "bun:test";

import { createCurrentRequirements, DEFAULT_INTAKE_DRAFT } from "@/components/guided-intake/model";
import {
  currentBuildingRequirementsSchema,
  legacyBuildingRequirementsSchema,
  readableBuildingRequirementsSchema,
} from "@/lib/building/requirements";
import {
  buildingContractVersion,
  currentBuildingSchema,
  orthogonalPolygonSchema,
  readCanonicalBuilding,
  readableBuildingSchema,
} from "@/lib/building/schema";
import { V3_GEOMETRY_POLICY_VERSION } from "@/lib/building/v3-constants";
import { classifyReadablePersistedStudy } from "@/lib/design/persisted-study";
import { readableValidationReportSchema, validationReportV3Schema } from "@/lib/validation/types";

const clockwiseRectangle = {
  points: [
    { x: 0, y: 0 },
    { x: 0, y: 4000 },
    { x: 5000, y: 4000 },
    { x: 5000, y: 0 },
  ],
};

function currentBuildingFixture() {
  return {
    buildingSchemaVersion: 3 as const,
    geometryPolicyVersion: V3_GEOMETRY_POLICY_VERSION,
    algorithmVersion: "parti-v3-test",
    rulePackVersion: "rules-v3-test",
    rendererVersion: "renderer-v3-test",
    seed: 42,
    candidate: { generatorId: "compact-v3", index: 0, score: 90, geometryHash: "v3-geometry-hash" },
    site: {
      widthMm: 12000,
      depthMm: 18000,
      facing: "south" as const,
      roadEdges: ["south" as const],
      buildableEnvelope: { x: 0, y: 0, width: 5000, depth: 4000 },
    },
    floors: [{
      id: "F0",
      label: "Ground floor",
      level: 0,
      elevationMm: 0,
      floorHeightMm: 3100,
      envelope: clockwiseRectangle,
      regions: [{ id: "region-living", kind: "interior" as const, polygon: clockwiseRectangle, spaceId: "living" }],
      spaces: [{ id: "living", floorId: "F0", name: "Living", type: "living" as const, regionId: "region-living", accessible: false }],
      walls: [{
        id: "wall-south",
        floorId: "F0",
        start: { x: 0, y: 0 },
        end: { x: 5000, y: 0 },
        thicknessMm: 230,
        type: "exterior" as const,
        adjacentSpaceIds: ["living"],
      }],
      openings: [{
        id: "door-main",
        floorId: "F0",
        wallId: "wall-south",
        kind: "door" as const,
        usage: "pedestrian" as const,
        role: "main_entry" as const,
        materialToken: "main-entry-walnut",
        offsetMm: 1200,
        widthMm: 1200,
        heightMm: 2400,
        sillHeightMm: 0,
        connects: ["outside", "living"] as [string, string],
        hinge: "start" as const,
        swing: "clockwise" as const,
      }],
    }],
    verticalConnectors: [],
    structuralConcept: {
      structuralConceptVersion: 1 as const,
      scope: "conceptual_column_coordination_only" as const,
      disclaimer: "Conceptual column coordination only; member sizing, loads, foundations and code compliance require a licensed structural engineer." as const,
      baselineMaxBayMm: 6000,
      axes: [],
      columns: [{ id: "column-1", center: { x: 0, y: 0 }, widthMm: 300, depthMm: 300, servedFloorIds: ["F0"] }],
    },
    roofSystems: [{
      id: "roof-main",
      servesSpaceIds: ["living"],
      footprint: clockwiseRectangle,
      kind: "flat_slab" as const,
      planes: [{
        id: "roof-plane-main",
        vertices: [
          { x: 0, y: 0, z: 3100 },
          { x: 0, y: 4000, z: 3100 },
          { x: 5000, y: 4000, z: 3100 },
          { x: 5000, y: 0, z: 3100 },
        ],
      }],
      eaveHeightMm: 3100,
      overhangMm: 450,
    }],
    secondaryRoofSupports: [],
    roofSupportReferences: [{
      roofSystemId: "roof-main",
      bearingLines: [{
        id: "bearing-south",
        segment: { start: { x: 0, y: 0 }, end: { x: 5000, y: 0 } },
        role: "perimeter" as const,
        bearingWallIds: ["wall-south"],
        structuralColumnIds: [],
        secondarySupportIds: [],
      }],
    }],
    edgeProtections: [],
    facadeZones: [{
      side: "south" as const,
      exteriorWallIds: ["wall-south"],
      articulationPolygons: [],
      role: "primary_road_elevation" as const,
      containsMainEntry: true,
      allowedMaterialArticulation: ["earthy-texture"],
    }],
    intentRealizations: [{
      requirementPath: "entry.primarySide",
      requestedValue: "south",
      realizedObjectIds: ["door-main", "wall-south"],
      status: "realized" as const,
    }],
  };
}

describe("schema-v3 contracts", () => {
  test("round-trips v3 requirements without widening the frozen v2 mutation schema", () => {
    const requirements = createCurrentRequirements({
      ...DEFAULT_INTAKE_DRAFT,
      projectName: "V3 contract fixture",
      roofCharacter: "sloped",
      includeCourtyard: true,
    }, {
      shadeStructures: [{ id: "parking-pergola", type: "open_pergola", location: "parking", targetAreaM2: 18, source: "user" }],
      aboveParkingUse: { value: "occupied_rooms", source: "user" },
    });
    expect(currentBuildingRequirementsSchema.parse(JSON.parse(JSON.stringify(requirements)))).toEqual(requirements);
    expect(readableBuildingRequirementsSchema.parse(requirements)).toEqual(requirements);
    expect(legacyBuildingRequirementsSchema.safeParse(requirements).success).toBe(false);
    expect(requirements.entry.primaryDoorClearWidthMm).toBe(1200);
    expect(requirements.shadeStructures[0]?.type).toBe("open_pergola");
  });

  test("round-trips canonical v3 building geometry and reports its version", () => {
    const fixture = currentBuildingFixture();
    const parsed = currentBuildingSchema.parse(JSON.parse(JSON.stringify(fixture)));
    expect(readableBuildingSchema.parse(parsed)).toEqual(parsed);
    expect(buildingContractVersion(parsed)).toBe("v3");
    expect(readCanonicalBuilding(parsed)).toMatchObject({
      success: true,
      data: { contractVersion: "v3", buildingSchemaVersion: 3, geometryHash: "v3-geometry-hash" },
    });
  });

  test("rejects non-orthogonal, counter-clockwise, and unsupported building contracts", () => {
    expect(orthogonalPolygonSchema.safeParse({ points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 500, y: 500 }, { x: 0, y: 1000 }] }).success).toBe(false);
    expect(orthogonalPolygonSchema.safeParse({ points: [...clockwiseRectangle.points].reverse() }).success).toBe(false);
    expect(buildingContractVersion({ buildingSchemaVersion: 4 })).toBeNull();
    expect(readCanonicalBuilding({ buildingSchemaVersion: 4 })).toEqual({
      success: false,
      reason: "UNSUPPORTED_BUILDING_VERSION",
      contractVersion: null,
    });
  });

  test("keeps validation reports explicitly versioned at the persisted read boundary", () => {
    const report = validationReportV3Schema.parse({
      schemaVersion: "validation-report-v3",
      rulePackVersion: "rules-v3-test",
      valid: false,
      score: 70,
      counts: { error: 1, warning: 0, info: 0 },
      findings: [{
        ruleId: "ROOF_SUPPORT_INCOMPLETE",
        ruleVersion: 1,
        severity: "error",
        category: "structure",
        objectIds: ["roof-main"],
        message: "Roof bearing coverage is incomplete.",
        sourceKind: "geometry",
      }],
    });
    expect(readableValidationReportSchema.parse(report)).toEqual(report);
    expect(readableValidationReportSchema.safeParse({ ...report, schemaVersion: "validation-report-v4" }).success).toBe(false);
  });

  test("classifies an in-progress v3 study without rewriting it as v2", () => {
    const requirements = createCurrentRequirements(DEFAULT_INTAKE_DRAFT);
    const classified = classifyReadablePersistedStudy({
      projectId: "project-v3",
      designId: "design-v3",
      version: 1,
      title: "Current study",
      status: "processing",
      createdAt: new Date("2026-07-18T00:00:00.000Z"),
      requirements,
      building: null,
      validation: null,
      costEstimate: null,
      aiReview: null,
    });
    expect(classified.compatible).toBe(true);
    if (classified.compatible) expect(classified.study.requirements.requirementSchemaVersion).toBe(3);
  });
});
