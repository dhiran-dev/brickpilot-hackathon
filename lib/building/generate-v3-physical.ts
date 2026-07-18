import type { CurrentBuildingRequirements } from "@/lib/building/requirements";
import { currentBuildingSchema, type CurrentBuilding, type CurrentFloor, type FacadeZone, type IntentRealization, type VerticalConnector, type WallSegment } from "@/lib/building/schema";
import { generateV3CirculationStage, type V3CirculationDiagnostics } from "@/lib/building/generate-v3-circulation";
import type { V3CirculatedScheme } from "@/lib/building/candidates/v3-circulation";
import { buildV3StructuralConcept } from "@/lib/building/structure";
import { deriveV3RoofSystems, evaluateRoofSupportCompleteness } from "@/lib/building/roofs";
import { deriveV3EdgeProtections } from "@/lib/building/edge-protection";
import { V3_GEOMETRY_POLICY_VERSION } from "@/lib/building/v3-constants";

export type V3PhysicalScheme = { schemeId: string; building: CurrentBuilding };
export type V3PhysicalDiagnostics = V3CirculationDiagnostics & {
  physicalContractVersion: "physical-stage-v3";
  physicalSchemeCount: number;
  roofSystemCount: number;
  secondarySupportCount: number;
  edgeProtectionCount: number;
};
export type V3PhysicalStageResult = {
  contractVersion: "physical-stage-v3";
  schemes: V3PhysicalScheme[];
  selectedSchemeId: string;
  diagnostics: V3PhysicalDiagnostics;
};

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function currentFloors(scheme: V3CirculatedScheme): CurrentFloor[] {
  return scheme.floors.map((floor) => ({
    id: floor.floorId,
    label: floor.label,
    level: floor.level,
    elevationMm: floor.elevationMm,
    floorHeightMm: floor.floorHeightMm,
    envelope: floor.envelope,
    regions: floor.regions,
    spaces: floor.spaces.map((space) => ({
      id: space.id,
      floorId: space.floorId,
      name: space.name,
      type: space.type,
      regionId: space.regionId,
      accessible: space.accessible,
    })),
    walls: floor.walls,
    openings: floor.openings,
  }));
}

function verticalConnectors(requirements: CurrentBuildingRequirements, scheme: V3CirculatedScheme): VerticalConnector[] {
  const floors = [...scheme.floors].sort((left, right) => left.level - right.level);
  if (floors.length < 2) return [];
  const stairs = floors.map((floor) => {
    const stair = floor.spaces.find((space) => space.type === "stair");
    if (!stair) throw new Error(`VERTICAL_STAIR_REQUIRED:${floor.floorId}`);
    return { floor, stair };
  });
  const reference = stairs[0].stair.bounds;
  for (const { floor, stair } of stairs.slice(1)) {
    if (stair.bounds.x !== reference.x || stair.bounds.y !== reference.y
      || stair.bounds.width !== reference.width || stair.bounds.depth !== reference.depth) {
      throw new Error(`VERTICAL_STAIR_NOT_ALIGNED:${floor.floorId}:${stair.id}`);
    }
  }
  const boundsByFloor = Object.fromEntries(stairs.map(({ floor, stair }) => [floor.floorId, stair.bounds]));
  const totalRiseMm = floors.at(-1)!.elevationMm - floors[0].elevationMm;
  return [{
    id: "main-vertical-stair",
    kind: requirements.vertical.stairFamily === "straight" ? "straight_stair" : "dog_leg_stair",
    servedFloorIds: floors.map((floor) => floor.floorId),
    boundsByFloor,
    widthMm: requirements.vertical.stairWidthMm,
    riseMm: totalRiseMm,
    runMm: Math.max(reference.width, reference.depth),
    direction: scheme.arrivalReservations.primaryRoadSide,
  }];
}

function wallSide(wall: WallSegment, site: CurrentBuildingRequirements["site"]) {
  const envelope = {
    x: site.setbacksMm.west,
    y: site.setbacksMm.north,
    width: site.widthMm - site.setbacksMm.west - site.setbacksMm.east,
    depth: site.depthMm - site.setbacksMm.north - site.setbacksMm.south,
  };
  if (wall.start.y === envelope.y && wall.end.y === envelope.y) return "north" as const;
  if (wall.start.x === envelope.x + envelope.width && wall.end.x === envelope.x + envelope.width) return "east" as const;
  if (wall.start.y === envelope.y + envelope.depth && wall.end.y === envelope.y + envelope.depth) return "south" as const;
  if (wall.start.x === envelope.x && wall.end.x === envelope.x) return "west" as const;
  return undefined;
}

function facadeZones(requirements: CurrentBuildingRequirements, floors: CurrentFloor[], scheme: V3CirculatedScheme): FacadeZone[] {
  const allWalls = floors.flatMap((floor) => floor.walls);
  const mainWall = allWalls.find((wall) => wall.id === scheme.arrivalRealization.mainEntryWallId);
  if (!mainWall) throw new Error(`FACADE_ENTRY_CONFLICT:${scheme.arrivalRealization.mainEntryWallId}`);
  const actualSide = wallSide(mainWall, requirements.site);
  if (!actualSide || actualSide !== scheme.arrivalRealization.primaryRoadSide) throw new Error(`FACADE_ENTRY_CONFLICT:${scheme.schemeId}:ENTRY_NOT_ON_RESERVED_ROAD_SIDE`);
  return requirements.site.roadEdges.map((side): FacadeZone => {
    const exteriorWallIds = allWalls.filter((wall) => wall.type === "exterior" && wallSide(wall, requirements.site) === side).map((wall) => wall.id);
    if (side === actualSide && !exteriorWallIds.includes(mainWall.id)) exteriorWallIds.push(mainWall.id);
    return {
      side,
      exteriorWallIds,
      articulationPolygons: [],
      role: side === actualSide ? "primary_road_elevation" : "secondary_road_elevation",
      containsMainEntry: side === actualSide,
      allowedMaterialArticulation: side === actualSide
        ? ["stone.feature", "timber.screen", "mineral.plaster", "metal.shadow-line"]
        : ["mineral.plaster", "timber.accent"],
    };
  });
}

function intentRealizations(
  requirements: CurrentBuildingRequirements,
  scheme: V3CirculatedScheme,
  building: Omit<CurrentBuilding, "intentRealizations">,
): IntentRealization[] {
  const mainEntry = building.floors.flatMap((floor) => floor.openings).find((opening) => opening.role === "main_entry");
  const roofIds = building.roofSystems.filter((roof) => roof.kind !== "open_pergola").map((roof) => roof.id);
  const courtyardIds = building.floors.flatMap((floor) => {
    const courtyardSpaceIds = new Set(floor.spaces.filter((space) => space.type === "courtyard").map((space) => space.id));
    return floor.regions.filter((region) => (region.spaceId && courtyardSpaceIds.has(region.spaceId)) || region.kind === "open_to_sky").map((region) => region.id);
  });
  const courtyardAbsentAsRequested = requirements.courtyard.value === "none" && courtyardIds.length === 0;
  const aboveParkingRegionIds = scheme.aboveParking.flatMap((allocation) => allocation.realizedRegionIds);
  const parkingObjects = building.floors.flatMap((floor) => {
    const parkingIds = new Set(floor.spaces.filter((space) => space.type === "parking").map((space) => space.id));
    const vehicleOpenings = floor.openings.filter((opening) => opening.role === "vehicle_entry");
    return [
      ...parkingIds,
      ...floor.regions.filter((region) => region.spaceId && parkingIds.has(region.spaceId)).map((region) => region.id),
      ...vehicleOpenings.map((opening) => opening.id),
    ];
  });
  const vehicleOpening = building.floors.flatMap((floor) => floor.openings.map((opening) => ({ floor, opening }))).find(({ opening }) => opening.role === "vehicle_entry");
  const vehicleWall = vehicleOpening?.floor.walls.find((wall) => wall.id === vehicleOpening.opening.wallId);
  const vehicleSide = vehicleWall ? wallSide(vehicleWall, requirements.site) : undefined;
  const requestedParkingSide = requirements.parking.preferredSide.value;
  const parkingSideRealized = Boolean(vehicleSide)
    && (requestedParkingSide === "auto_road_side" ? requirements.site.roadEdges.includes(vehicleSide!) : vehicleSide === requestedParkingSide);
  return [
    { requirementPath: "entry.primarySide", requestedValue: requirements.entry.primarySide.value, realizedObjectIds: mainEntry ? [mainEntry.id] : [], status: mainEntry ? "realized" : "incompatible", relaxationCode: mainEntry ? undefined : "MAIN_ENTRY_MISSING" },
    { requirementPath: "roof", requestedValue: requirements.roof.value, realizedObjectIds: roofIds, status: roofIds.length > 0 ? "realized" : "incompatible", relaxationCode: roofIds.length > 0 ? undefined : "ROOF_INTENT_NOT_REALIZED" },
    {
      requirementPath: "courtyard",
      requestedValue: requirements.courtyard.value,
      realizedObjectIds: courtyardAbsentAsRequested ? building.floors.map((floor) => floor.id) : courtyardIds,
      status: courtyardAbsentAsRequested || courtyardIds.length > 0 ? "realized" : "incompatible",
      relaxationCode: courtyardAbsentAsRequested || courtyardIds.length > 0 ? undefined : "COURTYARD_NOT_REALIZED",
    },
    {
      requirementPath: "aboveParkingUse",
      requestedValue: requirements.aboveParkingUse.value,
      realizedObjectIds: aboveParkingRegionIds,
      status: aboveParkingRegionIds.length > 0 ? "realized" : "relaxed",
      relaxationCode: aboveParkingRegionIds.length > 0 ? undefined : "ABOVE_PARKING_NOT_APPLICABLE",
    },
    ...requirements.outdoorAreas.map((outdoor): IntentRealization => {
      const objectIds = building.floors.flatMap((floor) => {
        if (floor.id !== outdoor.floorId) return [];
        const spaceIds = new Set(floor.spaces.filter((space) => space.type === outdoor.type).map((space) => space.id));
        return [...spaceIds, ...floor.regions.filter((region) => region.spaceId && spaceIds.has(region.spaceId)).map((region) => region.id)];
      });
      return {
        requirementPath: "outdoorAreas",
        requirementId: outdoor.id,
        requestedValue: outdoor.type,
        realizedObjectIds: objectIds,
        status: objectIds.length > 0 ? "realized" : "incompatible",
        relaxationCode: objectIds.length > 0 ? undefined : "OUTDOOR_AREA_NOT_REALIZED",
      };
    }),
    {
      requirementPath: "parking.preferredSide",
      requestedValue: requestedParkingSide,
      realizedObjectIds: parkingSideRealized ? parkingObjects : [],
      status: parkingSideRealized ? "realized" : "relaxed",
      relaxationCode: parkingSideRealized ? undefined : requirements.parking.vehicleCount === 0 ? "PARKING_NOT_REQUESTED" : "PARKING_SIDE_RELAXED",
    },
    ...requirements.shadeStructures.map((shade): IntentRealization => {
      const realized = building.roofSystems.find((roof) => roof.id === shade.id && roof.kind === shade.type);
      return {
        requirementPath: "shadeStructures",
        requirementId: shade.id,
        requestedValue: shade.type,
        realizedObjectIds: realized ? [realized.id] : [],
        status: realized ? "realized" : "incompatible",
        relaxationCode: realized ? undefined : "SHADE_STRUCTURE_NOT_REALIZED",
      };
    }),
  ];
}

export function realizeV3PhysicalScheme(requirements: CurrentBuildingRequirements, scheme: V3CirculatedScheme, index = 0): CurrentBuilding {
  const floors = currentFloors(scheme);
  const structuralConcept = buildV3StructuralConcept(floors);
  const physicalRoofs = deriveV3RoofSystems(requirements, scheme, structuralConcept);
  const supportIssues = evaluateRoofSupportCompleteness({
    ...physicalRoofs,
    structuralConcept,
    walls: floors.flatMap((floor) => floor.walls),
  });
  if (supportIssues.length > 0) throw new Error(`ROOF_SUPPORT_INCOMPLETE:${supportIssues.map((issue) => `${issue.roofSystemId}:${issue.code}`).join(",")}`);
  const withoutIntent = {
    buildingSchemaVersion: 3 as const,
    geometryPolicyVersion: V3_GEOMETRY_POLICY_VERSION,
    algorithmVersion: "deterministic-plan-v3-physical-1",
    rulePackVersion: "concept-rulepack-v3",
    rendererVersion: "massing-v3-mesh-1",
    seed: requirements.seed,
    candidate: { generatorId: scheme.partiId, index, score: Math.max(0, 100 - scheme.surplusPenalty), geometryHash: "pending" },
    site: {
      widthMm: requirements.site.widthMm,
      depthMm: requirements.site.depthMm,
      facing: requirements.site.facing,
      roadEdges: requirements.site.roadEdges,
      buildableEnvelope: {
        x: requirements.site.setbacksMm.west,
        y: requirements.site.setbacksMm.north,
        width: requirements.site.widthMm - requirements.site.setbacksMm.west - requirements.site.setbacksMm.east,
        depth: requirements.site.depthMm - requirements.site.setbacksMm.north - requirements.site.setbacksMm.south,
      },
    },
    floors,
    verticalConnectors: verticalConnectors(requirements, scheme),
    structuralConcept,
    ...physicalRoofs,
    edgeProtections: deriveV3EdgeProtections(requirements, scheme),
    facadeZones: facadeZones(requirements, floors, scheme),
  };
  const intent = intentRealizations(requirements, scheme, withoutIntent);
  const geometryHash = stableHash(JSON.stringify({ ...withoutIntent, candidate: { ...withoutIntent.candidate, geometryHash: undefined }, intent }));
  return currentBuildingSchema.parse({ ...withoutIntent, candidate: { ...withoutIntent.candidate, geometryHash }, intentRealizations: intent });
}

export function generateV3PhysicalStage(requirements: CurrentBuildingRequirements): V3PhysicalStageResult {
  const circulation = generateV3CirculationStage(requirements);
  const schemes = circulation.schemes.map((scheme, index) => ({ schemeId: scheme.schemeId, building: realizeV3PhysicalScheme(requirements, scheme, index) }));
  return {
    contractVersion: "physical-stage-v3",
    schemes,
    selectedSchemeId: schemes[0].schemeId,
    diagnostics: {
      ...circulation.diagnostics,
      physicalContractVersion: "physical-stage-v3",
      physicalSchemeCount: schemes.length,
      roofSystemCount: schemes.reduce((sum, scheme) => sum + scheme.building.roofSystems.length, 0),
      secondarySupportCount: schemes.reduce((sum, scheme) => sum + scheme.building.secondaryRoofSupports.length, 0),
      edgeProtectionCount: schemes.reduce((sum, scheme) => sum + scheme.building.edgeProtections.length, 0),
    },
  };
}
