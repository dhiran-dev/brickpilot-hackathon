import { reviewBuilding } from "@/lib/ai/architectural-review";
import type { callJsonModeCompletion } from "@/lib/ai/client";
import type { ArchitecturalReviewResult } from "@/lib/ai/schema";
import { BuildingGenerationError, generateBuildingSchemes, type BuildingGenerationErrorCode, type GeneratedScheme, type GenerationDiagnostics } from "@/lib/building/generate";
import {
  V3AllocationGenerationError,
  withRequiredV3VerticalCirculation,
} from "@/lib/building/generate-v3-allocation";
import {
  V3CirculationGenerationError,
} from "@/lib/building/generate-v3-circulation";
import { generateV3PhysicalStage, type V3PhysicalDiagnostics, type V3PhysicalScheme } from "@/lib/building/generate-v3-physical";
import {
  buildingRequirementsContractVersion,
  currentBuildingRequirementsSchema,
  legacyBuildingRequirementsSchema,
  type CurrentBuildingRequirements,
  type LegacyBuildingRequirements,
  type ReadableBuildingRequirements,
} from "@/lib/building/requirements";
import type { LegacyBuilding } from "@/lib/building/schema";
import { estimateBuildingCost } from "@/lib/cost";
import type { CostEstimate } from "@/lib/cost/schema";
import {
  V3ValidationStageError,
  validateV3SchemeStage,
  type V3ValidatedScheme,
  type ValidationFinding,
  type ValidationFindingV3,
  type ValidationReport,
  type ValidationReportV3,
} from "@/lib/validation";

export type LegacyPipelineResult =
  | {
      status: "generated";
      building: LegacyBuilding;
      validation: ValidationReport;
      costEstimate: CostEstimate;
      intent: Record<string, unknown>;
      aiReview: ArchitecturalReviewResult;
      schemes: GeneratedScheme[];
      selectedSchemeId: string;
      diagnostics: GenerationDiagnostics;
    }
  | { status: "failed"; code: BuildingGenerationErrorCode; message: string; conflicts: ValidationFinding[]; diagnostics?: GenerationDiagnostics };

/** Backwards-compatible result alias for callers that predate contract dispatch. */
export type PipelineResult = LegacyPipelineResult;
export type CurrentPipelineResult =
  | {
      status: "generated";
      requirementSchemaVersion: 3;
      physicalContractVersion: "physical-stage-v3";
      validationContractVersion: "validation-stage-v3";
      building: V3PhysicalScheme["building"];
      validation: ValidationReportV3;
      costEstimate: CostEstimate;
      aiReview: ArchitecturalReviewResult;
      schemes: V3ValidatedScheme[];
      selectedSchemeId: string;
      diagnostics: V3PipelineDiagnostics;
      intent: {
        requirementSchemaVersion: 3;
        buildingSchemaVersion: 3;
        rendererVersion: string;
        physicalContractVersion: "physical-stage-v3";
        validationContractVersion: "validation-stage-v3";
        physicalDiagnostics: V3PhysicalDiagnostics;
        validationDiagnostics: V3PipelineDiagnostics["validation"];
        assumptions: string[];
      };
    }
  | { status: "failed"; code: string; message: string; conflicts: ValidationFindingV3[]; diagnostics?: Record<string, unknown> };
export type ReadablePipelineResult = LegacyPipelineResult | CurrentPipelineResult;
export type DesignPipelineContractVersion = "v2" | "v3";
export type V3PipelineDiagnostics = V3PhysicalDiagnostics & {
  validation: {
    contractVersion: "validation-stage-v3";
    acceptedSchemeCount: number;
    rejectedSchemeCount: number;
    schemeSetValid: boolean;
  };
};
export type DesignPipelineOptions = {
  reviewComplete?: typeof callJsonModeCompletion;
  /** Focused test seam for proving allocation failures remain typed at the pipeline boundary. */
  v3GeneratePhysical?: typeof generateV3PhysicalStage;
  /** Focused test seam for proving that cost cannot run before hard validation. */
  v3EstimateCost?: typeof estimateBuildingCost;
  /** Focused test seam for proving downstream stages cannot bypass hard validation. */
  v3ValidateSchemes?: typeof validateV3SchemeStage;
};

function applyFlatOnlyRoofPolicy(requirements: CurrentBuildingRequirements) {
  return currentBuildingRequirementsSchema.parse({
    ...requirements,
    architecture: { ...requirements.architecture, roofCharacter: "flat_parapet" },
    roof: { value: "flat_parapet", source: "default" },
  });
}

export class DesignPipelineContractError extends Error {
  constructor(
    readonly code: "REQUIREMENTS_CONTRACT_MISMATCH" | "UNSUPPORTED_DESIGN_CONTRACT",
    message: string,
  ) {
    super(message);
    this.name = "DesignPipelineContractError";
  }
}

const OPTIONAL_MOVE_CANDIDATE_TYPES = [
  "study",
  "pooja",
  "store",
  "bedroom",
] as const;

function allocationFailureAction(
  requirements: CurrentBuildingRequirements,
  floor: CurrentBuildingRequirements["floors"][number],
  affectedRequirementIds: readonly string[],
  infeasibleFloorIds: ReadonlySet<string>,
  minimumAreaByFloor: ReadonlyMap<string, number>,
  buildableAreaMm2: number,
) {
  const roomsOnFloor = requirements.rooms.filter((room) => room.floorId === floor.id);
  const affected = new Set(affectedRequirementIds);
  const movable = OPTIONAL_MOVE_CANDIDATE_TYPES.flatMap((type) =>
    roomsOnFloor.filter((room) => room.type === type))
    .sort((left, right) => Number(affected.has(right.id)) - Number(affected.has(left.id)))[0];
  const capacityFloor = movable
    ? requirements.floors
        .filter((candidate) => candidate.id !== floor.id && !infeasibleFloorIds.has(candidate.id))
        .sort((left, right) => left.level - right.level)
        .find((candidate) =>
          (minimumAreaByFloor.get(candidate.id) ?? 0) + movable.minAreaMm2 <= buildableAreaMm2)
    : undefined;
  if (movable && capacityFloor) {
    return `Move ${movable.name} from ${floor.label} to ${capacityFloor.label}, which has minimum-area capacity.`;
  }
  return `Increase the buildable envelope serving ${floor.label}; reduce setbacks only where local rules permit.`;
}

function allocationFailureConflicts(
  error: V3AllocationGenerationError,
  requirements: CurrentBuildingRequirements,
): ValidationFindingV3[] {
  const planningRequirements = withRequiredV3VerticalCirculation(requirements);
  const floorById = new Map(planningRequirements.floors.map((floor) => [floor.id, floor]));
  const floorByLevel = new Map(planningRequirements.floors.map((floor) => [floor.level, floor]));
  const roomById = new Map(planningRequirements.rooms.map((room) => [room.id, room]));
  const rejectedRequirementIds = [
    ...error.requirementIds,
    ...(error.diagnostics?.rejectedSchemes?.flatMap((rejection) => rejection.requirementIds) ?? []),
  ];
  const uniqueRequirementIds = [...new Set(rejectedRequirementIds)];
  const requirementIdsByFloor = new Map<string, string[]>();

  for (const requirementId of uniqueRequirementIds) {
    const room = roomById.get(requirementId);
    const inferredStairLevel = /^stair-f(\d+)$/.exec(requirementId)?.[1];
    const floor = room
      ? floorById.get(room.floorId)
      : inferredStairLevel
        ? floorByLevel.get(Number(inferredStairLevel))
        : requirementId === "aboveParkingUse"
          ? [...planningRequirements.floors].sort((left, right) => left.level - right.level).find((candidate) => candidate.level > 0)
          : undefined;
    if (!floor) continue;
    requirementIdsByFloor.set(floor.id, [
      ...(requirementIdsByFloor.get(floor.id) ?? []),
      requirementId,
    ]);
  }

  if (requirementIdsByFloor.size === 0) {
    const fallbackFloor = [...planningRequirements.floors].sort((left, right) => left.level - right.level)[0];
    if (fallbackFloor) {
      requirementIdsByFloor.set(
        fallbackFloor.id,
        planningRequirements.rooms.filter((room) => room.floorId === fallbackFloor.id).map((room) => room.id),
      );
    }
  }

  const buildableWidthMm = Math.max(
    0,
    planningRequirements.site.widthMm - planningRequirements.site.setbacksMm.east - planningRequirements.site.setbacksMm.west,
  );
  const buildableDepthMm = Math.max(
    0,
    planningRequirements.site.depthMm - planningRequirements.site.setbacksMm.north - planningRequirements.site.setbacksMm.south,
  );
  const buildableAreaMm2 = buildableWidthMm * buildableDepthMm;
  const minimumAreaByFloor = new Map(planningRequirements.floors.map((candidate) => [
    candidate.id,
    planningRequirements.rooms
      .filter((room) => room.floorId === candidate.id)
      .reduce((sum, room) => sum + room.minAreaMm2, 0),
  ]));
  const infeasibleFloorIds = new Set(requirementIdsByFloor.keys());

  return [...requirementIdsByFloor.entries()].map(([floorId, requirementIds]) => {
    const floor = floorById.get(floorId)!;
    const minimumProgramAreaMm2 = minimumAreaByFloor.get(floorId) ?? 0;
    const exceedsEnvelope = minimumProgramAreaMm2 > buildableAreaMm2;
    return {
      ruleId: "PLANNING_PROGRAM_AREA_INFEASIBLE",
      ruleVersion: 1,
      severity: "error",
      category: "planning",
      floorId,
      objectIds: [...new Set(requirementIds)],
      ...(exceedsEnvelope
        ? {
            measured: { value: minimumProgramAreaMm2, unit: "mm2" },
            required: { max: buildableAreaMm2, unit: "mm2" },
          }
        : {}),
      message: exceedsEnvelope
        ? `${floor.label} requires at least ${(minimumProgramAreaMm2 / 1_000_000).toFixed(1)} m², but its buildable envelope provides ${(buildableAreaMm2 / 1_000_000).toFixed(1)} m².`
        : `${floor.label} cannot be arranged inside its ${(buildableAreaMm2 / 1_000_000).toFixed(1)} m² buildable envelope while preserving hard room-area, frontage, and protected-circulation rules.`,
      suggestedAction: allocationFailureAction(
        planningRequirements,
        floor,
        requirementIds,
        infeasibleFloorIds,
        minimumAreaByFloor,
        buildableAreaMm2,
      ),
      sourceKind: "requirement_and_geometry",
    };
  });
}

/** Frozen schema-v2 generation, validation, costing and AI-review behavior. */
export async function runDesignPipelineV2(
  requirements: LegacyBuildingRequirements,
  options: DesignPipelineOptions = {},
): Promise<LegacyPipelineResult> {
  let generated;
  try {
    generated = generateBuildingSchemes(requirements);
  } catch (error) {
    if (error instanceof BuildingGenerationError) {
      const diagnostics = error.code === "GENERATION_TIMEOUT" ? error.cause as GenerationDiagnostics : undefined;
      return { status: "failed", code: error.code, message: error.message, conflicts: error.conflicts, diagnostics };
    }
    throw error;
  }

  const selected = generated.schemes[0];
  if (!selected) throw new Error("Scheme generation completed without a selectable result.");
  const costEstimate = estimateBuildingCost(selected.building, requirements);
  const aiReview = await reviewBuilding(
    { requirements, building: selected.building, validation: selected.validation },
    { complete: options.reviewComplete },
  );
  const intent = {
    requirementSchemaVersion: requirements.requirementSchemaVersion,
    buildingSchemaVersion: selected.building.buildingSchemaVersion,
    rendererVersion: selected.building.rendererVersion,
    evaluatedCandidateCount: generated.evaluatedCandidateCount,
    generationDiagnostics: generated.diagnostics,
    assumptions: [
      "Concept feasibility geometry uses rectangular planning cells and baseline residential heuristics.",
      selected.building.structuralConcept
        ? `${selected.building.structuralConcept.columns.length} aligned conceptual pillar locations were coordinated through the modeled floors. This is not member sizing, load analysis, foundation design, or structural approval.`
        : "No preliminary column-coordination concept is available for this legacy result.",
      "Validation is not permit, licensed architectural, structural, MEP, or jurisdictional approval.",
      costEstimate.status === "available"
        ? `Cost uses ${costEstimate.selection.ratePackName} (${costEstimate.selection.ratePackVersion}).`
        : "No native regional rate pack was available; cost is intentionally unavailable.",
    ],
  };

  return {
    status: "generated",
    building: selected.building,
    validation: selected.validation,
    costEstimate,
    intent,
    aiReview,
    schemes: generated.schemes,
    selectedSchemeId: selected.schemeId,
    diagnostics: generated.diagnostics,
  };
}

/** V3 promotes only an authoritative hard-valid selected scheme into cost and advisory review. */
export async function runDesignPipelineV3(
  requirements: CurrentBuildingRequirements,
  options: DesignPipelineOptions = {},
): Promise<CurrentPipelineResult> {
  const parsed = currentBuildingRequirementsSchema.safeParse(requirements);
  if (!parsed.success) {
    throw new DesignPipelineContractError(
      "REQUIREMENTS_CONTRACT_MISMATCH",
      "The v3 design pipeline requires valid schema-v3 requirements.",
    );
  }
  const activeRequirements = applyFlatOnlyRoofPolicy(parsed.data);
  try {
    const generatePhysical = options.v3GeneratePhysical ?? generateV3PhysicalStage;
    const generated = generatePhysical(activeRequirements);
    const validateSchemes = options.v3ValidateSchemes ?? validateV3SchemeStage;
    const validated = validateSchemes(generated.schemes, activeRequirements, { cohortId: "pipeline-v3" });
    const selected = validated.schemes.find((scheme) => scheme.schemeId === validated.selectedSchemeId);
    if (!selected || !selected.validation.valid || selected.building.candidate.geometryHash !== validated.building.candidate.geometryHash) {
      throw new Error("V3_SELECTED_SCHEME_INVARIANT_FAILED");
    }
    const estimateCost = options.v3EstimateCost ?? estimateBuildingCost;
    const costEstimate = estimateCost(selected.building, activeRequirements);
    const aiReview = await reviewBuilding(
      { requirements: activeRequirements, building: selected.building, validation: selected.validation },
      { complete: options.reviewComplete },
    );
    const validationDiagnostics: V3PipelineDiagnostics["validation"] = {
      contractVersion: validated.contractVersion,
      acceptedSchemeCount: validated.schemes.length,
      rejectedSchemeCount: validated.rejectedSchemes.length,
      schemeSetValid: validated.schemeSet.valid,
    };
    const diagnostics: V3PipelineDiagnostics = { ...generated.diagnostics, validation: validationDiagnostics };
    return {
      status: "generated",
      requirementSchemaVersion: 3,
      physicalContractVersion: generated.contractVersion,
      validationContractVersion: validated.contractVersion,
      building: selected.building,
      validation: selected.validation,
      costEstimate,
      aiReview,
      schemes: validated.schemes,
      selectedSchemeId: validated.selectedSchemeId,
      diagnostics,
      intent: {
        requirementSchemaVersion: 3,
        buildingSchemaVersion: 3,
        rendererVersion: selected.building.rendererVersion,
        physicalContractVersion: generated.contractVersion,
        validationContractVersion: validated.contractVersion,
        physicalDiagnostics: generated.diagnostics,
        validationDiagnostics,
        assumptions: [
          "Canonical schema-v3 regions, openings, roofs, supports, guards, and facade zones passed authoritative deterministic validation before downstream work.",
          `${selected.building.structuralConcept.columns.length} conceptual column locations and ${selected.building.secondaryRoofSupports.length} secondary roof supports are coordination evidence only; licensed structural design remains required.`,
          costEstimate.status === "available"
            ? `Cost uses ${costEstimate.selection.ratePackName} (${costEstimate.selection.ratePackVersion}); physical-system quantities remain informational within the GFA base rate.`
            : "No native regional rate pack was available; cost is intentionally unavailable.",
          "AI review is advisory and evidence-bound; it cannot alter canonical geometry or replace licensed architectural, structural, MEP, permit, or jurisdictional review.",
        ],
      },
    };
  } catch (error) {
    if (error instanceof V3AllocationGenerationError) return {
      status: "failed",
      code: "NO_FEASIBLE_LAYOUT",
      message: "The requested minimum program cannot fit while preserving access and area rules.",
      conflicts: allocationFailureConflicts(error, parsed.data),
      diagnostics: {
        allocationFailure: {
          code: error.code,
          requirementIds: error.requirementIds,
        },
        ...(error.diagnostics ? { allocation: error.diagnostics } : {}),
      },
    };
    if (error instanceof V3CirculationGenerationError) return {
      status: "failed",
      code: error.code,
      message: error.message,
      conflicts: [],
      diagnostics: error.diagnostics,
    };
    if (error instanceof V3ValidationStageError) return {
      status: "failed",
      code: error.code,
      message: error.message,
      conflicts: error.rejectedSchemes.flatMap((scheme) => scheme.findings),
      diagnostics: { rejectedSchemes: error.rejectedSchemes },
    };
    throw error;
  }
}

/**
 * Contract-aware seam used by lifecycle/API callers. Both versions return persistence-complete
 * generated results, but their mutation schemas and generation implementations remain isolated.
 */
export function runDesignPipelineForContract(
  contractVersion: "v2",
  requirements: ReadableBuildingRequirements | unknown,
  options?: DesignPipelineOptions,
): Promise<LegacyPipelineResult>;
export function runDesignPipelineForContract(
  contractVersion: "v3",
  requirements: ReadableBuildingRequirements | unknown,
  options?: DesignPipelineOptions,
): Promise<CurrentPipelineResult>;
export async function runDesignPipelineForContract(
  contractVersion: DesignPipelineContractVersion,
  requirements: ReadableBuildingRequirements | unknown,
  options: DesignPipelineOptions = {},
): Promise<ReadablePipelineResult> {
  const actualContractVersion = buildingRequirementsContractVersion(requirements);
  if (actualContractVersion && actualContractVersion !== contractVersion) {
    throw new DesignPipelineContractError(
      "REQUIREMENTS_CONTRACT_MISMATCH",
      `Reserved ${contractVersion} generation cannot consume ${actualContractVersion} requirements.`,
    );
  }
  if (contractVersion === "v3") {
    const parsed = currentBuildingRequirementsSchema.safeParse(requirements);
    if (!parsed.success) throw new DesignPipelineContractError(
      "REQUIREMENTS_CONTRACT_MISMATCH",
      "The v3 design pipeline requires valid schema-v3 requirements.",
    );
    return runDesignPipelineV3(parsed.data, options);
  }
  const parsed = legacyBuildingRequirementsSchema.safeParse(requirements);
  if (!parsed.success) {
    throw new DesignPipelineContractError(
      "REQUIREMENTS_CONTRACT_MISMATCH",
      "The v2 design pipeline requires valid schema-v2 requirements.",
    );
  }
  return runDesignPipelineV2(parsed.data, options);
}

/** Backwards-compatible entry point. Existing callers continue to execute the frozen v2 path. */
export const runDesignPipeline = runDesignPipelineV2;
