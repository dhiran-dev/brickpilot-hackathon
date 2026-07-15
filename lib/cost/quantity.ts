import type { Building } from "@/lib/building/schema";
import type { QuantityTakeoff } from "@/lib/cost/schema";

const OPEN_AREA_TYPES = new Set(["terrace", "courtyard"]);

export function deriveQuantityTakeoff(building: Building): QuantityTakeoff {
  const floorAreasMm2 = building.floors.map((floor) => ({
    floorId: floor.id,
    areaMm2: floor.spaces.reduce((sum, space) => sum + (OPEN_AREA_TYPES.has(space.type) ? 0 : space.areaMm2), 0),
  }));

  return {
    grossFloorAreaMm2: floorAreasMm2.reduce((sum, floor) => sum + floor.areaMm2, 0),
    floorAreasMm2,
    floorCount: building.floors.length,
    spaceCount: building.floors.reduce((sum, floor) => sum + floor.spaces.length, 0),
    doorCount: building.floors.reduce((sum, floor) => sum + floor.openings.filter((opening) => opening.kind === "door").length, 0),
    windowCount: building.floors.reduce((sum, floor) => sum + floor.openings.filter((opening) => opening.kind === "window").length, 0),
    stairCount: building.verticalConnectors.length,
  };
}
