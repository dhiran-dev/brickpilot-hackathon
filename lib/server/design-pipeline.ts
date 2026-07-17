import { reviewBuilding } from "@/lib/ai/architectural-review";
import type { callJsonModeCompletion } from "@/lib/ai/client";
import type { ArchitecturalReviewResult } from "@/lib/ai/schema";
import { BuildingGenerationError, generateBuildingSchemes, type BuildingGenerationErrorCode, type GeneratedScheme, type GenerationDiagnostics } from "@/lib/building/generate";
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
      schemes: GeneratedScheme[];
      selectedSchemeId: string;
      diagnostics: GenerationDiagnostics;
    }
  | { status: "failed"; code: BuildingGenerationErrorCode; message: string; conflicts: ValidationFinding[]; diagnostics?: GenerationDiagnostics };

export async function runDesignPipeline(
  requirements: BuildingRequirements,
  options: { reviewComplete?: typeof callJsonModeCompletion } = {},
): Promise<PipelineResult> {
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
