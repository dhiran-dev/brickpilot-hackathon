import { describe, expect, test } from "bun:test";

import {
  CONSTRAINED_SINGLE_PARTI_REQUIREMENTS,
  REFERENCE_ARTICULATED_SLOPED_REQUIREMENTS,
} from "@/lib/building/fixtures/reference-articulated-sloped";
import { generateV3TopologySchemes, type SchemeSetMetric } from "@/lib/building/generate-v3-topology";
import { currentBuildingRequirementsSchema, type LegacyBuildingRequirements } from "@/lib/building/requirements";
import { orthogonalPolygonSchema } from "@/lib/building/schema";
import { compareSchemeTopologyFingerprints } from "@/lib/building/scheme-fingerprint";
import { MAIN_ENTRY_MIN_WALL_RUN_MM, VEHICLE_APERTURE_MIN_CLEAR_WIDTH_MM } from "@/lib/building/v3-constants";

function currentRequirements(legacy: LegacyBuildingRequirements) {
  const parking = legacy.rooms.find((room) => room.type === "parking");
  const courtyard = legacy.rooms.some((room) => room.type === "courtyard");
  return currentBuildingRequirementsSchema.parse({
    ...legacy,
    requirementSchemaVersion: 3,
    entry: {
      primarySide: { value: legacy.site.roadEdges[0], source: "user" },
      secondaryEntry: { value: "auto", source: "default" },
      primaryDoorClearWidthMm: 1200,
    },
    parking: {
      vehicleCount: parking ? 1 : 0,
      targetAreaMm2: parking?.targetAreaMm2,
      minimumAreaMm2: parking?.minAreaMm2,
      maximumAreaMm2: parking ? Math.round(parking.targetAreaMm2 * 1.5) : undefined,
      preferredSide: { value: legacy.site.roadEdges[0], source: "user" },
    },
    outdoorAreas: legacy.rooms
      .filter((room) => room.type === "balcony" || room.type === "verandah")
      .map((room) => ({
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
    shadeStructures: parking ? [{ id: "parking-pergola", type: "open_pergola", location: "parking", targetAreaM2: 18, source: "user" }] : [],
    aboveParkingUse: { value: parking ? "occupied_rooms" : "auto", source: parking ? "user" : "default" },
    maxExteriorPedestrianEntryCount: 2,
  });
}

describe("v3 topology scheme generation", () => {
  test("honors explicit articulated form before climate and returns three distinct reference directions", () => {
    const requirements = currentRequirements(REFERENCE_ARTICULATED_SLOPED_REQUIREMENTS);
    const metrics: SchemeSetMetric[] = [];
    const first = generateV3TopologySchemes(requirements, { onMetric: (metric) => metrics.push(metric) });
    const second = generateV3TopologySchemes(requirements);

    expect(first.schemes.map((scheme) => scheme.partiId)).toEqual(["articulated_l", "courtyard_ring", "t_hub"]);
    expect(first.schemes.map((scheme) => scheme.schemeId)).toEqual(second.schemes.map((scheme) => scheme.schemeId));
    expect(new Set(first.schemes.map((scheme) => scheme.fingerprint.hash)).size).toBe(3);
    for (let left = 0; left < first.schemes.length; left += 1) {
      for (let right = left + 1; right < first.schemes.length; right += 1) {
        expect(compareSchemeTopologyFingerprints(first.schemes[left].fingerprint, first.schemes[right].fingerprint).nearDuplicate).toBe(false);
      }
    }
    expect(first.schemes[0].evidence[0]).toContain("Explicit form articulated_wings");
    expect(metrics).toEqual([first.diagnostics.metric]);
    expect(first.diagnostics.metric).toMatchObject({ generatedCount: 3, distinctCount: 3, canaryGenerationSuccess: true });
  });

  test("reserves road-side foyer wall run and vehicle aperture without synthesizing openings", () => {
    const result = generateV3TopologySchemes(currentRequirements(REFERENCE_ARTICULATED_SLOPED_REQUIREMENTS));
    for (const scheme of result.schemes) {
      expect(scheme.topology.foyerWallRunReservation.side).toBe("south");
      expect(scheme.topology.foyerWallRunReservation.minimumClearWidthMm).toBe(MAIN_ENTRY_MIN_WALL_RUN_MM);
      expect(scheme.topology.foyerWallRunReservation.segment).not.toEqual(scheme.topology.vehicleApertureReservation?.segment);
      expect(scheme.topology.vehicleApertureReservation).toMatchObject({
        side: "south",
        minimumClearWidthMm: VEHICLE_APERTURE_MIN_CLEAR_WIDTH_MM,
        targetRoomId: "parking",
      });
      expect("openings" in scheme.topology).toBe(false);
      for (const floor of scheme.topology.occupiedFootprintsByFloor) {
        floor.polygons.forEach((polygon) => expect(orthogonalPolygonSchema.safeParse(polygon).success).toBe(true));
      }
    }
  });

  test("returns one honest compact option on the constrained plot with a traceable smaller-set finding", () => {
    const requirements = currentRequirements(CONSTRAINED_SINGLE_PARTI_REQUIREMENTS);
    const result = generateV3TopologySchemes(requirements);
    expect(result.schemes).toHaveLength(1);
    expect(result.schemes[0].partiId).toBe("compact_bar");
    expect(result.diagnostics.attemptedCount).toBeLessThanOrEqual(4);
    expect(result.diagnostics.relaxations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "FEWER_DISTINCT_SCHEMES" }),
      expect.objectContaining({ code: "PARTI_INFEASIBLE", partiId: "t_hub" }),
      expect.objectContaining({ code: "PARTI_INFEASIBLE", partiId: "articulated_l" }),
      expect.objectContaining({ code: "PARTI_INFEASIBLE", partiId: "courtyard_ring" }),
    ]));
    expect(result.diagnostics.metric).toMatchObject({ generatedCount: 1, distinctCount: 1 });
  });

  test("removes only an inferred courtyard when the explicit form changes", () => {
    const base = currentRequirements(CONSTRAINED_SINGLE_PARTI_REQUIREMENTS);
    const withInferredCourt = currentBuildingRequirementsSchema.parse({
      ...base,
      rooms: [...base.rooms, {
        id: "inferred-courtyard",
        name: "Inferred courtyard",
        type: "courtyard",
        floorId: "F0",
        minAreaMm2: 4_000_000,
        targetAreaMm2: 6_000_000,
        privacy: "semi_private",
        preferredZone: "center",
        mustBeExterior: true,
        accessible: false,
      }],
      courtyard: { value: "open_to_sky", source: "inferred" },
    });
    const result = generateV3TopologySchemes(withInferredCourt);
    expect(result.schemes[0].topology.voids).toHaveLength(0);
    expect(result.schemes[0].topology.relaxationFindings).toContainEqual(expect.objectContaining({
      code: "INFERRED_COURTYARD_REMOVED",
      requirementPath: "courtyard",
      resolvedValue: "none",
    }));
  });
});
