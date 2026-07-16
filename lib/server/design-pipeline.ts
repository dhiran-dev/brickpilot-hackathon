import { reviewBuilding } from "@/lib/ai/architectural-review";
import type { callJsonModeCompletion } from "@/lib/ai/client";
import type { ArchitecturalReviewResult } from "@/lib/ai/schema";
import { BuildingGenerationError, generateBuilding, type BuildingGenerationErrorCode } from "@/lib/building/generate";
import type { BuildingRequirements } from "@/lib/building/requirements";
import type { Building } from "@/lib/building/schema";
import { estimateBuildingCost } from "@/lib/cost";
import type { CostEstimate } from "@/lib/cost/schema";
import type { ValidationFinding, ValidationReport } from "@/lib/validation";

export type PipelineResult =
  | {
      status: "generated";
      building: Building;
      validation: ValidationReport;
      costEstimate: CostEstimate;
      intent: Record<string, unknown>;
      aiReview: ArchitecturalReviewResult;
    }
  | { status: "failed"; code: BuildingGenerationErrorCode; message: string; conflicts: ValidationFinding[] };

export async function runDesignPipeline(
  requirements: BuildingRequirements,
  options: { reviewComplete?: typeof callJsonModeCompletion } = {},
): Promise<PipelineResult> {
  let generated;
  try {
    generated = generateBuilding(requirements);
  } catch (error) {
    if (error instanceof BuildingGenerationError) {
      return { status: "failed", code: error.code, message: error.message, conflicts: error.conflicts };
    }
    throw error;
  }

  const costEstimate = estimateBuildingCost(generated.building, requirements);
  const aiReview = await reviewBuilding(
    { requirements, building: generated.building, validation: generated.validation },
    { complete: options.reviewComplete },
  );
  const intent = {
    requirementSchemaVersion: requirements.requirementSchemaVersion,
    buildingSchemaVersion: generated.building.buildingSchemaVersion,
    rendererVersion: generated.building.rendererVersion,
    evaluatedCandidateCount: generated.evaluatedCandidateCount,
    assumptions: [
      "Concept feasibility geometry uses rectangular planning cells and baseline residential heuristics.",
      "Validation is not permit, structural, MEP, or jurisdictional approval.",
      costEstimate.status === "available"
        ? `Cost uses ${costEstimate.selection.ratePackName} (${costEstimate.selection.ratePackVersion}).`
        : "No native regional rate pack was available; cost is intentionally unavailable.",
    ],
  };

  return {
    status: "generated",
    building: generated.building,
    validation: generated.validation,
    costEstimate,
    intent,
    aiReview,
  };
}
