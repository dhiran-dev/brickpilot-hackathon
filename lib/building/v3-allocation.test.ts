import { describe, expect, test } from "bun:test";

import {
  CONSTRAINED_SINGLE_PARTI_REQUIREMENTS,
  REFERENCE_ARTICULATED_SLOPED_REQUIREMENTS,
} from "@/lib/building/fixtures/reference-articulated-sloped";
import { resolveRoomAreaPolicy } from "@/lib/building/area-policy-v3";
import { generateV3AllocationStage, V3AllocationGenerationError } from "@/lib/building/generate-v3-allocation";
import { currentBuildingRequirementsSchema, type LegacyBuildingRequirements } from "@/lib/building/requirements";
import { orthogonalPolygonAreaMm2, orthogonalPolygonBounds } from "@/lib/building/orthogonal-partition";

function currentRequirements(legacy: LegacyBuildingRequirements) {
  const parking = legacy.rooms.find((room) => room.type === "parking");
  const courtyard = legacy.rooms.some((room) => room.type === "courtyard");
  return currentBuildingRequirementsSchema.parse({
    ...legacy,
    requirementSchemaVersion: 3,
    entry: { primarySide: { value: legacy.site.roadEdges[0], source: "user" }, secondaryEntry: { value: "auto", source: "default" }, primaryDoorClearWidthMm: 1200 },
    parking: {
      vehicleCount: parking ? 1 : 0,
      targetAreaMm2: parking?.targetAreaMm2,
      minimumAreaMm2: parking?.minAreaMm2,
      maximumAreaMm2: parking ? parking.targetAreaMm2 * 1.5 : undefined,
      preferredSide: { value: legacy.site.roadEdges[0], source: "user" },
    },
    outdoorAreas: legacy.rooms.filter((room) => room.type === "balcony" || room.type === "verandah").map((room) => ({
      id: `outdoor-${room.id}`,
      floorId: room.floorId,
      type: room.type,
      targetAreaMm2: room.targetAreaMm2,
      minimumAreaMm2: room.minAreaMm2,
      maximumAreaMm2: room.targetAreaMm2 * 2,
      source: "user",
    })),
    courtyard: { value: courtyard ? "open_to_sky" : "none", source: "user" },
    roof: { value: legacy.architecture.roofCharacter, source: "user" },
    shadeStructures: [],
    aboveParkingUse: { value: parking ? "occupied_rooms" : "auto", source: parking ? "user" : "default" },
    maxExteriorPedestrianEntryCount: 2,
  });
}

describe("v3 program allocation", () => {
  test("applies room-specific parking, fixed-service, and outdoor hard maxima", () => {
    const requirements = currentRequirements(REFERENCE_ARTICULATED_SLOPED_REQUIREMENTS);
    const usable = 246_400_000;
    const parking = resolveRoomAreaPolicy({ requirements, room: requirements.rooms.find((room) => room.id === "parking")!, usableFloorAreaMm2: usable });
    const foyer = resolveRoomAreaPolicy({ requirements, room: requirements.rooms.find((room) => room.id === "foyer")!, usableFloorAreaMm2: usable });
    const balcony = resolveRoomAreaPolicy({ requirements, room: requirements.rooms.find((room) => room.id === "balcony-f1")!, usableFloorAreaMm2: usable });
    expect(parking).toMatchObject({ effectiveTargetAreaMm2: 18_000_000, warningMaximumAreaMm2: 22_500_000, hardMaximumAreaMm2: 27_000_000 });
    expect(foyer).toMatchObject({ effectiveTargetAreaMm2: 5_000_000, warningMaximumAreaMm2: 6_250_000, hardMaximumAreaMm2: 9_000_000 });
    expect(balcony).toMatchObject({ effectiveTargetAreaMm2: 7_000_000, warningMaximumAreaMm2: 10_500_000, hardMaximumAreaMm2: 14_000_000 });
  });

  test("allocates the reference program without residual verandahs and derives everything from regions", () => {
    const requirements = currentRequirements(REFERENCE_ARTICULATED_SLOPED_REQUIREMENTS);
    const result = generateV3AllocationStage(requirements);
    expect(result.schemes).toHaveLength(3);
    for (const scheme of result.schemes) {
      expect(scheme.floors.every((floor) => floor.coverage.valid)).toBe(true);
      expect(scheme.floors.flatMap((floor) => floor.spaces).some((space) => space.type === "verandah")).toBe(false);
      for (const floor of scheme.floors) {
        expect(floor.intentionalUnbuiltRegions.length).toBeGreaterThan(0);
        expect(floor.regions.reduce((sum, region) => sum + orthogonalPolygonAreaMm2(region.polygon), 0)).toBe(floor.coverage.envelopeAreaMm2);
        for (const space of floor.spaces) {
          const region = floor.regions.find((candidate) => candidate.id === space.regionId);
          expect(region?.spaceId).toBe(space.id);
          expect(space.areaMm2).toBe(orthogonalPolygonAreaMm2(region!.polygon));
          expect(space.bounds).toEqual(orthogonalPolygonBounds(region!.polygon));
        }
      }
      const spaces = scheme.floors.flatMap((floor) => floor.spaces);
      expect(spaces.find((space) => space.id === "parking")?.areaMm2).toBeLessThanOrEqual(27_000_000);
      expect(spaces.find((space) => space.id === "foyer")?.areaMm2).toBeLessThanOrEqual(9_000_000);
      expect(spaces.find((space) => space.id === "balcony-f1")?.areaMm2).toBeLessThanOrEqual(14_000_000);
      expect(scheme.aboveParking.length).toBeGreaterThan(0);
      expect(scheme.aboveParking.every((item) => item.use === "occupied_rooms" && item.realizedRegionIds.length > 0)).toBe(true);
    }
  });

  test("keeps the constrained result partial instead of filling unused area", () => {
    const result = generateV3AllocationStage(currentRequirements(CONSTRAINED_SINGLE_PARTI_REQUIREMENTS));
    expect(result.schemes).toHaveLength(1);
    const floor = result.schemes[0].floors[0];
    expect(floor.coverage.valid).toBe(true);
    expect(floor.intentionalUnbuiltRegions.length).toBeGreaterThan(0);
    expect(floor.allocatedProgramAreaMm2).toBeLessThan(floor.coverage.envelopeAreaMm2);
    expect(floor.spaces).toHaveLength(CONSTRAINED_SINGLE_PARTI_REQUIREMENTS.rooms.length);
  });

  test("returns PROGRAM_AREA_INFEASIBLE with requirement IDs instead of enlarging rooms or looping", () => {
    const base = currentRequirements(CONSTRAINED_SINGLE_PARTI_REQUIREMENTS);
    const impossible = currentBuildingRequirementsSchema.parse({
      ...base,
      rooms: base.rooms.map((room) => room.id === "living-constrained" ? { ...room, minAreaMm2: 80_000_000, targetAreaMm2: 90_000_000 } : room),
    });
    try {
      generateV3AllocationStage(impossible);
      throw new Error("expected allocation failure");
    } catch (error) {
      expect(error).toBeInstanceOf(V3AllocationGenerationError);
      expect(error).toMatchObject({ code: "PROGRAM_AREA_INFEASIBLE" });
      expect((error as V3AllocationGenerationError).requirementIds).toContain("living-constrained");
    }
  });
});
