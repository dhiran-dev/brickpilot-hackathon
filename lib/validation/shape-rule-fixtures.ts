import { rectanglePolygon, type Building, type Floor, type Rectangle, type Space } from "@/lib/building/schema";
import { buildCanonicalWalls } from "@/lib/building/topology";

type FixtureCell = {
  id: string;
  name: string;
  type: Space["type"];
  bounds: Rectangle;
  occupied?: boolean;
};

function fixtureFloor(id: string, level: number, envelope: Rectangle, cells: FixtureCell[]): Floor {
  const spaces: Space[] = cells.map((cell) => ({
    id: cell.id,
    floorId: id,
    name: cell.name,
    type: cell.type,
    bounds: cell.bounds,
    planningCellPolygon: rectanglePolygon(cell.bounds),
    areaMm2: cell.bounds.width * cell.bounds.depth,
    occupied: cell.occupied ?? true,
    accessible: false,
  }));
  return {
    id,
    label: level === 0 ? "Ground floor" : `Floor ${level}`,
    level,
    elevationMm: level * 3_100,
    floorHeightMm: 3_100,
    envelope,
    spaces,
    walls: buildCanonicalWalls(id, envelope, spaces),
    openings: [],
  };
}

function fixtureBuilding(id: string, floors: Floor[]): Building {
  const envelope = floors[0].envelope;
  return {
    buildingSchemaVersion: 2,
    algorithmVersion: "shape-rule-fixture-v1",
    rulePackVersion: "shape-rule-fixture-v1",
    rendererVersion: "shape-rule-fixture-v1",
    seed: 1,
    candidate: { generatorId: "fixture", index: 0, score: 0, geometryHash: id },
    site: {
      widthMm: envelope.width,
      depthMm: envelope.depth,
      facing: "north",
      roadEdges: ["north"],
      buildableEnvelope: envelope,
    },
    floors,
    verticalConnectors: floors.length > 1 ? [{
      id: "stair-core",
      kind: "dog_leg_stair",
      servedFloorIds: floors.map((floor) => floor.id),
      boundsByFloor: Object.fromEntries(floors.map((floor) => [floor.id, { x: 7_000, y: 8_000, width: 3_000, depth: 4_000 }])),
      widthMm: 1_000,
      riseMm: 172,
      runMm: 270,
      direction: "north",
    }] : [],
  };
}

const GOLDEN_ENVELOPE = { x: 0, y: 0, width: 10_000, depth: 12_000 };

/**
 * A deliberately hand-tiled two-floor villa proof. Its three-by-three composition avoids
 * full-span strips, holds circulation to 12.5%, keeps the gallery to one-third of the floor
 * depth, and projects the ground-floor court as an upper terrace.
 */
export const HAND_TILED_KNOWN_GOOD_BUILDING = fixtureBuilding("hand-tiled-known-good", [
  fixtureFloor("F0", 0, GOLDEN_ENVELOPE, [
    { id: "f0-living", name: "Living", type: "living", bounds: { x: 0, y: 0, width: 4_000, depth: 4_000 } },
    { id: "f0-dining", name: "Dining", type: "dining", bounds: { x: 4_000, y: 0, width: 3_000, depth: 4_000 } },
    { id: "f0-kitchen", name: "Kitchen", type: "kitchen", bounds: { x: 7_000, y: 0, width: 3_000, depth: 4_000 } },
    { id: "f0-bedroom-a", name: "Bedroom A", type: "bedroom", bounds: { x: 0, y: 4_000, width: 4_000, depth: 4_000 } },
    { id: "f0-gallery", name: "Stair lobby gallery", type: "circulation", bounds: { x: 4_000, y: 4_000, width: 3_000, depth: 4_000 } },
    { id: "f0-bedroom-b", name: "Bedroom B", type: "bedroom", bounds: { x: 7_000, y: 4_000, width: 3_000, depth: 4_000 } },
    { id: "f0-study", name: "Study", type: "study", bounds: { x: 0, y: 8_000, width: 4_000, depth: 4_000 } },
    { id: "f0-court", name: "Court", type: "courtyard", bounds: { x: 4_000, y: 8_000, width: 3_000, depth: 4_000 }, occupied: false },
    { id: "f0-stair", name: "Stair", type: "stair", bounds: { x: 7_000, y: 8_000, width: 3_000, depth: 4_000 }, occupied: false },
  ]),
  fixtureFloor("F1", 1, GOLDEN_ENVELOPE, [
    { id: "f1-bedroom-a", name: "Bedroom C", type: "bedroom", bounds: { x: 0, y: 0, width: 4_000, depth: 4_000 } },
    { id: "f1-study", name: "Upper study", type: "study", bounds: { x: 4_000, y: 0, width: 3_000, depth: 4_000 } },
    { id: "f1-bedroom-b", name: "Bedroom D", type: "bedroom", bounds: { x: 7_000, y: 0, width: 3_000, depth: 4_000 } },
    { id: "f1-family", name: "Family living", type: "living", bounds: { x: 0, y: 4_000, width: 4_000, depth: 4_000 } },
    { id: "f1-gallery", name: "Upper stair lobby gallery", type: "circulation", bounds: { x: 4_000, y: 4_000, width: 3_000, depth: 4_000 } },
    { id: "f1-bedroom-c", name: "Bedroom E", type: "bedroom", bounds: { x: 7_000, y: 4_000, width: 3_000, depth: 4_000 } },
    { id: "f1-bedroom-d", name: "Bedroom F", type: "bedroom", bounds: { x: 0, y: 8_000, width: 4_000, depth: 4_000 } },
    { id: "f1-terrace", name: "Court terrace", type: "terrace", bounds: { x: 4_000, y: 8_000, width: 3_000, depth: 4_000 }, occupied: false },
    { id: "f1-stair", name: "Stair", type: "stair", bounds: { x: 7_000, y: 8_000, width: 3_000, depth: 4_000 }, occupied: false },
  ]),
]);

const DORMITORY_ENVELOPE = { x: 0, y: 0, width: 10_000, depth: 14_000 };

/** Captured full-depth-spine pattern from the pre-parti generator regression. */
export const CAPTURED_DORMITORY_PATTERN_BUILDING = fixtureBuilding("captured-dormitory-pattern", [
  fixtureFloor("F0", 0, DORMITORY_ENVELOPE, [
    { id: "left-living", name: "Left living", type: "living", bounds: { x: 0, y: 0, width: 3_500, depth: 3_500 } },
    { id: "left-bedroom-a", name: "Left bedroom A", type: "bedroom", bounds: { x: 0, y: 3_500, width: 3_500, depth: 3_500 } },
    { id: "left-bedroom-b", name: "Left bedroom B", type: "bedroom", bounds: { x: 0, y: 7_000, width: 3_500, depth: 3_500 } },
    { id: "left-bedroom-c", name: "Left bedroom C", type: "bedroom", bounds: { x: 0, y: 10_500, width: 3_500, depth: 3_500 } },
    { id: "full-depth-spine", name: "Full-depth central spine", type: "circulation", bounds: { x: 3_500, y: 0, width: 1_000, depth: 14_000 } },
    { id: "right-living", name: "Right living", type: "living", bounds: { x: 4_500, y: 0, width: 5_500, depth: 4_000 } },
    { id: "right-pooja", name: "Strip pooja", type: "pooja", bounds: { x: 4_500, y: 4_000, width: 5_500, depth: 1_500 } },
    { id: "right-bedroom-a", name: "Right bedroom A", type: "bedroom", bounds: { x: 4_500, y: 5_500, width: 5_500, depth: 4_250 } },
    { id: "right-bedroom-b", name: "Right bedroom B", type: "bedroom", bounds: { x: 4_500, y: 9_750, width: 5_500, depth: 4_250 } },
  ]),
]);
