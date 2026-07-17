import type { BuildingRequirements } from "@/lib/building/requirements";
import type { Building } from "@/lib/building/schema";
import { resolveRegionalPack, type ClimateClass } from "@/lib/design/regional-packs";
import { isOpenToSkySpace } from "@/lib/building/topology";
import type { ValidationReport } from "@/lib/validation/types";

export type ClimateScoreEvidence = {
  climateClass: ClimateClass;
  scoreAdjustment: number;
  evidence: string[];
};

function ratio(value: number, total: number) {
  return value / Math.max(1, total);
}

/** Produces deterministic, user-readable climate evidence from canonical geometry only. */
export function climateOrientationEvidence(
  building: Building,
  requirements: BuildingRequirements,
): ClimateScoreEvidence {
  const resolution = resolveRegionalPack(requirements.region.countryCode, requirements.region.adminArea);
  const spaces = building.floors.flatMap((floor) => floor.spaces);
  const totalPlateArea = building.floors.reduce((sum, floor) => sum + floor.envelope.width * floor.envelope.depth, 0);
  const courtArea = spaces.filter((space) => space.type === "courtyard").reduce((sum, space) => sum + space.areaMm2, 0);
  const terraceArea = spaces.filter((space) => space.type === "terrace").reduce((sum, space) => sum + space.areaMm2, 0);
  const verandahArea = spaces.filter((space) => space.type === "verandah").reduce((sum, space) => sum + space.areaMm2, 0);
  const coveredArea = spaces.filter((space) => !isOpenToSkySpace(space)).reduce((sum, space) => sum + space.areaMm2, 0);
  const courtRatio = ratio(courtArea, totalPlateArea);
  const shadedOutdoorRatio = ratio(terraceArea + verandahArea, totalPlateArea);
  const compactness = ratio(coveredArea, totalPlateArea);
  const facing = building.site.facing;

  switch (resolution.climateClass) {
    case "hot_humid": {
      const adjustment = Math.min(2.5, verandahArea / 8_000_000) + Math.min(2, courtRatio * 16);
      return {
        climateClass: resolution.climateClass,
        scoreAdjustment: adjustment,
        evidence: [
          `Hot-humid response: ${(verandahArea / 1_000_000).toFixed(1)} m² of covered verandah supports shaded air movement.`,
          `The ${facing}-facing entry and ${(courtRatio * 100).toFixed(1)}% court ratio are retained as orientation and cross-ventilation evidence.`,
        ],
      };
    }
    case "hot_dry": {
      const adjustment = Math.min(4, courtRatio * 30) + Math.max(0, 1 - shadedOutdoorRatio) * 0.5;
      return {
        climateClass: resolution.climateClass,
        scoreAdjustment: adjustment,
        evidence: [
          `Hot-dry response: ${(courtArea / 1_000_000).toFixed(1)} m² of court area forms a shaded thermal buffer.`,
          `The ${facing}-facing arrival is recorded so exposed openings can be protected during design development.`,
        ],
      };
    }
    case "cold_continental": {
      const adjustment = Math.max(0, compactness - 0.65) * 8 - courtRatio * 3;
      return {
        climateClass: resolution.climateClass,
        scoreAdjustment: adjustment,
        evidence: [
          `Cold-climate response: ${(compactness * 100).toFixed(1)}% plate coverage rewards a compact envelope.`,
          `The ${facing}-facing orientation is persisted for later equator-facing glazing review.`,
        ],
      };
    }
    case "mediterranean": {
      const adjustment = Math.min(4, shadedOutdoorRatio * 18);
      return {
        climateClass: resolution.climateClass,
        scoreAdjustment: adjustment,
        evidence: [
          `Mediterranean response: ${((terraceArea + verandahArea) / 1_000_000).toFixed(1)} m² of terrace/verandah supports shaded outdoor living.`,
          `The ${facing}-facing entry is retained as solar-orientation evidence.`,
        ],
      };
    }
    case "temperate":
    default: {
      const adjustment = Math.min(2.5, shadedOutdoorRatio * 12) + Math.min(1.5, courtRatio * 10);
      return {
        climateClass: resolution.climateClass,
        scoreAdjustment: adjustment,
        evidence: [
          `Temperate response: ${((terraceArea + verandahArea) / 1_000_000).toFixed(1)} m² of moderated outdoor space balances sun and shade.`,
          `The ${facing}-facing entry is persisted for seasonal orientation review.`,
        ],
      };
    }
  }
}

/**
 * Ranks already-valid deterministic candidates. Validation remains the hard pass/fail boundary;
 * this score only chooses among candidates that passed it.
 */
export function softCandidateScore(
  building: Building,
  validation: ValidationReport,
  requirements: BuildingRequirements,
) {
  const targetById = new Map(requirements.rooms.map((room) => [room.id, room.targetAreaMm2]));
  const areaPenalty = building.floors.reduce((total, floor) => total + floor.spaces.reduce((floorTotal, space) => {
    const target = targetById.get(space.id);
    return floorTotal + (target ? Math.abs(space.areaMm2 - target) / target : 0);
  }, 0), 0);
  const circulationArea = building.floors.reduce((total, floor) => total + floor.spaces
    .filter((space) => space.type === "circulation")
    .reduce((sum, space) => sum + space.areaMm2, 0), 0);
  const totalArea = building.floors.reduce((total, floor) => total + floor.envelope.width * floor.envelope.depth, 0);
  const repeatedBandPenalty = building.floors.reduce((total, floor) => {
    const constructed = floor.spaces.filter((space) => !isOpenToSkySpace(space));
    const bands = new Map<string, number>();
    for (const space of constructed) {
      const key = `${space.bounds.x}:${space.bounds.width}`;
      bands.set(key, (bands.get(key) ?? 0) + 1);
    }
    const largestRepeatedBand = Math.max(1, ...bands.values());
    return total + Math.max(0, largestRepeatedBand - 2) / Math.max(1, constructed.length);
  }, 0);
  const openToSkyRatio = building.floors.reduce((total, floor) => total + floor.spaces
    .filter(isOpenToSkySpace)
    .reduce((sum, space) => sum + space.areaMm2, 0), 0) / Math.max(1, totalArea);
  const formReward = requirements.architecture.formStrategy === "compact" ? 0 : Math.min(0.15, openToSkyRatio) * 24;
  const climateReward = climateOrientationEvidence(building, requirements).scoreAdjustment;
  return validation.score
    - areaPenalty * 1.5
    - circulationArea / Math.max(1, totalArea) * 8
    - repeatedBandPenalty * 6
    + formReward
    + climateReward;
}
