import type { ArchitecturalReviewResult } from "@/lib/ai/schema";
import type { GenerationDiagnostics as PersistedGenerationDiagnostics } from "@/lib/building/generate";
import type { BuildingRequirements, CurrentBuildingRequirements } from "@/lib/building/requirements";
import type { Building, CurrentBuilding } from "@/lib/building/schema";
import type { CostEstimate } from "@/lib/cost/schema";
import type { CurrentPersistedScheme, PersistedScheme } from "@/lib/design/persisted-study";
import type { ProjectCapabilities, ProjectCapabilityProfile, ProjectLifecycleStatus } from "@/lib/server/project-capabilities";
import type { ValidationReport, ValidationReportV3 } from "@/lib/validation";

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
  projectStatus?: ProjectLifecycleStatus;
  capabilityProfile?: ProjectCapabilityProfile;
  capabilities?: ProjectCapabilities;
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
  projectStatus?: ProjectLifecycleStatus;
  capabilityProfile?: ProjectCapabilityProfile;
  capabilities?: ProjectCapabilities;
};

export type CurrentDesignResult = Omit<DesignResult, "requirements" | "building" | "validation" | "schemes" | "aiReview"> & {
  requirements: CurrentBuildingRequirements;
  building: CurrentBuilding;
  validation: ValidationReportV3;
  aiReview: ArchitecturalReviewResult;
  schemes?: CurrentPersistedScheme[];
};

export type ReadableDesignResult = DesignResult | CurrentDesignResult;

export type CurrentRecentStudy = Omit<RecentStudy, "requirements" | "building" | "validation" | "schemes" | "aiReview"> & {
  requirements: CurrentBuildingRequirements;
  building: CurrentBuilding | null;
  validation: ValidationReportV3 | null;
  aiReview: ArchitecturalReviewResult | null;
  schemes?: CurrentPersistedScheme[];
};

export type ReadableRecentStudy = RecentStudy | CurrentRecentStudy;

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
    projectStatus: study.projectStatus,
    capabilityProfile: study.capabilityProfile,
    capabilities: study.capabilities,
  };
}

/** Versioned read adapter for v3-aware consumers. Existing UI remains pinned to the v2 adapter. */
export function readableStudyToDesignResult(study: ReadableRecentStudy): ReadableDesignResult | null {
  if (!study.building || !study.validation || !study.costEstimate) return null;
  if (study.requirements.requirementSchemaVersion !== study.building.buildingSchemaVersion) return null;
  if (study.building.buildingSchemaVersion === 2 && !("schemaVersion" in study.validation)) {
    return studyToDesignResult(study as RecentStudy);
  }
  if (study.building.buildingSchemaVersion === 3 && "schemaVersion" in study.validation) {
    if (!study.aiReview) return null;
    return {
      projectId: study.projectId,
      designId: study.designId,
      version: study.version,
      title: study.title,
      requirements: study.requirements as CurrentBuildingRequirements,
      building: study.building,
      validation: study.validation,
      costEstimate: study.costEstimate,
      aiReview: study.aiReview,
      schemes: study.schemes as CurrentPersistedScheme[] | undefined,
      selectedSchemeId: study.selectedSchemeId,
      intent: study.intent,
      projectStatus: study.projectStatus,
      capabilityProfile: study.capabilityProfile,
      capabilities: study.capabilities,
    };
  }
  return null;
}
