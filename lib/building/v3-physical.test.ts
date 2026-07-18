import { describe, expect, test } from "bun:test";

import { createCurrentRequirements, DEFAULT_INTAKE_DRAFT } from "@/components/guided-intake/model";
import { deriveV3EdgeProtections } from "@/lib/building/edge-protection";
import { REFERENCE_ARTICULATED_SLOPED_REQUIREMENTS } from "@/lib/building/fixtures/reference-articulated-sloped";
import { generateV3PhysicalStage } from "@/lib/building/generate-v3-physical";
import { currentBuildingRequirementsSchema } from "@/lib/building/requirements";
import { currentBuildingSchema } from "@/lib/building/schema";
import { evaluateRoofSupportCompleteness, roofPlanesForRectangle } from "@/lib/building/roofs";
import { DEFAULT_GUARD_HEIGHT_MM, GUARD_TRIGGER_DROP_MM } from "@/lib/building/v3-constants";
import { buildMassingModel, massingMetrics } from "@/lib/render/massing";
import { validateBuildingV3 } from "@/lib/validation/validate-v3";

function physicalRequirements() {
  return createCurrentRequirements({
    ...DEFAULT_INTAKE_DRAFT,
    projectName: "Physical systems reference",
    roofCharacter: "sloped",
    includeParking: true,
  }, {
    shadeStructures: [{ id: "parking-open-pergola", type: "open_pergola", location: "parking", targetAreaM2: 12, source: "user" }],
  });
}

function referencePhysicalRequirements() {
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

describe("v3 physical systems", () => {
  test("constructs each enclosure roof plane family from canonical vertices", () => {
    const rectangle = { x: 1_000, y: 2_000, width: 8_000, depth: 6_000 };
    expect(roofPlanesForRectangle("flat", "flat_slab", rectangle, 3_100)).toHaveLength(1);
    expect(roofPlanesForRectangle("gable", "gable", rectangle, 3_100)).toHaveLength(2);
    expect(roofPlanesForRectangle("hip", "hip", rectangle, 3_100)).toHaveLength(4);
    const shed = roofPlanesForRectangle("shed", "shed", rectangle, 3_100);
    expect(shed).toHaveLength(1);
    expect(new Set(shed[0].vertices.map((point) => point.z)).size).toBe(2);
    expect(roofPlanesForRectangle("canopy", "solid_canopy", rectangle, 3_100)).toHaveLength(1);
  });

  test("overrides historical sloped intent with flat roofs while preserving supports, pergola and the distinct main door", () => {
    const result = generateV3PhysicalStage(physicalRequirements());
    expect(result.contractVersion).toBe("physical-stage-v3");
    expect(result.schemes.length).toBeGreaterThan(0);
    for (const { building } of result.schemes) {
      expect(currentBuildingSchema.safeParse(building).success).toBe(true);
      const enclosureRoofs = building.roofSystems.filter((roof) => roof.kind !== "open_pergola");
      expect(enclosureRoofs.length).toBeGreaterThan(0);
      expect(enclosureRoofs.every((roof) => roof.kind === "flat_slab" || roof.kind === "solid_canopy")).toBe(true);
      expect(building.roofSystems.some((roof) => roof.kind === "gable" || roof.kind === "hip" || roof.kind === "shed")).toBe(false);
      const pergola = building.roofSystems.find((roof) => roof.kind === "open_pergola");
      expect(pergola).toBeDefined();
      if (!pergola || pergola.kind !== "open_pergola") throw new Error("expected pergola");
      expect(pergola.openAreaRatio).toBeGreaterThanOrEqual(0.5);
      expect(pergola.slatMembers.length).toBeGreaterThan(1);
      expect(building.secondaryRoofSupports.some((support) => support.role === "pergola_post" && support.roofSystemIds.includes(pergola.id))).toBe(true);
      const parking = building.floors.flatMap((floor) => floor.spaces.map((space) => ({ floor, space }))).find(({ space }) => space.type === "parking");
      const parkingRegion = parking?.floor.regions.find((region) => region.id === parking.space.regionId);
      const parkingPosts = building.secondaryRoofSupports.filter((support) => support.roofSystemIds.includes(pergola.id) && support.role === "pergola_post");
      expect(parkingRegion).toBeDefined();
      expect(parkingPosts.every((support) => {
        if (!parkingRegion || !("x" in support.geometry)) return false;
        const xs = parkingRegion.polygon.points.map((point) => point.x);
        const ys = parkingRegion.polygon.points.map((point) => point.y);
        return support.geometry.x === Math.min(...xs) || support.geometry.x === Math.max(...xs)
          || support.geometry.y === Math.min(...ys) || support.geometry.y === Math.max(...ys);
      })).toBe(true);
      expect(validateBuildingV3(building, physicalRequirements()).findings.some((finding) => finding.ruleId === "SUPPORT_CLEARANCE_CONFLICT")).toBe(false);
      expect(evaluateRoofSupportCompleteness({
        roofSystems: building.roofSystems,
        roofSupportReferences: building.roofSupportReferences,
        secondaryRoofSupports: building.secondaryRoofSupports,
        structuralConcept: building.structuralConcept,
        walls: building.floors.flatMap((floor) => floor.walls),
      })).toEqual([]);
      const main = building.floors.flatMap((floor) => floor.openings).find((opening) => opening.role === "main_entry");
      const interior = building.floors.flatMap((floor) => floor.openings).find((opening) => opening.role === "interior_door");
      expect(main?.widthMm).toBeGreaterThan(interior?.widthMm ?? 0);
      expect(main?.materialToken).toBe("door.main-entry.warm-wood");
      expect(main?.materialToken).not.toBe(interior?.materialToken);

      const massing = buildMassingModel(building);
      expect(massing.primitives.some((primitive) => primitive.shape === "mesh" && primitive.semanticKind === "roof")).toBe(true);
      expect(massing.primitives.some((primitive) => primitive.shape === "linear_member" && primitive.semanticKind === "pergola")).toBe(true);
      expect(massing.primitives.some((primitive) => primitive.semanticKind === "support")).toBe(true);
      expect(massing.primitives.find((primitive) => primitive.sourceId === main?.id)?.materialToken).toBe("door.main-entry.warm-wood");
      const highestVertex = Math.max(...massing.primitives.flatMap((primitive) => primitive.shape === "mesh" ? primitive.vertices.map((point) => point[1]) : []));
      expect(massing.heightM).toBeGreaterThanOrEqual(highestVertex);
      const expectedPhysicalTopMm = Math.max(
        building.floors.at(-1)!.elevationMm + building.floors.at(-1)!.floorHeightMm,
        ...building.roofSystems.map((roof) => roof.kind === "open_pergola" ? roof.topElevationMm : roof.eaveHeightMm),
      );
      expect(massingMetrics(building).heightM).toBe(expectedPhysicalTopMm / 1000);
    }
  });

  test("realizes the reported articulated reference with flat multi-roofs, parking support, upper guards and an open pergola", () => {
    const result = generateV3PhysicalStage(referencePhysicalRequirements());
    expect(result.schemes).toHaveLength(3);
    for (const { building } of result.schemes) {
      const enclosureRoofs = building.roofSystems.filter((roof) => roof.kind !== "open_pergola");
      expect(enclosureRoofs.length).toBeGreaterThan(1);
      expect(enclosureRoofs.every((roof) => roof.kind === "flat_slab" || roof.kind === "solid_canopy")).toBe(true);
      expect(building.roofSystems.some((roof) => roof.kind === "gable" || roof.kind === "hip" || roof.kind === "shed")).toBe(false);
      const parkingCanopy = building.roofSystems.find((roof) => roof.kind === "solid_canopy" && roof.servesSpaceIds.includes("parking"));
      expect(parkingCanopy).toBeDefined();
      expect(building.secondaryRoofSupports.some((support) => parkingCanopy && support.roofSystemIds.includes(parkingCanopy.id))).toBe(true);
      expect(building.edgeProtections.some((guard) => guard.floorId === "F1" || guard.floorId === "F2")).toBe(true);
      expect(building.roofSystems.some((roof) => roof.kind === "open_pergola" && roof.id === "upper-open-pergola")).toBe(true);
      const main = building.floors.flatMap((floor) => floor.openings).find((opening) => opening.role === "main_entry")!;
      expect(main.widthMm).toBe(1200);
      expect(main.materialToken).toBe("door.main-entry.warm-wood");
    }
  });

  test("guards elevated balcony edges but not ground-level outdoor edges", () => {
    const requirements = physicalRequirements();
    const base = generateV3PhysicalStage(requirements).schemes[0].building;
    const floor = base.floors[0];
    const parking = floor.spaces.find((space) => space.type === "parking")!;
    const parkingRegion = floor.regions.find((region) => region.id === parking.regionId)!;
    const scheme = {
      schemeId: "guard-fixture",
      partiId: "compact_bar" as const,
      topologySchemeId: "guard-fixture",
      arrivalReservations: {
        primaryRoadSide: base.site.roadEdges[0],
        mainEntry: { side: base.site.roadEdges[0], targetRoomId: "foyer" },
        foyerWallRunReservation: { id: "fixture", side: base.site.roadEdges[0], segment: { start: { x: 0, y: 0 }, end: { x: 1300, y: 0 } }, minimumClearWidthMm: 1300, targetRoomId: "foyer" },
      },
      aboveParking: [],
      areaPolicies: [],
      surplusPenalty: 0,
      contractVersion: "circulation-stage-v3" as const,
      circulationGraph: { nodes: [], edges: [], unreachableSpaceIds: [] },
      arrivalRealization: { mainEntryOpeningId: "fixture", mainEntryWallId: "fixture", primaryRoadSide: base.site.roadEdges[0] },
      floors: [
        { floorId: "F0", label: "Ground", level: 0, elevationMm: 0, floorHeightMm: 3100, envelope: floor.envelope, regions: [{ ...parkingRegion, id: "ground-verandah-region", spaceId: "ground-verandah" }], spaces: [{ id: "ground-verandah", floorId: "F0", name: "Ground verandah", type: "verandah" as const, regionId: "ground-verandah-region", bounds: { x: 0, y: 0, width: 3000, depth: 2000 }, areaMm2: 6_000_000, accessible: false }], walls: [{ id: "ground-edge", floorId: "F0", start: { x: 0, y: 0 }, end: { x: 3000, y: 0 }, thicknessMm: 115, type: "exterior" as const, adjacentSpaceIds: ["ground-verandah"] }], openings: [], constructedFootprints: [], intentionalUnbuiltRegions: [], coverage: { envelopeAreaMm2: 1, coveredAreaMm2: 1, gapAreaMm2: 0, overlapAreaMm2: 0, outsideAreaMm2: 0, valid: true }, targetProgramAreaMm2: 1, allocatedProgramAreaMm2: 1, surplusPenalty: 0, footprintExpandedForProgram: false },
        { floorId: "F1", label: "First", level: 1, elevationMm: 3100, floorHeightMm: 3100, envelope: floor.envelope, regions: [{ ...parkingRegion, id: "balcony-region", spaceId: "balcony" }], spaces: [{ id: "balcony", floorId: "F1", name: "Balcony", type: "balcony" as const, regionId: "balcony-region", bounds: { x: 0, y: 0, width: 3000, depth: 2000 }, areaMm2: 6_000_000, accessible: false }], walls: [{ id: "balcony-edge", floorId: "F1", start: { x: 0, y: 0 }, end: { x: 3000, y: 0 }, thicknessMm: 115, type: "exterior" as const, adjacentSpaceIds: ["balcony"] }], openings: [], constructedFootprints: [], intentionalUnbuiltRegions: [], coverage: { envelopeAreaMm2: 1, coveredAreaMm2: 1, gapAreaMm2: 0, overlapAreaMm2: 0, outsideAreaMm2: 0, valid: true }, targetProgramAreaMm2: 1, allocatedProgramAreaMm2: 1, surplusPenalty: 0, footprintExpandedForProgram: false },
      ],
    };
    const guards = deriveV3EdgeProtections(requirements, scheme);
    expect(guards).toHaveLength(1);
    expect(guards[0]).toMatchObject({ floorId: "F1", heightMm: DEFAULT_GUARD_HEIGHT_MM, dropHeightMm: 3100 });
    expect(guards[0].dropHeightMm).toBeGreaterThan(GUARD_TRIGGER_DROP_MM);
  });
});
