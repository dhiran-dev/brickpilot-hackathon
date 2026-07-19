import { describe, expect, test } from "bun:test";

import { createCurrentRequirements, DEFAULT_INTAKE_DRAFT } from "@/components/guided-intake/model";
import { deriveV3EdgeProtections } from "@/lib/building/edge-protection";
import { REFERENCE_ARTICULATED_SLOPED_REQUIREMENTS } from "@/lib/building/fixtures/reference-articulated-sloped";
import { generateV3PhysicalStage } from "@/lib/building/generate-v3-physical";
import { orthogonalPolygonAreaMm2 } from "@/lib/building/orthogonal-partition";
import { currentBuildingRequirementsSchema } from "@/lib/building/requirements";
import { currentBuildingSchema } from "@/lib/building/schema";
import { evaluateRoofSupportCompleteness, roofPlanesForRectangle } from "@/lib/building/roofs";
import { DEFAULT_GUARD_HEIGHT_MM, GUARD_TRIGGER_DROP_MM } from "@/lib/building/v3-constants";
import { buildMassingModel, massingMetrics, SLAB_THICKNESS_M } from "@/lib/render/massing";
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
      expect(orthogonalPolygonAreaMm2(pergola.footprint))
        .toBe(parkingRegion ? orthogonalPolygonAreaMm2(parkingRegion.polygon) : 0);
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
      const closedRoofPrimitives = massing.primitives.filter((primitive) =>
        primitive.shape === "mesh" && primitive.semanticKind === "roof");
      expect(closedRoofPrimitives.length).toBeGreaterThan(0);
      for (const roofPrimitive of closedRoofPrimitives) {
        if (roofPrimitive.shape !== "mesh") throw new Error("expected a closed roof mesh");
        expect(roofPrimitive.size[1]).toBeCloseTo(SLAB_THICKNESS_M, 8);
        expect(new Set(roofPrimitive.vertices.map((point) => point[1])).size).toBe(2);
        expect(roofPrimitive.triangleIndices.length).toBeGreaterThan(6);
      }
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

  test("covers an explicitly shaded verandah across the complete host footprint", () => {
    const requirements = createCurrentRequirements({
      ...DEFAULT_INTAKE_DRAFT,
      projectName: "Solid verandah canopy coverage",
      includeVerandah: true,
    }, {
      shadeStructures: [{
        id: "verandah-solid-canopy",
        type: "solid_canopy",
        location: "verandah",
        targetAreaM2: 4,
        source: "user",
      }],
    });
    const result = generateV3PhysicalStage(requirements);
    for (const { building } of result.schemes) {
      const verandah = building.floors.flatMap((floor) =>
        floor.spaces.map((space) => ({ floor, space })))
        .find(({ space }) => space.type === "verandah" && !space.id.includes("-stacked-support-space-"));
      const hostRegion = verandah?.floor.regions.find((region) => region.id === verandah.space.regionId);
      const canopy = building.roofSystems.find((roof) =>
        roof.kind === "solid_canopy" && roof.id === "verandah-solid-canopy");
      expect(hostRegion).toBeDefined();
      expect(canopy).toBeDefined();
      if (!hostRegion || !canopy || canopy.kind === "open_pergola") continue;
      expect(orthogonalPolygonAreaMm2(canopy.footprint))
        .toBe(orthogonalPolygonAreaMm2(hostRegion.polygon));
      expect(validateBuildingV3(building, requirements).findings.some((finding) =>
        finding.severity === "error" && finding.ruleId === "ROOF_GEOMETRY_INVALID")).toBe(false);
    }
  });

  test("rejects a physical candidate when an exposed top-floor room loses its cap", () => {
    const requirements = physicalRequirements();
    const building = structuredClone(generateV3PhysicalStage(requirements).schemes[0].building);
    const topFloor = [...building.floors].sort((left, right) => right.level - left.level)[0];
    const topSpace = topFloor.spaces.find((space) =>
      !["courtyard", "terrace"].includes(space.type)
      && !space.id.includes("-stacked-support-space-"));
    if (!topSpace) throw new Error("expected a top-floor enclosed space");
    building.roofSystems = building.roofSystems.filter((roof) =>
      roof.kind === "open_pergola"
        ? roof.hostSpaceId !== topSpace.id
        : !roof.servesSpaceIds.includes(topSpace.id));
    const report = validateBuildingV3(building, requirements);
    expect(report.findings).toContainEqual(expect.objectContaining({
      ruleId: "ROOF_GEOMETRY_INVALID",
      severity: "error",
      floorId: topFloor.id,
      message: "An exposed constructed floor region is missing complete roof coverage.",
    }));
  });

  test("realizes an explicit unbuilt-above-parking void with live intent-region ids", () => {
    const requirements = createCurrentRequirements({
      ...DEFAULT_INTAKE_DRAFT,
      projectName: "Explicit unbuilt above parking",
      floorCount: 3,
      includeParking: true,
      aboveParkingUse: { value: "unbuilt", source: "user" },
      programs: [
        { bedrooms: 1, bathrooms: 1, attachedBathrooms: 1, studies: 0, balcony: false },
        { bedrooms: 1, bathrooms: 1, attachedBathrooms: 1, studies: 0, balcony: false },
        { bedrooms: 1, bathrooms: 1, attachedBathrooms: 1, studies: 0, balcony: false },
        { bedrooms: 0, bathrooms: 0, attachedBathrooms: 0, studies: 0, balcony: false },
      ],
    });
    const result = generateV3PhysicalStage(requirements);
    expect(result.schemes.length).toBeGreaterThan(0);
    for (const { building } of result.schemes) {
      const intent = building.intentRealizations.find((realization) =>
        realization.requirementPath === "aboveParkingUse");
      expect(intent).toBeDefined();
      expect(intent?.status).toBe("realized");
      expect(intent?.realizedObjectIds.length).toBeGreaterThan(0);
      const regionsById = new Map(building.floors.flatMap((floor) =>
        floor.regions.map((region) => [region.id, region] as const)));
      for (const regionId of intent?.realizedObjectIds ?? []) {
        const region = regionsById.get(regionId);
        expect(region, `stale above-parking intent region ${regionId}`).toBeDefined();
        expect(region?.kind).toBe("intentional_unbuilt");
      }
      expect(validateBuildingV3(building, requirements).findings.some((finding) =>
        finding.severity === "error" && finding.ruleId === "FLOATING_VOLUME")).toBe(false);
    }
  });

  test("winds every roof-cap triangle so its geometric normal faces away from the cap", () => {
    const result = generateV3PhysicalStage(physicalRequirements());
    for (const { building } of result.schemes) {
      const massing = buildMassingModel(building);
      const roofMeshes = massing.primitives.filter((primitive) =>
        primitive.shape === "mesh" && primitive.semanticKind === "roof");
      expect(roofMeshes.length).toBeGreaterThan(0);
      for (const mesh of roofMeshes) {
        if (mesh.shape !== "mesh") throw new Error("expected a roof mesh");
        const centroid = mesh.vertices.reduce(
          (sum, vertex) => [sum[0] + vertex[0], sum[1] + vertex[1], sum[2] + vertex[2]],
          [0, 0, 0],
        ).map((value) => value / mesh.vertices.length);
        const yLevels = [...new Set(mesh.vertices.map((vertex) => vertex[1]))].sort((a, b) => a - b);
        expect(yLevels).toHaveLength(2);
        for (let cursor = 0; cursor < mesh.triangleIndices.length; cursor += 3) {
          const [a, b, c] = [
            mesh.vertices[mesh.triangleIndices[cursor]],
            mesh.vertices[mesh.triangleIndices[cursor + 1]],
            mesh.vertices[mesh.triangleIndices[cursor + 2]],
          ];
          const left = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
          const right = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
          const normal = [
            left[1] * right[2] - left[2] * right[1],
            left[2] * right[0] - left[0] * right[2],
            left[0] * right[1] - left[1] * right[0],
          ];
          const triangleYs = new Set([a[1], b[1], c[1]]);
          if (triangleYs.size === 1) {
            // Horizontal cap faces: top faces up, underside faces down.
            const expectUp = a[1] === yLevels[1];
            expect(Math.abs(normal[1])).toBeGreaterThan(0);
            expect(normal[1] > 0).toBe(expectUp);
          } else {
            // Vertical fascia faces: the horizontal normal must point away from the
            // cap centroid so front-face culling keeps the roof sides visible.
            const faceCentre = [(a[0] + b[0] + c[0]) / 3, (a[2] + b[2] + c[2]) / 3];
            const outward = (faceCentre[0] - centroid[0]) * normal[0]
              + (faceCentre[1] - centroid[2]) * normal[2];
            expect(Math.abs(normal[1])).toBe(0);
            expect(outward).toBeGreaterThan(0);
          }
        }
      }
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
