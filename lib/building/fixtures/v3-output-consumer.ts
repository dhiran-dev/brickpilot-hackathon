import { currentBuildingSchema } from "@/lib/building/schema";
import { V3_GEOMETRY_POLICY_VERSION } from "@/lib/building/v3-constants";

const envelope = {
  points: [
    { x: 0, y: 0 },
    { x: 0, y: 6000 },
    { x: 6000, y: 6000 },
    { x: 6000, y: 0 },
  ],
};

const living = {
  points: [
    { x: 0, y: 0 },
    { x: 0, y: 6000 },
    { x: 3000, y: 6000 },
    { x: 3000, y: 0 },
  ],
};

const circulation = {
  points: [
    { x: 3000, y: 0 },
    { x: 3000, y: 6000 },
    { x: 4000, y: 6000 },
    { x: 4000, y: 0 },
  ],
};

const intentionalUnbuilt = {
  points: [
    { x: 4000, y: 0 },
    { x: 4000, y: 6000 },
    { x: 6000, y: 6000 },
    { x: 6000, y: 0 },
  ],
};

/**
 * Hand-authored consumer fixture. It deliberately bypasses topology/circulation
 * generation so drawing, deck, CAD and cost tests do not drift with generator
 * connectivity while those stages evolve.
 */
export const V3_OUTPUT_CONSUMER_BUILDING = currentBuildingSchema.parse({
  buildingSchemaVersion: 3,
  geometryPolicyVersion: V3_GEOMETRY_POLICY_VERSION,
  algorithmVersion: "v3-output-consumer-fixture-1",
  rulePackVersion: "rules-v3-fixture",
  rendererVersion: "renderer-v3-fixture",
  seed: 7,
  candidate: { generatorId: "consumer-fixture", index: 0, score: 100, geometryHash: "v3-output-consumer" },
  site: {
    widthMm: 6000,
    depthMm: 6000,
    facing: "south",
    roadEdges: ["south"],
    buildableEnvelope: { x: 0, y: 0, width: 6000, depth: 6000 },
  },
  floors: [{
    id: "F0",
    label: "Ground floor",
    level: 0,
    elevationMm: 0,
    floorHeightMm: 3000,
    envelope,
    regions: [
      { id: "region-living", kind: "interior", polygon: living, spaceId: "living" },
      { id: "region-circulation", kind: "interior", polygon: circulation, spaceId: "circulation" },
      { id: "region-future", kind: "intentional_unbuilt", polygon: intentionalUnbuilt },
    ],
    spaces: [
      { id: "living", floorId: "F0", name: "Living", type: "living", regionId: "region-living", accessible: true },
      { id: "circulation", floorId: "F0", name: "Circulation", type: "circulation", regionId: "region-circulation", accessible: true },
    ],
    walls: [
      { id: "wall-west", floorId: "F0", start: { x: 0, y: 0 }, end: { x: 0, y: 6000 }, thicknessMm: 230, type: "exterior", adjacentSpaceIds: ["living"] },
      { id: "wall-south", floorId: "F0", start: { x: 0, y: 6000 }, end: { x: 4000, y: 6000 }, thicknessMm: 230, type: "exterior", adjacentSpaceIds: ["living"] },
      { id: "wall-east", floorId: "F0", start: { x: 4000, y: 6000 }, end: { x: 4000, y: 0 }, thicknessMm: 230, type: "exterior", adjacentSpaceIds: ["living"] },
      { id: "wall-north", floorId: "F0", start: { x: 4000, y: 0 }, end: { x: 0, y: 0 }, thicknessMm: 230, type: "exterior", adjacentSpaceIds: ["living"] },
    ],
    openings: [{
      id: "door-main",
      floorId: "F0",
      wallId: "wall-south",
      kind: "door",
      usage: "pedestrian",
      role: "main_entry",
      materialToken: "door.main-entry.warm-wood",
      offsetMm: 1000,
      widthMm: 1200,
      heightMm: 2400,
      sillHeightMm: 0,
      connects: ["EXTERIOR", "living"],
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
    columns: [{ id: "column-southwest", center: { x: 0, y: 6000 }, widthMm: 300, depthMm: 300, servedFloorIds: ["F0"] }],
  },
  roofSystems: [{
    id: "roof-main",
    servesSpaceIds: ["living", "circulation"],
    footprint: living,
    kind: "gable",
    planes: [
      { id: "roof-main-west", vertices: [{ x: 0, y: 0, z: 3000 }, { x: 2000, y: 0, z: 3600 }, { x: 2000, y: 6000, z: 3600 }, { x: 0, y: 6000, z: 3000 }], drainageDirection: { x: -1, y: 0 } },
      { id: "roof-main-east", vertices: [{ x: 4000, y: 6000, z: 3000 }, { x: 2000, y: 6000, z: 3600 }, { x: 2000, y: 0, z: 3600 }, { x: 4000, y: 0, z: 3000 }], drainageDirection: { x: 1, y: 0 } },
    ],
    eaveHeightMm: 3000,
    overhangMm: 450,
  }],
  secondaryRoofSupports: [],
  roofSupportReferences: [{
    roofSystemId: "roof-main",
    bearingLines: [{ id: "bearing-south", segment: { start: { x: 0, y: 6000 }, end: { x: 4000, y: 6000 } }, role: "perimeter", bearingWallIds: ["wall-south"], structuralColumnIds: [], secondarySupportIds: [] }],
  }],
  edgeProtections: [{ id: "guard-future-edge", floorId: "F0", edge: { start: { x: 4000, y: 0 }, end: { x: 4000, y: 6000 } }, kind: "metal_rail", heightMm: 1100, dropHeightMm: 3000 }],
  facadeZones: [{ side: "south", exteriorWallIds: ["wall-south"], articulationPolygons: [], role: "primary_road_elevation", containsMainEntry: true, allowedMaterialArticulation: ["stone.feature", "timber.screen"] }],
  intentRealizations: [
    { requirementPath: "entry.primarySide", requestedValue: "south", realizedObjectIds: ["door-main"], status: "realized" },
    { requirementPath: "roof", requestedValue: "sloped", realizedObjectIds: ["roof-main"], status: "realized" },
  ],
});

export const V3_OUTPUT_CONSUMER_BUILT_AREA_MM2 = 24_000_000;
export const V3_OUTPUT_CONSUMER_UNBUILT_AREA_MM2 = 12_000_000;
