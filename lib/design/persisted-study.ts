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

export const persistedGenerationDiagnosticsSchema = z.object({
  watchdogMs: z.number().int().positive(),
  candidateCeiling: z.number().int().positive(),
  plannedCandidateCount: z.number().int().nonnegative(),
  constructedCandidateCount: z.number().int().nonnegative(),
  evaluatedCandidateCount: z.number().int().nonnegative(),
  quotaUsage: z.array(z.object({
    partiId: z.string().min(1),
    rung: z.number().int().min(0).max(3),
    relaxationId: z.string().min(1),
    simplifiedCourt: z.boolean(),
    quota: z.number().int().positive(),
    attempted: z.number().int().nonnegative(),
  })),
});

const persistedIntentSchema = z.object({
  generationDiagnostics: persistedGenerationDiagnosticsSchema.optional(),
}).passthrough();

export const persistedSchemeSchema = z.object({
  schemeId: z.string().min(1),
  partiId: z.string().min(1),
  name: z.string().min(1),
  rationale: z.string().min(1),
  building: buildingSchema,
  validation: persistedValidationReportSchema,
  evidence: z.array(z.string()),
  ladderRung: z.number().int().min(0).max(3),
});

export type PersistedScheme = z.infer<typeof persistedSchemeSchema>;

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
  intent?: unknown;
  schemes?: unknown;
  selectedSchemeId?: string | null;
};

export type IncompatibleStudy = Pick<PersistedStudyRow, "projectId" | "designId" | "version" | "title" | "status" | "createdAt"> & {
  compatibility: "legacy_incompatible";
  reason: "INVALID_REQUIREMENTS" | "INVALID_BUILDING" | "INVALID_VALIDATION" | "INVALID_COST_ESTIMATE" | "INVALID_AI_REVIEW" | "INVALID_SCHEMES" | "INVALID_INTENT";
};

function legacyScheme(building: z.infer<typeof buildingSchema>, validation: z.infer<typeof persistedValidationReportSchema>): PersistedScheme {
  const partiId = building.candidate.generatorId;
  return {
    schemeId: `legacy-${building.candidate.geometryHash}`,
    partiId,
    name: `${partiId.replaceAll("_", " ")} · Existing scheme`,
    rationale: "Saved canonical scheme from before multi-scheme selection was introduced.",
    building,
    validation,
    evidence: building.candidate.evidence ?? [],
    ladderRung: building.candidate.relaxation?.rung ?? 0,
  };
}

export function classifyPersistedStudy(row: PersistedStudyRow) {
  const requirements = buildingRequirementsSchema.safeParse(row.requirements);
  if (!requirements.success) return {
    compatible: false as const,
    study: { projectId: row.projectId, designId: row.designId, version: row.version, title: row.title, status: row.status, createdAt: row.createdAt, compatibility: "legacy_incompatible" as const, reason: "INVALID_REQUIREMENTS" as const },
  };

  if (row.status !== "completed") return {
    compatible: true as const,
    study: { ...row, requirements: requirements.data, building: null, validation: null, costEstimate: null, aiReview: null, schemes: [], selectedSchemeId: null },
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
  const intent = persistedIntentSchema.safeParse(row.intent ?? {});
  if (!intent.success) return {
    compatible: false as const,
    study: { projectId: row.projectId, designId: row.designId, version: row.version, title: row.title, status: row.status, createdAt: row.createdAt, compatibility: "legacy_incompatible" as const, reason: "INVALID_INTENT" as const },
  };
  const schemes = row.schemes == null
    ? z.array(persistedSchemeSchema).safeParse([legacyScheme(building.data, validation.data)])
    : z.array(persistedSchemeSchema).min(1).max(3).safeParse(row.schemes);
  if (!schemes.success) return {
    compatible: false as const,
    study: { projectId: row.projectId, designId: row.designId, version: row.version, title: row.title, status: row.status, createdAt: row.createdAt, compatibility: "legacy_incompatible" as const, reason: "INVALID_SCHEMES" as const },
  };
  const selectedSchemeId = row.selectedSchemeId ?? schemes.data[0].schemeId;
  const selectedScheme = schemes.data.find((scheme) => scheme.schemeId === selectedSchemeId);
  if (!selectedScheme
    || selectedScheme.building.candidate.geometryHash !== building.data.candidate.geometryHash
    || JSON.stringify(selectedScheme.validation) !== JSON.stringify(validation.data)) return {
    compatible: false as const,
    study: { projectId: row.projectId, designId: row.designId, version: row.version, title: row.title, status: row.status, createdAt: row.createdAt, compatibility: "legacy_incompatible" as const, reason: "INVALID_SCHEMES" as const },
  };
  return {
    compatible: true as const,
    study: { ...row, intent: intent.data, requirements: requirements.data, building: building.data, validation: validation.data, costEstimate: costEstimate.data, aiReview: aiReview.data, schemes: schemes.data, selectedSchemeId },
  };
}
