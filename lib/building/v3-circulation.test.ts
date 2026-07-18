import { describe, expect, test } from "bun:test";

import { CONSTRAINED_SINGLE_PARTI_REQUIREMENTS, REFERENCE_ARTICULATED_SLOPED_REQUIREMENTS } from "@/lib/building/fixtures/reference-articulated-sloped";
import { generateV3AllocationStage } from "@/lib/building/generate-v3-allocation";
import { generateV3CirculationStage } from "@/lib/building/generate-v3-circulation";
import { realizeV3Circulation, V3CirculationInfeasibleError } from "@/lib/building/candidates/v3-circulation";
import { currentBuildingRequirementsSchema } from "@/lib/building/requirements";
import { v3SpaceAccessSemantics } from "@/lib/building/space-semantics-v3";
import { MAIN_ENTRY_MIN_CLEAR_WIDTH_MM, VEHICLE_APERTURE_MIN_CLEAR_WIDTH_MM } from "@/lib/building/v3-constants";
import { orthogonalPolygonBounds } from "@/lib/building/orthogonal-partition";

function wallSide(
  wall: { start: { x: number; y: number }; end: { x: number; y: number } },
  envelope: { x: number; y: number; width: number; depth: number },
) {
  if (wall.start.y === envelope.y && wall.end.y === envelope.y) return "north";
  if (wall.start.x === envelope.x + envelope.width && wall.end.x === envelope.x + envelope.width) return "east";
  if (wall.start.y === envelope.y + envelope.depth && wall.end.y === envelope.y + envelope.depth) return "south";
  if (wall.start.x === envelope.x && wall.end.x === envelope.x) return "west";
  return "internal";
}

function referenceRequirements() {
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
    roof: { value: legacy.architecture.roofCharacter, source: "user" },
    shadeStructures: [],
    aboveParkingUse: { value: "occupied_rooms", source: "user" },
    maxExteriorPedestrianEntryCount: 2,
  });
}

function constrainedRequirements() {
  const legacy = CONSTRAINED_SINGLE_PARTI_REQUIREMENTS;
  return currentBuildingRequirementsSchema.parse({
    ...legacy,
    requirementSchemaVersion: 3,
    entry: { primarySide: { value: "east", source: "user" }, secondaryEntry: { value: "auto", source: "default" }, primaryDoorClearWidthMm: 1200 },
    parking: { vehicleCount: 0, preferredSide: { value: "east", source: "user" } },
    outdoorAreas: [],
    courtyard: { value: "none", source: "user" },
    roof: { value: legacy.architecture.roofCharacter, source: "user" },
    shadeStructures: [],
    aboveParkingUse: { value: "auto", source: "default" },
    maxExteriorPedestrianEntryCount: 2,
  });
}

describe("v3 arrival, privacy, and openings", () => {
  test("keeps parking and outdoor verandahs out of the access spine", () => {
    expect(v3SpaceAccessSemantics({ id: "parking", type: "parking" })).toMatchObject({ mayRelayPedestrianAccess: false, vehicleArrival: true });
    expect(v3SpaceAccessSemantics({ id: "verandah", type: "verandah" })).toMatchObject({ mayRelayPedestrianAccess: false, openExterior: true });
    expect(v3SpaceAccessSemantics({ id: "gallery", type: "circulation" })).toMatchObject({ role: "interior_access_spine" });
    expect(v3SpaceAccessSemantics({ id: "gallery", type: "circulation" }, { protectedGallerySpaceIds: new Set(["gallery"]) })).toMatchObject({ role: "protected_gallery", mayRelayPedestrianAccess: true });
  });

  test("realizes one distinct road-side main entry before doors and a canonical vehicle aperture", () => {
    const result = generateV3CirculationStage(referenceRequirements());
    expect(result.schemes).toHaveLength(3);
    for (const scheme of result.schemes) {
      const openings = scheme.floors.flatMap((floor) => floor.openings);
      const main = openings.filter((opening) => opening.role === "main_entry");
      const vehicle = openings.filter((opening) => opening.role === "vehicle_entry");
      const pedestrianExterior = openings.filter((opening) => opening.usage === "pedestrian" && opening.connects.includes("EXTERIOR"));
      expect(scheme.circulationGraph.unreachableSpaceIds).toEqual([]);
      expect(main).toHaveLength(1);
      expect(openings[0].id).toBe(main[0].id);
      expect(main[0]).toMatchObject({ connects: ["EXTERIOR", "foyer"], widthMm: 1200, materialToken: "door.main-entry.warm-wood" });
      expect(main[0].widthMm).toBeGreaterThanOrEqual(MAIN_ENTRY_MIN_CLEAR_WIDTH_MM);
      const ground = scheme.floors.find((floor) => floor.level === 0)!;
      const envelope = orthogonalPolygonBounds(ground.envelope);
      const mainWall = ground.walls.find((wall) => wall.id === main[0].wallId)!;
      expect(wallSide(mainWall, envelope)).toBe(scheme.arrivalRealization.primaryRoadSide);
      expect(vehicle).toHaveLength(1);
      expect(vehicle[0]).toMatchObject({ usage: "vehicle", connects: ["EXTERIOR", "parking"], widthMm: VEHICLE_APERTURE_MIN_CLEAR_WIDTH_MM });
      const vehicleWall = ground.walls.find((wall) => wall.id === vehicle[0].wallId)!;
      const vehicleSide = wallSide(vehicleWall, envelope);
      expect(vehicleSide).not.toBe("internal");
      expect(referenceRequirements().site.roadEdges.some((side) => side === vehicleSide)).toBe(true);
      expect(pedestrianExterior.length).toBeLessThanOrEqual(2);
      const interior = openings.find((opening) => opening.role === "interior_door");
      expect(interior?.widthMm).toBeLessThan(main[0].widthMm);
      expect(interior?.materialToken).not.toBe(main[0].materialToken);
    }
  });

  test("never creates private access from parking, verandah, or the open exterior", () => {
    const result = generateV3CirculationStage(referenceRequirements());
    const privateTypes = new Set(["bedroom", "bathroom", "pooja"]);
    for (const scheme of result.schemes) {
      const typeById = new Map(scheme.floors.flatMap((floor) => floor.spaces).map((space) => [space.id, space.type]));
      for (const opening of scheme.floors.flatMap((floor) => floor.openings).filter((item) => item.usage === "pedestrian")) {
        if (!opening.connects.some((id) => privateTypes.has(typeById.get(id) ?? ""))) continue;
        expect(opening.connects.some((id) => id === "EXTERIOR" || typeById.get(id) === "parking" || typeById.get(id) === "verandah")).toBe(false);
      }
    }
  });

  test("keeps the constrained honest option connected without service or private relay paths", () => {
    const result = generateV3CirculationStage(constrainedRequirements());
    expect(result.schemes).toHaveLength(1);
    const scheme = result.schemes[0];
    expect(scheme.circulationGraph.unreachableSpaceIds).toEqual([]);
    const typeById = new Map(scheme.floors.flatMap((floor) => floor.spaces).map((space) => [space.id, space.type]));
    const relayIds = new Set(scheme.circulationGraph.nodes
      .filter((node) => node.semantics.mayRelayPedestrianAccess)
      .map((node) => node.spaceId));
    expect([...relayIds].every((id) => !["parking", "verandah", "kitchen", "utility", "bedroom", "bathroom", "pooja"].includes(typeById.get(id) ?? ""))).toBe(true);
  });

  test("connects every declared attached bathroom only through its bedroom", () => {
    const requirements = referenceRequirements();
    const result = generateV3CirculationStage(requirements);
    const openings = result.schemes[0].floors.flatMap((floor) => floor.openings);
    const attachedPairs = requirements.relationships.filter((relationship) => relationship.type === "must_connect").filter((relationship) => {
      const from = requirements.rooms.find((room) => room.id === relationship.fromRoomId)?.type;
      const to = requirements.rooms.find((room) => room.id === relationship.toRoomId)?.type;
      return (from === "bedroom" && to === "bathroom") || (from === "bathroom" && to === "bedroom");
    });
    for (const relationship of attachedPairs) {
      const bathroomId = requirements.rooms.find((room) => room.id === relationship.fromRoomId)?.type === "bathroom"
        ? relationship.fromRoomId
        : relationship.toRoomId;
      const bedroomId = bathroomId === relationship.fromRoomId ? relationship.toRoomId : relationship.fromRoomId;
      const bathroomOpenings = openings.filter((opening) => opening.connects.includes(bathroomId));
      expect(bathroomOpenings).toHaveLength(1);
      expect(bathroomOpenings[0].connects).toEqual([bedroomId, bathroomId]);
    }
  });

  test("rejects a missing main-entry host without mutating allocation geometry", () => {
    const requirements = referenceRequirements();
    const allocated = generateV3AllocationStage(requirements).schemes[0];
    const broken = structuredClone(allocated);
    broken.floors[0].walls = broken.floors[0].walls.filter((wall) => !wall.adjacentSpaceIds.includes("foyer"));
    const before = structuredClone(broken);
    expect(() => realizeV3Circulation(requirements, broken)).toThrow(V3CirculationInfeasibleError);
    expect(broken).toEqual(before);
  });
});
