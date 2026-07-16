import { z } from "zod";

import { architecturalReviewResultSchema } from "@/lib/ai/schema";
import { buildingRequirementsSchema } from "@/lib/building/requirements";
import { buildingSchema } from "@/lib/building/schema";
import { costEstimateSchema } from "@/lib/cost/schema";

const validationFindingSchema = z.object({
  ruleId: z.string(),
  ruleVersion: z.number().int().positive(),
  severity: z.enum(["error", "warning", "info"]),
  category: z.enum(["geometry", "topology", "opening", "vertical", "planning", "structure", "cost"]),
  floorId: z.string().optional(),
  objectIds: z.array(z.string()),
  measured: z.object({ value: z.number(), unit: z.string() }).optional(),
  required: z.object({ min: z.number().optional(), max: z.number().optional(), unit: z.string() }).optional(),
  message: z.string(),
  suggestedAction: z.string().optional(),
  repairType: z.string().optional(),
  sourceKind: z.enum(["geometry", "baseline_heuristic", "jurisdiction_source"]),
});

export const persistedValidationReportSchema = z.object({
  rulePackVersion: z.string(),
  valid: z.boolean(),
  score: z.number().min(0).max(100),
  counts: z.object({ error: z.number().int().nonnegative(), warning: z.number().int().nonnegative(), info: z.number().int().nonnegative() }),
  findings: z.array(validationFindingSchema),
});

const persistedAiReviewSchema = architecturalReviewResultSchema.nullable();

export type PersistedStudyRow = {
  projectId: string;
  designId: string;
  version: number;
  title: string;
  status: string;
  createdAt: Date;
  requirements: unknown;
  building: unknown;
  validation: unknown;
  costEstimate: unknown;
  aiReview: unknown;
};

export type IncompatibleStudy = Pick<PersistedStudyRow, "projectId" | "designId" | "version" | "title" | "status" | "createdAt"> & {
  compatibility: "legacy_incompatible";
  reason: "INVALID_REQUIREMENTS" | "INVALID_BUILDING" | "INVALID_VALIDATION" | "INVALID_COST_ESTIMATE" | "INVALID_AI_REVIEW";
};

export function classifyPersistedStudy(row: PersistedStudyRow) {
  const requirements = buildingRequirementsSchema.safeParse(row.requirements);
  if (!requirements.success) return {
    compatible: false as const,
    study: { projectId: row.projectId, designId: row.designId, version: row.version, title: row.title, status: row.status, createdAt: row.createdAt, compatibility: "legacy_incompatible" as const, reason: "INVALID_REQUIREMENTS" as const },
  };

  if (row.status !== "completed") return {
    compatible: true as const,
    study: { ...row, requirements: requirements.data, building: null, validation: null, costEstimate: null, aiReview: null },
  };

  const building = buildingSchema.safeParse(row.building);
  if (!building.success) return {
    compatible: false as const,
    study: { projectId: row.projectId, designId: row.designId, version: row.version, title: row.title, status: row.status, createdAt: row.createdAt, compatibility: "legacy_incompatible" as const, reason: "INVALID_BUILDING" as const },
  };
  const validation = persistedValidationReportSchema.safeParse(row.validation);
  if (!validation.success) return {
    compatible: false as const,
    study: { projectId: row.projectId, designId: row.designId, version: row.version, title: row.title, status: row.status, createdAt: row.createdAt, compatibility: "legacy_incompatible" as const, reason: "INVALID_VALIDATION" as const },
  };
  const costEstimate = costEstimateSchema.safeParse(row.costEstimate);
  if (!costEstimate.success) return {
    compatible: false as const,
    study: { projectId: row.projectId, designId: row.designId, version: row.version, title: row.title, status: row.status, createdAt: row.createdAt, compatibility: "legacy_incompatible" as const, reason: "INVALID_COST_ESTIMATE" as const },
  };
  const aiReview = persistedAiReviewSchema.safeParse(row.aiReview ?? null);
  if (!aiReview.success) return {
    compatible: false as const,
    study: { projectId: row.projectId, designId: row.designId, version: row.version, title: row.title, status: row.status, createdAt: row.createdAt, compatibility: "legacy_incompatible" as const, reason: "INVALID_AI_REVIEW" as const },
  };
  return {
    compatible: true as const,
    study: { ...row, requirements: requirements.data, building: building.data, validation: validation.data, costEstimate: costEstimate.data, aiReview: aiReview.data },
  };
}
