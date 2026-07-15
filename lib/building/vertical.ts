import type { BuildingRequirements, FloorRequirement } from "@/lib/building/requirements";
import type { CandidateRoom } from "@/lib/building/candidates/types";
import type { Floor, Rectangle, VerticalConnector } from "@/lib/building/schema";

export function stairCoreBounds(requirements: BuildingRequirements, envelope: Rectangle): Rectangle {
  const clearWidth = requirements.vertical.stairWidthMm;
  const dogLeg = requirements.vertical.stairFamily === "dog_leg";
  const width = dogLeg ? clearWidth * 2 + 230 : clearWidth + 230;
  const depth = dogLeg ? Math.max(3200, clearWidth * 3) : Math.max(4200, clearWidth * 4);
  if (width + 900 >= envelope.width || depth + 900 >= envelope.depth) {
    throw new Error("STAIR_CORE_EXCEEDS_ENVELOPE");
  }
  return { x: envelope.x, y: envelope.y, width, depth };
}

export function stairCandidateRoom(floor: FloorRequirement, bounds: Rectangle): CandidateRoom {
  const area = bounds.width * bounds.depth;
  return {
    id: `${floor.id}-stair`,
    name: "Stair core",
    type: "stair",
    floorId: floor.id,
    minAreaMm2: area,
    targetAreaMm2: area,
    accessible: false,
    occupied: true,
    bounds,
  };
}

export function floorElevations(floors: FloorRequirement[]) {
  const ordered = [...floors].sort((left, right) => left.level - right.level);
  const elevations = new Map<string, number>();
  let elevation = 0;
  for (const floor of ordered) {
    elevations.set(floor.id, elevation);
    elevation += floor.floorHeightMm;
  }
  return elevations;
}

export function buildVerticalConnectors(requirements: BuildingRequirements, floors: Floor[]): VerticalConnector[] {
  if (floors.length < 2) return [];
  const servedFloorIds = [...floors].sort((left, right) => left.level - right.level).map((floor) => floor.id);
  const boundsByFloor = Object.fromEntries(servedFloorIds.map((floorId) => {
    const stair = floors.find((floor) => floor.id === floorId)?.spaces.find((space) => space.type === "stair");
    if (!stair) throw new Error(`MISSING_STAIR_SPACE:${floorId}`);
    return [floorId, stair.bounds];
  }));
  const typicalHeight = floors.slice(0, -1).reduce((sum, floor) => sum + floor.floorHeightMm, 0) / (floors.length - 1);
  const risers = Math.max(1, Math.ceil(typicalHeight / 180));
  return [{
    id: "main-stair",
    kind: requirements.vertical.stairFamily === "dog_leg" ? "dog_leg_stair" : "straight_stair",
    servedFloorIds,
    boundsByFloor,
    widthMm: requirements.vertical.stairWidthMm,
    riseMm: Math.round(typicalHeight / risers),
    runMm: 280,
    direction: requirements.site.facing,
  }];
}
