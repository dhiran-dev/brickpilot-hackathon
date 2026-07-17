import type { ArchitecturalReviewResult } from "@/lib/ai/schema";
import type { GenerationDiagnostics as PersistedGenerationDiagnostics } from "@/lib/building/generate";
import type { BuildingRequirements } from "@/lib/building/requirements";
import type { Building } from "@/lib/building/schema";
import type { CostEstimate } from "@/lib/cost/schema";
import type { PersistedScheme } from "@/lib/design/persisted-study";
import type { ValidationReport } from "@/lib/validation";

export type DesignResult = {
  projectId: string;
  designId: string;
  version?: number;
  title: string;
  requirements: BuildingRequirements;
  building: Building;
  validation: ValidationReport;
  costEstimate: CostEstimate;
  intent?: { assumptions?: string[]; evaluatedCandidateCount?: number; generationDiagnostics?: PersistedGenerationDiagnostics };
  diagnostics?: PersistedGenerationDiagnostics;
  aiReview?: ArchitecturalReviewResult | null;
  schemes?: PersistedScheme[];
  selectedSchemeId?: string | null;
};

export type RecentStudy = {
  projectId: string;
  designId: string;
  version?: number;
  title: string;
  status: string;
  createdAt: string;
  requirements: BuildingRequirements;
  building: Building | null;
  validation: ValidationReport | null;
  costEstimate: CostEstimate | null;
  aiReview?: ArchitecturalReviewResult | null;
  schemes?: PersistedScheme[];
  selectedSchemeId?: string | null;
  intent?: { assumptions?: string[]; evaluatedCandidateCount?: number; generationDiagnostics?: PersistedGenerationDiagnostics };
};

// A persisted study only becomes a restorable workspace result once its building, validation
// and cost evidence all exist; in-progress or failed rows stay out of the result view.
export function studyToDesignResult(study: RecentStudy): DesignResult | null {
  if (!study.building || !study.validation || !study.costEstimate) return null;
  return {
    projectId: study.projectId,
    designId: study.designId,
    version: study.version,
    title: study.title,
    requirements: study.requirements,
    building: study.building,
    validation: study.validation,
    costEstimate: study.costEstimate,
    aiReview: study.aiReview,
    schemes: study.schemes,
    selectedSchemeId: study.selectedSchemeId,
    intent: study.intent,
  };
}
