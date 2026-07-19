import { describe, expect, test } from "bun:test";

import { generateV3PhysicalStage } from "@/lib/building/generate-v3-physical";
import { currentBuildingRequirementsSchema } from "@/lib/building/requirements";
import { REFERENCE_ARTICULATED_SLOPED_REQUIREMENTS } from "@/lib/building/fixtures/reference-articulated-sloped";
import { generateBuilding } from "@/lib/building/generate";
import { orthogonalPolygonBounds } from "@/lib/building/orthogonal-partition";
import { roofPlanesForRectangle } from "@/lib/building/roofs";
import { buildMassingModel, massingMetrics } from "@/lib/render/massing";
import { buildSemanticRenderCameras } from "@/lib/render/camera";
import { buildCurrentRenderSpecs, compileCurrentGeometryLock, currentRenderSpecPreservesGeometry } from "@/lib/render/current-prompts";

function currentReferenceFixture() {
  const legacy = REFERENCE_ARTICULATED_SLOPED_REQUIREMENTS;
  const parking = legacy.rooms.find((room) => room.type === "parking")!;
  const requirements = currentBuildingRequirementsSchema.parse({
    ...legacy,
    requirementSchemaVersion: 3,
    entry: {
      primarySide: { value: "south", source: "user" },
      secondaryEntry: { value: "auto", source: "default" },
      primaryDoorClearWidthMm: 1200,
    },
    parking: {
      vehicleCount: 1,
      targetAreaMm2: parking.targetAreaMm2,
      minimumAreaMm2: parking.minAreaMm2,
      maximumAreaMm2: parking.targetAreaMm2 * 1.5,
      preferredSide: { value: "south", source: "user" },
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
    courtyard: { value: "open_to_sky", source: "user" },
    roof: { value: "sloped", source: "user" },
    shadeStructures: [{
      id: "upper-open-pergola",
      type: "open_pergola",
      location: "terrace",
      targetAreaM2: 7,
      source: "user",
    }],
    aboveParkingUse: { value: "occupied_rooms", source: "user" },
    maxExteriorPedestrianEntryCount: 2,
  });
  const building = generateV3PhysicalStage(requirements).schemes[0].building;
  return { building, requirements, massing: buildMassingModel(building) };
}

const currentReference = currentReferenceFixture();

describe("reference render before-state contract", () => {
  test("locks the current v2 massing inventory", () => {
    const { building } = generateBuilding(REFERENCE_ARTICULATED_SLOPED_REQUIREMENTS);
    const model = buildMassingModel(building);
    const primitiveCounts = Object.fromEntries(
      [...new Set(model.primitives.map((primitive) => primitive.kind))]
        .sort()
        .map((kind) => [kind, model.primitives.filter((primitive) => primitive.kind === kind).length]),
    );

    expect(massingMetrics(building)).toEqual({
      storeys: 3,
      heightM: 9.3,
      builtAreaM2: 577.5448,
      openingCount: 56,
      stairAligned: true,
      columnCount: 9,
    });
    expect(primitiveCounts).toEqual({
      column: 27,
      door_leaf: 39,
      exterior_wall: 120,
      interior_wall: 118,
      roof: 17,
      site: 1,
      slab: 42,
      stair: 36,
      window_glass: 14,
    });
  });

  test("historical sloped intent is overridden by flat-only physical generation", () => {
    const { building, massing } = currentReference;
    expect(building.roofSystems.some((roof) => roof.kind === "gable" || roof.kind === "hip" || roof.kind === "shed")).toBe(false);
    expect(building.roofSystems.filter((roof) => roof.kind !== "open_pergola")
      .every((roof) => roof.kind === "flat_slab" || roof.kind === "solid_canopy")).toBe(true);
    const roofMeshes = massing.primitives.filter((primitive) => primitive.shape === "mesh" && primitive.semanticKind === "roof");
    expect(roofMeshes.length).toBeGreaterThan(0);
    expect(roofMeshes.every((primitive) => {
      if (primitive.shape !== "mesh") return false;
      const yLevels = [...new Set(primitive.vertices.map((vertex) => vertex[1]))].sort((a, b) => a - b);
      return yLevels.length === 2 && Math.abs(yLevels[1] - yLevels[0] - 0.18) < 1e-9;
    })).toBe(true);
    const expectedPhysicalTopMm = Math.max(
      building.floors.at(-1)!.elevationMm + building.floors.at(-1)!.floorHeightMm,
      ...building.roofSystems.map((roof) => roof.kind === "open_pergola" ? roof.topElevationMm : roof.eaveHeightMm),
    );
    expect(massingMetrics(building).heightM).toBe(expectedPhysicalTopMm / 1000);
  });

  test("saved pitched v3 geometry is flattened at the massing display boundary", () => {
    const saved = structuredClone(currentReference.building);
    const roof = saved.roofSystems.find((candidate) => candidate.kind === "flat_slab");
    if (!roof || roof.kind === "open_pergola") throw new Error("expected enclosure roof");
    const bounds = orthogonalPolygonBounds(roof.footprint);
    roof.kind = "gable";
    roof.planes = roofPlanesForRectangle(roof.id, "gable", bounds, roof.eaveHeightMm);

    const massing = buildMassingModel(saved);
    const displayed = massing.primitives.filter((primitive) => primitive.shape === "mesh" && primitive.sourceId === roof.id);
    expect(displayed).toHaveLength(1);
    expect(displayed[0].id).toBe(`${roof.id}-closed-cap`);
    expect(displayed[0].shape === "mesh"
      && [...new Set(displayed[0].vertices.map((vertex) => vertex[1]))].sort((a, b) => a - b))
      .toEqual([roof.eaveHeightMm / 1000, roof.eaveHeightMm / 1000 + 0.18]);
    const expectedPhysicalTopMm = Math.max(
      saved.floors.at(-1)!.elevationMm + saved.floors.at(-1)!.floorHeightMm,
      ...saved.roofSystems.map((candidate) => candidate.kind === "open_pergola" ? candidate.topElevationMm : candidate.eaveHeightMm),
    );
    expect(massingMetrics(saved).heightM).toBe(expectedPhysicalTopMm / 1000);
  });

  test("every canopy and pergola has visible wall, ledger or post support primitives", () => {
    const { building, massing } = currentReference;
    const visibleSourceIds = new Set(massing.primitives.map((primitive) => primitive.sourceId).filter(Boolean));
    const shadedRoofs = building.roofSystems.filter((roof) => roof.kind === "solid_canopy" || roof.kind === "open_pergola");
    expect(shadedRoofs.length).toBeGreaterThan(0);
    for (const roof of shadedRoofs) {
      const reference = building.roofSupportReferences.find((candidate) => candidate.roofSystemId === roof.id)!;
      expect(reference).toBeDefined();
      for (const line of reference.bearingLines) {
        expect([...line.bearingWallIds, ...line.structuralColumnIds, ...line.secondarySupportIds]
          .some((sourceId) => visibleSourceIds.has(sourceId))).toBe(true);
      }
    }
  });

  test("elevated balcony and verandah open edges create guard primitives", () => {
    const { building, massing } = currentReference;
    const elevatedGuards = building.edgeProtections.filter((guard) => {
      const floor = building.floors.find((candidate) => candidate.id === guard.floorId);
      return (floor?.elevationMm ?? 0) > 0;
    });
    expect(elevatedGuards.length).toBeGreaterThan(0);
    for (const guard of elevatedGuards) {
      expect(massing.primitives.some((primitive) => primitive.semanticKind === "guard" && primitive.sourceId === guard.id)).toBe(true);
    }
  });

  test("open-pergola intent creates spaced linear members rather than a solid roof plane", () => {
    const { building, massing } = currentReference;
    const pergola = building.roofSystems.find((roof) => roof.kind === "open_pergola")!;
    expect(pergola.slatMembers.length).toBeGreaterThan(1);
    expect(pergola.openAreaRatio).toBeGreaterThanOrEqual(0.5);
    expect(massing.primitives.filter((primitive) => primitive.sourceId === pergola.id && primitive.shape === "linear_member").length)
      .toBe(pergola.frameMembers.length + pergola.slatMembers.length);
    expect(massing.primitives.some((primitive) => primitive.sourceId === pergola.id && primitive.shape === "mesh")).toBe(false);
  });

  test("the main-entry leaf is wider than interior leaves and uses a distinct material token", () => {
    const { building, massing } = currentReference;
    const openings = building.floors.flatMap((floor) => floor.openings);
    const main = openings.find((opening) => opening.role === "main_entry")!;
    const interiorWidths = openings.filter((opening) => opening.role === "interior_door").map((opening) => opening.widthMm);
    expect(main.widthMm).toBeGreaterThan(Math.max(...interiorWidths));
    expect(main.materialToken).toBe("door.main-entry.warm-wood");
    expect(massing.primitives.find((primitive) => primitive.sourceId === main.id)?.materialToken).toBe(main.materialToken);
  });

  test("GPT image 2 camera facts show the primary road facade and main entry", () => {
    const { building, requirements } = currentReference;
    const primary = building.facadeZones.find((zone) => zone.role === "primary_road_elevation" && zone.containsMainEntry)!;
    const main = building.floors.flatMap((floor) => floor.openings).find((opening) => opening.role === "main_entry")!;
    const camera = buildSemanticRenderCameras(building).primary_road_elevation;
    const selectedInteriorSpaceId = building.floors.flatMap((floor) => floor.spaces).find((space) => space.type === "living")!.id;
    const image2 = buildCurrentRenderSpecs({ building, requirements, selectedInteriorSpaceId })[0];
    expect(camera).toMatchObject({ facadeSide: primary.side, targetOpeningId: main.id, mainEntryMustBeVisible: true });
    expect(camera.targetWallIds).toContain(main.wallId);
    expect(image2).toMatchObject({ semanticView: "primary_road_elevation", releaseEvalTarget: "gpt_image_2_designer_elevation" });
    expect(image2.prompt).toContain("This is GPT IMAGE 2");
  });

  test("render prompts preserve canonical roofs, supports, guards, openings and footprint", () => {
    const { building, requirements } = currentReference;
    const selectedInteriorSpaceId = building.floors.flatMap((floor) => floor.spaces).find((space) => space.type === "living")!.id;
    const specs = buildCurrentRenderSpecs({ building, requirements, selectedInteriorSpaceId });
    const lock = compileCurrentGeometryLock(building);
    expect(lock.geometryHash).toBe(building.candidate.geometryHash);
    expect(Array.isArray(lock.roofSignatures)).toBe(true);
    expect(Array.isArray(lock.supportSignatures)).toBe(true);
    expect(Array.isArray(lock.guardSignatures)).toBe(true);
    expect(Array.isArray(lock.openingSignatures)).toBe(true);
    expect(Array.isArray(lock.floorRegionSignatures)).toBe(true);
    expect(lock.roofSignatures).toHaveLength(building.roofSystems.filter((roof) => roof.kind !== "open_pergola").length);
    expect(lock.supportSignatures).toHaveLength(building.secondaryRoofSupports.length);
    expect(lock.guardSignatures).toHaveLength(building.edgeProtections.length);
    expect(lock.openingSignatures).toHaveLength(building.floors.flatMap((floor) => floor.openings).length);
    expect(specs.every((spec) => currentRenderSpecPreservesGeometry(spec, building))).toBe(true);
  });
});
