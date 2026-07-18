import { describe, expect, test } from "bun:test";

import {
  CONSTRAINED_SINGLE_PARTI_REQUIREMENTS,
  COURTYARD_TRANSITION_FIXTURES,
  REFERENCE_ARTICULATED_SLOPED_REQUIREMENTS,
} from "@/lib/building/fixtures/reference-articulated-sloped";
import { generateBuilding, generateBuildingSchemes } from "@/lib/building/generate";
import { generateV3AllocationStage } from "@/lib/building/generate-v3-allocation";
import { generateV3TopologySchemes } from "@/lib/building/generate-v3-topology";
import { selectEligiblePartis } from "@/lib/building/partis";
import { compareSchemeTopologyFingerprints } from "@/lib/building/scheme-fingerprint";
import { orthogonalPolygonAreaMm2 } from "@/lib/building/orthogonal-partition";
import { resolveRoomAreaPolicy } from "@/lib/building/area-policy-v3";
import {
  buildingRequirementsSchema,
  currentBuildingRequirementsSchema,
  type LegacyBuildingRequirements,
} from "@/lib/building/requirements";

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

function constrainedWithCourtyard(source: "user" | "inferred") {
  const base = currentRequirements(CONSTRAINED_SINGLE_PARTI_REQUIREMENTS);
  return currentBuildingRequirementsSchema.parse({
    ...base,
    rooms: [...base.rooms, {
      id: `${source}-courtyard`,
      name: `${source} courtyard`,
      type: "courtyard",
      floorId: "F0",
      minAreaMm2: 4_000_000,
      targetAreaMm2: 6_000_000,
      privacy: "semi_private",
      preferredZone: "center",
      mustBeExterior: true,
      accessible: false,
    }],
    courtyard: { value: "open_to_sky", source },
  });
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function currentGeometryCharacterization() {
  const { building } = generateBuilding(REFERENCE_ARTICULATED_SLOPED_REQUIREMENTS);
  const areas = building.floors
    .flatMap((floor) => floor.spaces.map((space) => ({
      id: space.id,
      floorId: floor.id,
      type: space.type,
      areaMm2: space.areaMm2,
      occupied: space.occupied,
    })))
    .sort((left, right) => left.floorId.localeCompare(right.floorId) || left.id.localeCompare(right.id));
  const adjacency = building.floors
    .flatMap((floor) => floor.walls
      .filter((wall) => wall.adjacentSpaceIds.length === 2)
      .map((wall) => ({
        floorId: floor.id,
        spaces: [...wall.adjacentSpaceIds].sort(),
        lengthMm: Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y),
      })))
    .sort((left, right) => left.floorId.localeCompare(right.floorId)
      || left.spaces.join("|").localeCompare(right.spaces.join("|"))
      || left.lengthMm - right.lengthMm);
  const openings = building.floors
    .flatMap((floor) => floor.openings.map((opening) => ({
      id: opening.id,
      floorId: floor.id,
      kind: opening.kind,
      usage: opening.usage ?? null,
      widthMm: opening.widthMm,
      connects: [...opening.connects].sort(),
    })))
    .sort((left, right) => left.floorId.localeCompare(right.floorId) || left.id.localeCompare(right.id));

  return {
    building,
    summary: {
      areaCount: areas.length,
      areasHash: stableHash(JSON.stringify(areas)),
      floorAreaM2: Object.fromEntries(building.floors.map((floor) => [
        floor.id,
        Number((floor.spaces.reduce((sum, space) => sum + space.areaMm2, 0) / 1_000_000).toFixed(4)),
      ])),
      adjacencyCount: adjacency.length,
      adjacencyHash: stableHash(JSON.stringify(adjacency)),
      openingCount: openings.length,
      openingHash: stableHash(JSON.stringify(openings)),
    },
  };
}

describe("redacted architectural-remediation fixtures", () => {
  test("records the attached questionnaire without project or owner identifiers", () => {
    const parsed = buildingRequirementsSchema.parse(REFERENCE_ARTICULATED_SLOPED_REQUIREMENTS);

    expect(parsed.projectName).toStartWith("Redacted");
    expect(JSON.stringify(parsed)).not.toContain("a3c15af1-f251-4bbd-8526-4299cff5765c");
    expect(JSON.stringify(parsed)).not.toContain("ce04575c-f599-4330-a66a-11adcaba6ad4");
    expect(parsed.site).toMatchObject({
      widthMm: 20_000,
      depthMm: 18_000,
      facing: "north",
      roadEdges: ["south", "east"],
      setbacksMm: { north: 1_500, east: 1_200, south: 2_500, west: 1_200 },
    });
    expect(parsed.floors).toHaveLength(3);
    expect(parsed.architecture).toEqual({
      style: "courtyard_vernacular",
      formStrategy: "articulated_wings",
      roofCharacter: "sloped",
      materialDirection: "earthy_textured",
    });
    expect(parsed.budget.qualityTier).toBe("premium");
    expect(parsed.rooms.find((room) => room.id === "parking")?.targetAreaMm2).toBe(18_000_000);
    expect(parsed.rooms.find((room) => room.id === "foyer")?.targetAreaMm2).toBe(5_000_000);
    expect(parsed.rooms.find((room) => room.id === "courtyard")?.targetAreaMm2).toBe(14_000_000);
    expect(parsed.rooms.find((room) => room.id === "balcony-f1")?.targetAreaMm2).toBe(7_000_000);
    expect(parsed.rooms.find((room) => room.id === "balcony-f2")?.targetAreaMm2).toBe(7_000_000);
  });

  test("locks the v2 before-state areas, adjacency and openings", () => {
    const { building, summary } = currentGeometryCharacterization();

    expect(building.candidate.generatorId).toBe("courtyard");
    expect(building.candidate.geometryHash).toBe("45968d8a");
    expect(summary).toEqual({
      areaCount: 48,
      areasHash: "28810437",
      floorAreaM2: { F0: 246.4, F1: 246.4, F2: 246.4 },
      adjacencyCount: 85,
      adjacencyHash: "9c2a4426",
      openingCount: 56,
      openingHash: "64cf88e2",
    });

    const ground = building.floors.find((floor) => floor.id === "F0");
    const first = building.floors.find((floor) => floor.id === "F1");
    expect(ground?.spaces.find((space) => space.id === "parking")?.areaMm2).toBe(75_600_000);
    expect(ground?.spaces.find((space) => space.id === "foyer")?.areaMm2).toBe(17_175_200);
    expect(ground?.spaces.find((space) => space.id === "circulation-f0-branch")?.areaMm2).toBe(19_712_000);
    expect(ground?.spaces.find((space) => space.id === "F0-covered-gallery")?.areaMm2).toBe(18_088_000);
    expect(first?.spaces.find((space) => space.id === "F1-parti-setback-right")?.areaMm2).toBe(53_597_600);
    expect(ground?.openings.find((opening) => opening.id === "F0-entrance")).toMatchObject({
      kind: "open_connection",
      widthMm: 900,
      connects: ["EXTERIOR", "F0-entry-verandah"],
    });
  });

  test("locks the current three reference scheme fingerprints", () => {
    const first = generateBuildingSchemes(REFERENCE_ARTICULATED_SLOPED_REQUIREMENTS);
    const second = generateBuildingSchemes(REFERENCE_ARTICULATED_SLOPED_REQUIREMENTS);
    const fingerprints = first.schemes.map((scheme) => ({
      partiId: scheme.partiId,
      geometryHash: scheme.building.candidate.geometryHash,
      schemeId: scheme.schemeId,
    }));

    expect(fingerprints).toEqual([
      { partiId: "courtyard", geometryHash: "45968d8a", schemeId: "scheme-93634119" },
      { partiId: "compact", geometryHash: "53ce4ef4", schemeId: "scheme-2b55eb7d" },
      { partiId: "t_hub", geometryHash: "53cbdd5e", schemeId: "scheme-fd16f3fc" },
    ]);
    expect(second.schemes.map((scheme) => scheme.building.candidate.geometryHash)).toEqual(
      fingerprints.map((fingerprint) => fingerprint.geometryHash),
    );
  });

  test("keeps the constrained fixture to one honest compact option", () => {
    const requirements = buildingRequirementsSchema.parse(CONSTRAINED_SINGLE_PARTI_REQUIREMENTS);
    const envelope = {
      x: requirements.site.setbacksMm.west,
      y: requirements.site.setbacksMm.north,
      width: requirements.site.widthMm - requirements.site.setbacksMm.west - requirements.site.setbacksMm.east,
      depth: requirements.site.depthMm - requirements.site.setbacksMm.north - requirements.site.setbacksMm.south,
    };
    const eligible = selectEligiblePartis({
      formStrategy: requirements.architecture.formStrategy,
      climateClass: "hot_humid",
      envelope,
      floorCount: requirements.floors.length,
      rooms: requirements.rooms,
      seed: requirements.seed,
    });
    const generated = generateBuildingSchemes(requirements);

    expect(eligible).toEqual(["compact"]);
    expect(generated.schemes).toHaveLength(1);
    expect(generated.schemes[0]).toMatchObject({ partiId: "compact" });
    expect(generated.schemes[0].building.candidate.geometryHash).toBe("0b43e99e");
  });

  test("records explicit and inferred courtyard transition expectations", () => {
    expect(COURTYARD_TRANSITION_FIXTURES).toEqual([
      expect.objectContaining({
        id: "explicit-courtyard-survives-or-reports",
        priorChoice: { value: "courtyard", source: "user" },
        expectedDisposition: "report_incompatible",
      }),
      expect.objectContaining({
        id: "inferred-courtyard-is-removed",
        priorChoice: { value: "courtyard", source: "inferred" },
        expectedDisposition: "remove",
      }),
    ]);
  });

  test("v3 keeps an explicit courtyard or emits a traceable incompatibility finding", () => {
    const result = generateV3TopologySchemes(constrainedWithCourtyard("user"));
    expect(result.schemes[0].topology.voids).toHaveLength(1);
    expect(result.schemes[0].topology.relaxationFindings).not.toContainEqual(expect.objectContaining({ code: "INFERRED_COURTYARD_REMOVED" }));
  });

  test("v3 removes an incompatible inferred courtyard when form strategy changes", () => {
    const result = generateV3TopologySchemes(constrainedWithCourtyard("inferred"));
    expect(result.schemes[0].topology.voids).toHaveLength(0);
    expect(result.schemes[0].topology.relaxationFindings).toContainEqual(expect.objectContaining({
      code: "INFERRED_COURTYARD_REMOVED",
      requirementPath: "courtyard",
      requestedValue: "open_to_sky",
      resolvedValue: "none",
    }));
  });

  test("v3 reference schemes pass scheme-topology-v1 distinctness thresholds", () => {
    const result = generateV3TopologySchemes(currentRequirements(REFERENCE_ARTICULATED_SLOPED_REQUIREMENTS));
    expect(result.schemes).toHaveLength(3);
    for (let left = 0; left < result.schemes.length; left += 1) for (let right = left + 1; right < result.schemes.length; right += 1) {
      expect(compareSchemeTopologyFingerprints(result.schemes[left].fingerprint, result.schemes[right].fingerprint)).toMatchObject({ nearDuplicate: false });
    }
  });

  test("v3 reference areas obey room-type hard maxima without filling residual space", () => {
    const requirements = currentRequirements(REFERENCE_ARTICULATED_SLOPED_REQUIREMENTS);
    const result = generateV3AllocationStage(requirements);
    for (const scheme of result.schemes) for (const floor of scheme.floors) {
      expect(floor.intentionalUnbuiltRegions.length).toBeGreaterThan(0);
      expect(floor.regions.reduce((sum, region) => sum + orthogonalPolygonAreaMm2(region.polygon), 0)).toBe(floor.coverage.envelopeAreaMm2);
      for (const space of floor.spaces) {
        const requirement = requirements.rooms.find((room) => room.id === space.id);
        if (!requirement) continue;
        const policy = resolveRoomAreaPolicy({ requirements, room: requirement, usableFloorAreaMm2: floor.coverage.envelopeAreaMm2 });
        expect(space.areaMm2).toBeLessThanOrEqual(policy.hardMaximumAreaMm2);
      }
    }
  });
});
