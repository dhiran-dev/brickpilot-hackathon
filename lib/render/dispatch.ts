import {
  currentBuildingRequirementsSchema,
  legacyBuildingRequirementsSchema,
  type CurrentBuildingRequirements,
  type LegacyBuildingRequirements,
} from "@/lib/building/requirements";
import {
  currentBuildingSchema,
  legacyBuildingSchema,
  type CurrentBuilding,
  type LegacyBuilding,
  type ReadableBuilding,
} from "@/lib/building/schema";
import { buildCurrentRenderSpecs, CURRENT_RENDER_CONTRACT_VERSION, type CurrentRenderSpec } from "@/lib/render/current-prompts";
import { buildRenderSpecs, RENDER_CONTRACT_VERSION, type RenderSpec } from "@/lib/render/prompts";

export type VersionedRenderSpec = RenderSpec | CurrentRenderSpec;

export type RenderDispatch =
  | {
      buildingSchemaVersion: 2;
      renderContractVersion: typeof RENDER_CONTRACT_VERSION;
      building: LegacyBuilding;
      requirements: LegacyBuildingRequirements;
      specs: RenderSpec[];
    }
  | {
      buildingSchemaVersion: 3;
      renderContractVersion: typeof CURRENT_RENDER_CONTRACT_VERSION;
      building: CurrentBuilding;
      requirements: CurrentBuildingRequirements;
      specs: CurrentRenderSpec[];
    };

/** Fail-closed render compiler. The v2 branch delegates to the frozen compiler unchanged. */
export function dispatchRenderSpecs(input: {
  building: unknown;
  requirements: unknown;
  selectedInteriorSpaceId: string;
}): RenderDispatch {
  const version = typeof input.building === "object" && input.building !== null && "buildingSchemaVersion" in input.building
    ? (input.building as { buildingSchemaVersion?: unknown }).buildingSchemaVersion
    : null;
  if (version === 2) {
    const building = legacyBuildingSchema.parse(input.building);
    const requirements = legacyBuildingRequirementsSchema.parse(input.requirements);
    return {
      buildingSchemaVersion: 2,
      renderContractVersion: RENDER_CONTRACT_VERSION,
      building,
      requirements,
      specs: buildRenderSpecs({ building, requirements, selectedInteriorSpaceId: input.selectedInteriorSpaceId }),
    };
  }
  if (version === 3) {
    const building = currentBuildingSchema.parse(input.building);
    const requirements = currentBuildingRequirementsSchema.parse(input.requirements);
    return {
      buildingSchemaVersion: 3,
      renderContractVersion: CURRENT_RENDER_CONTRACT_VERSION,
      building,
      requirements,
      specs: buildCurrentRenderSpecs({ building, requirements, selectedInteriorSpaceId: input.selectedInteriorSpaceId }),
    };
  }
  throw new Error("UNSUPPORTED_RENDER_BUILDING_VERSION");
}

export function renderEligibleInteriorSpace(building: ReadableBuilding, spaceId: string) {
  if (building.buildingSchemaVersion === 2) {
    const floor = building.floors.find((candidate) => candidate.spaces.some((space) => space.id === spaceId));
    const space = floor?.spaces.find((candidate) => candidate.id === spaceId);
    if (!space || ["parking", "circulation", "stair", "courtyard", "terrace", "balcony", "verandah", "utility"].includes(space.type)) return null;
    return space.occupied ? space : null;
  }
  const floor = building.floors.find((candidate) => candidate.spaces.some((space) => space.id === spaceId));
  const space = floor?.spaces.find((candidate) => candidate.id === spaceId);
  if (!floor || !space || ["parking", "circulation", "stair", "courtyard", "terrace", "balcony", "verandah", "utility"].includes(space.type)) return null;
  const region = floor.regions.find((candidate) => candidate.id === space.regionId);
  return region?.kind === "interior" ? space : null;
}

export function renderContractVersionForBuilding(building: ReadableBuilding) {
  return building.buildingSchemaVersion === 3 ? CURRENT_RENDER_CONTRACT_VERSION : RENDER_CONTRACT_VERSION;
}

export function isSupportedRenderContractVersion(value: unknown): value is 2 | 3 {
  return value === RENDER_CONTRACT_VERSION || value === CURRENT_RENDER_CONTRACT_VERSION;
}
