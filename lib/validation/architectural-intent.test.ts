import { describe, expect, test } from "bun:test";

import { createCurrentRequirements, DEFAULT_INTAKE_DRAFT } from "@/components/guided-intake/model";
import { currentBuildingRequirementsSchema, type CurrentBuildingRequirements } from "@/lib/building/requirements";
import { currentBuildingSchema, type CurrentBuilding } from "@/lib/building/schema";
import { V3_GEOMETRY_POLICY_VERSION } from "@/lib/building/v3-constants";
import { validateBuildingV3, validateSchemeSet, validateV3SchemeStage } from "@/lib/validation/validate-v3";

const envelope = { points: [
  { x: 1500, y: 1500 },
  { x: 1500, y: 4000 },
  { x: 3500, y: 4000 },
  { x: 3500, y: 1500 },
] };

function requirements(): CurrentBuildingRequirements {
  const base = createCurrentRequirements({
    ...DEFAULT_INTAKE_DRAFT,
    projectName: "WS8 reference rules",
    siteWidth: 6,
    siteDepth: 7,
    roadEdges: ["south"],
    facing: "south",
    setbacks: { north: 1.5, east: 2.5, south: 3, west: 1.5 },
    floorCount: 1,
    includeParking: false,
    includeUtility: false,
    includePooja: false,
    includeCourtyard: false,
    roofCharacter: "flat_parapet",
  });
  const foyer = base.rooms.find((room) => room.id === "foyer");
  if (!foyer) throw new Error("fixture foyer missing");
  return currentBuildingRequirementsSchema.parse({
    ...base,
    rooms: [foyer],
    relationships: [],
    entry: {
      primarySide: { value: "south", source: "user" },
      secondaryEntry: { value: "none", source: "user" },
      primaryDoorClearWidthMm: 1200,
    },
    parking: { vehicleCount: 0, preferredSide: { value: "south", source: "default" } },
    outdoorAreas: [],
    courtyard: { value: "none", source: "user" },
    roof: { value: "flat_parapet", source: "user" },
    shadeStructures: [],
    aboveParkingUse: { value: "unbuilt", source: "default" },
    maxExteriorPedestrianEntryCount: 1,
  });
}

function building(): CurrentBuilding {
  return currentBuildingSchema.parse({
    buildingSchemaVersion: 3,
    geometryPolicyVersion: V3_GEOMETRY_POLICY_VERSION,
    algorithmVersion: "ws8-reference-1",
    rulePackVersion: "concept-rulepack-v3",
    rendererVersion: "massing-v3-mesh-1",
    seed: 42,
    candidate: { generatorId: "compact_bar", index: 0, score: 100, geometryHash: "ws8-reference" },
    site: {
      widthMm: 6000,
      depthMm: 7000,
      facing: "south",
      roadEdges: ["south"],
      buildableEnvelope: { x: 1500, y: 1500, width: 2000, depth: 2500 },
    },
    floors: [{
      id: "F0",
      label: "Ground floor",
      level: 0,
      elevationMm: 0,
      floorHeightMm: 3100,
      envelope,
      regions: [{ id: "region-foyer", kind: "interior", polygon: envelope, spaceId: "foyer" }],
      spaces: [{ id: "foyer", floorId: "F0", name: "Entry foyer", type: "foyer", regionId: "region-foyer", accessible: false }],
      walls: [
        { id: "wall-north", floorId: "F0", start: { x: 3500, y: 1500 }, end: { x: 1500, y: 1500 }, thicknessMm: 230, type: "exterior", adjacentSpaceIds: ["foyer"] },
        { id: "wall-east", floorId: "F0", start: { x: 3500, y: 4000 }, end: { x: 3500, y: 1500 }, thicknessMm: 230, type: "exterior", adjacentSpaceIds: ["foyer"] },
        { id: "wall-south", floorId: "F0", start: { x: 1500, y: 4000 }, end: { x: 3500, y: 4000 }, thicknessMm: 230, type: "exterior", adjacentSpaceIds: ["foyer"] },
        { id: "wall-west", floorId: "F0", start: { x: 1500, y: 1500 }, end: { x: 1500, y: 4000 }, thicknessMm: 230, type: "exterior", adjacentSpaceIds: ["foyer"] },
      ],
      openings: [{
        id: "door-main",
        floorId: "F0",
        wallId: "wall-south",
        kind: "door",
        usage: "pedestrian",
        role: "main_entry",
        materialToken: "door.main-entry.warm-wood",
        offsetMm: 400,
        widthMm: 1200,
        heightMm: 2400,
        sillHeightMm: 0,
        connects: ["EXTERIOR", "foyer"],
        hinge: "start",
        swing: "clockwise",
      }],
    }],
    verticalConnectors: [],
    structuralConcept: {
      structuralConceptVersion: 1,
      scope: "conceptual_column_coordination_only",
      disclaimer: "Conceptual column coordination only; member sizing, loads, foundations and code compliance require a licensed structural engineer.",
      baselineMaxBayMm: 6000,
      axes: [],
      columns: [],
    },
    roofSystems: [{
      id: "roof-main",
      servesSpaceIds: ["foyer"],
      footprint: envelope,
      kind: "flat_slab",
      planes: [{ id: "roof-main-plane", vertices: [
        { x: 1500, y: 1500, z: 3100 },
        { x: 1500, y: 4000, z: 3100 },
        { x: 3500, y: 4000, z: 3100 },
        { x: 3500, y: 1500, z: 3100 },
      ] }],
      eaveHeightMm: 3100,
      overhangMm: 450,
    }],
    secondaryRoofSupports: [],
    roofSupportReferences: [{
      roofSystemId: "roof-main",
      bearingLines: [{
        id: "roof-main-bearing-south",
        segment: { start: { x: 1500, y: 4000 }, end: { x: 3500, y: 4000 } },
        role: "perimeter",
        bearingWallIds: ["wall-south"],
        structuralColumnIds: [],
        secondarySupportIds: [],
      }],
    }],
    edgeProtections: [],
    facadeZones: [{
      side: "south",
      exteriorWallIds: ["wall-south"],
      articulationPolygons: [],
      role: "primary_road_elevation",
      containsMainEntry: true,
      allowedMaterialArticulation: ["mineral.plaster", "timber.screen"],
    }],
    intentRealizations: [
      { requirementPath: "entry.primarySide", requestedValue: "south", realizedObjectIds: ["door-main", "wall-south"], status: "realized" },
      { requirementPath: "roof", requestedValue: "flat_parapet", realizedObjectIds: ["roof-main"], status: "realized" },
      { requirementPath: "courtyard", requestedValue: "none", realizedObjectIds: ["F0"], status: "realized" },
      { requirementPath: "aboveParkingUse", requestedValue: "unbuilt", realizedObjectIds: [], status: "relaxed", relaxationCode: "ABOVE_PARKING_NOT_APPLICABLE" },
      { requirementPath: "parking.preferredSide", requestedValue: "south", realizedObjectIds: [], status: "relaxed", relaxationCode: "PARKING_NOT_REQUESTED" },
    ],
  });
}

function codes(candidate: CurrentBuilding, brief = requirements()) {
  return new Set(validateBuildingV3(candidate, brief).findings.map((finding) => finding.ruleId));
}

describe("architectural-intent v3 reference rules", () => {
  test("accepts the complete one-floor reference and emits PII-free code metrics", () => {
    let metric: unknown;
    const validation = validateBuildingV3(building(), requirements(), { cohortId: "fixture-reference", onMetric: (value) => { metric = value; } });
    expect(validation).toMatchObject({ schemaVersion: "validation-report-v3", valid: true, score: 100, counts: { error: 0, warning: 0 } });
    expect(metric).toMatchObject({ event: "v3_validation_completed", cohortId: "fixture-reference", valid: true, countsByRuleCode: {} });
    expect(JSON.stringify(metric)).not.toContain("WS8 reference rules");
  });

  test("AREA_TARGET_EXCEEDED applies warning and hard bands and prevents 100/100", () => {
    const brief = requirements();
    brief.rooms[0] = { ...brief.rooms[0], minAreaMm2: 1_000_000, targetAreaMm2: 2_000_000 };
    const validation = validateBuildingV3(building(), brief);
    expect(codes(building(), brief)).toContain("AREA_TARGET_EXCEEDED");
    expect(validation.counts.warning).toBeGreaterThan(0);
    expect(validation.score).toBeLessThan(100);
  });

  test("SCHEME_NOT_DISTINCT uses the shared scheme-topology-v1 comparison", () => {
    const first = building();
    const duplicate = structuredClone(first);
    duplicate.candidate = {
      ...duplicate.candidate,
      generatorId: "t_hub",
      index: duplicate.candidate.index + 1,
      geometryHash: "duplicate-hash",
    };
    const result = validateSchemeSet([{ schemeId: "A", building: first }, { schemeId: "B", building: duplicate }]);
    expect(result.valid).toBe(false);
    expect(result.findings[0]).toMatchObject({ ruleId: "SCHEME_NOT_DISTINCT", severity: "error", sourceKind: "scheme_set" });
  });

  test("entry, exterior-count, privacy and vehicle rules inspect actual openings", () => {
    const missing = building();
    missing.floors[0].openings[0].role = "interior_door";
    expect(codes(missing)).toContain("MAIN_ENTRY_MISSING");

    const wrongRoad = building();
    wrongRoad.site.roadEdges = ["north"];
    expect(codes(wrongRoad)).toContain("MAIN_ENTRY_NOT_ROAD_SIDE");

    const narrow = building();
    narrow.floors[0].openings[0].widthMm = 900;
    expect(codes(narrow)).toContain("MAIN_ENTRY_TOO_NARROW");

    const extra = building();
    extra.floors[0].openings.push({ ...extra.floors[0].openings[0], id: "door-service", role: "service_entry", offsetMm: 50 });
    expect(codes(extra)).toContain("EXTERIOR_ENTRY_COUNT_EXCEEDED");

    const privateEntry = building();
    privateEntry.floors[0].spaces[0].type = "bedroom";
    expect(codes(privateEntry)).toContain("PRIVATE_ROOM_EXTERIOR_EXPOSURE");

    const parking = building();
    parking.floors[0].spaces[0].type = "parking";
    expect(codes(parking)).toContain("PARKING_VEHICLE_ACCESS_MISSING");
  });

  test("fails closed when an exterior-required enclosed room lacks a canonical daylight window", () => {
    const brief = requirements();
    brief.rooms[0] = { ...brief.rooms[0], mustBeExterior: true };
    expect(codes(building(), brief)).toContain("PLANNING_DAYLIGHT_INDICATION");

    const daylit = building();
    daylit.floors[0].openings.push({
      id: "window-foyer",
      floorId: "F0",
      wallId: "wall-west",
      kind: "window",
      usage: "daylight",
      materialToken: "window.general.standard",
      offsetMm: 700,
      widthMm: 700,
      heightMm: 1050,
      sillHeightMm: 1050,
      connects: ["EXTERIOR", "foyer"],
      hinge: "none",
      swing: "none",
    });
    expect(codes(daylit, brief)).not.toContain("PLANNING_DAYLIGHT_INDICATION");

    const internal = structuredClone(daylit);
    internal.floors[0].walls.find((wall) => wall.id === "wall-west")!.type = "interior";
    expect(codes(internal, brief)).toContain("WINDOW_EXTERIOR_ONLY");
  });

  test("roof rules enforce intent, plane geometry, site boundary and support completeness", () => {
    const sloped = requirements();
    sloped.roof = { value: "sloped", source: "user" };
    expect(codes(building(), sloped)).toContain("ROOF_INTENT_NOT_REALIZED");

    const invalidPlane = building();
    const roof = invalidPlane.roofSystems[0];
    if (roof.kind === "open_pergola") throw new Error("expected enclosure roof");
    roof.planes[0].vertices[3].z = 3500;
    expect(codes(invalidPlane)).toContain("ROOF_GEOMETRY_INVALID");

    const outside = building();
    outside.site.widthMm = 3600;
    expect(codes(outside)).toContain("ROOF_SITE_BOUNDARY_CONFLICT");

    const unsupported = building();
    unsupported.roofSupportReferences = [];
    expect(codes(unsupported)).toContain("ROOF_SUPPORT_INCOMPLETE");
  });

  test("support, edge, shade and facade rules reject missing physical evidence", () => {
    const obstructed = building();
    obstructed.secondaryRoofSupports.push({
      id: "canopy-post-obstruction",
      role: "canopy_post",
      floorId: "F0",
      baseElevationMm: 0,
      topElevationMm: 3100,
      roofSystemIds: ["roof-main"],
      geometry: { x: 2500, y: 4000 },
      sectionMm: { x: 230, y: 230 },
    });
    expect(codes(obstructed)).toContain("SUPPORT_CLEARANCE_CONFLICT");

    const elevated = building();
    elevated.floors.push({
      ...structuredClone(elevated.floors[0]),
      id: "F1",
      label: "First floor",
      level: 1,
      elevationMm: 3100,
      spaces: [{ id: "balcony", floorId: "F1", name: "Balcony", type: "balcony", regionId: "region-balcony", accessible: false }],
      regions: [{ id: "region-balcony", kind: "covered_outdoor", polygon: envelope, spaceId: "balcony" }],
      walls: elevated.floors[0].walls.map((wall) => ({ ...wall, id: `F1-${wall.id}`, floorId: "F1", adjacentSpaceIds: ["balcony"] })),
      openings: [],
    });
    expect(codes(elevated)).toContain("EDGE_PROTECTION_MISSING");

    const shade = requirements();
    shade.shadeStructures = [{ id: "entry-pergola", type: "open_pergola", location: "front_entry", source: "user" }];
    expect(codes(building(), shade)).toContain("SHADE_STRUCTURE_NOT_REALIZED");

    const facade = building();
    facade.facadeZones[0] = { ...facade.facadeZones[0], containsMainEntry: false };
    expect(codes(facade)).toContain("FACADE_ENTRY_CONFLICT");
  });

  test("polygon coverage and intent realizations remain authoritative", () => {
    const gap = building();
    gap.floors[0].regions[0].polygon = { points: [
      { x: 1500, y: 1500 }, { x: 1500, y: 3500 }, { x: 3500, y: 3500 }, { x: 3500, y: 1500 },
    ] };
    expect(codes(gap)).toContain("GEOMETRY_NO_GAPS");

    const untraced = building();
    untraced.intentRealizations = [];
    const untracedCodes = codes(untraced);
    expect(untracedCodes).toContain("MAIN_ENTRY_NOT_ROAD_SIDE");
    expect(untracedCodes).toContain("ROOF_INTENT_NOT_REALIZED");
    expect(untracedCodes).toContain("INTENT_REALIZATION_MISSING");
  });

  test("the validation-stage boundary never promotes a candidate with a hard finding", () => {
    const invalid = building();
    invalid.floors[0].openings[0].widthMm = 900;
    expect(() => validateV3SchemeStage([{ schemeId: "invalid", building: invalid }], requirements())).toThrow("No physical candidate passed authoritative v3 validation");

    const accepted = validateV3SchemeStage([{ schemeId: "valid", building: building() }], requirements());
    expect(accepted).toMatchObject({
      contractVersion: "validation-stage-v3",
      selectedSchemeId: "valid",
      validation: { valid: true, schemaVersion: "validation-report-v3" },
      building: { buildingSchemaVersion: 3 },
    });
  });
});
