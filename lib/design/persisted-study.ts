import { z } from "zod";

import { architecturalReviewResultSchema } from "@/lib/ai/schema";
import {
  buildingRequirementsContractVersion,
  legacyBuildingRequirementsSchema,
  readableBuildingRequirementsSchema,
} from "@/lib/building/requirements";
import { buildingContractVersion, currentBuildingSchema, legacyBuildingSchema, readableBuildingSchema } from "@/lib/building/schema";
import { costEstimateSchema } from "@/lib/cost/schema";
import {
  legacyValidationReportSchema,
  readableValidationReportSchema,
  validationReportV3Schema,
} from "@/lib/validation/types";

/** Backwards-compatible v2 persisted report export used by frozen render/mutation paths. */
export const persistedValidationReportSchema = legacyValidationReportSchema;
export const readablePersistedValidationReportSchema = readableValidationReportSchema;

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
  building: legacyBuildingSchema,
  validation: persistedValidationReportSchema,
  evidence: z.array(z.string()),
  ladderRung: z.number().int().min(0).max(3),
});

export type PersistedScheme = z.infer<typeof persistedSchemeSchema>;

export const currentPersistedSchemeSchema = z.object({
  schemeId: z.string().min(1),
  partiId: z.string().min(1),
  name: z.string().min(1),
  rationale: z.string().min(1),
  building: currentBuildingSchema,
  validation: validationReportV3Schema,
  evidence: z.array(z.string()),
  ladderRung: z.number().int().min(0).max(3),
});

export const readablePersistedSchemeSchema = z.union([persistedSchemeSchema, currentPersistedSchemeSchema]);
export type CurrentPersistedScheme = z.infer<typeof currentPersistedSchemeSchema>;
export type ReadablePersistedScheme = PersistedScheme | CurrentPersistedScheme;

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

function legacyScheme(building: z.infer<typeof legacyBuildingSchema>, validation: z.infer<typeof persistedValidationReportSchema>): PersistedScheme {
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

/**
 * Lightweight routing metadata for persisted studies. This never substitutes for full schema
 * parsing in classifyPersistedStudy; it lets lifecycle and read adapters choose a version before
 * invoking the corresponding full parser.
 */
export function persistedStudyContractVersions(row: Pick<PersistedStudyRow, "requirements" | "building" | "status">) {
  return {
    requirements: buildingRequirementsContractVersion(row.requirements),
    building: row.status === "completed" ? buildingContractVersion(row.building) : null,
  } as const;
}

export function classifyReadablePersistedStudy(row: PersistedStudyRow) {
  const requirements = readableBuildingRequirementsSchema.safeParse(row.requirements);
  if (!requirements.success) return {
    compatible: false as const,
    study: { projectId: row.projectId, designId: row.designId, version: row.version, title: row.title, status: row.status, createdAt: row.createdAt, compatibility: "legacy_incompatible" as const, reason: "INVALID_REQUIREMENTS" as const },
  };

  if (row.status !== "completed") return {
    compatible: true as const,
    study: { ...row, requirements: requirements.data, building: null, validation: null, costEstimate: null, aiReview: null, schemes: [], selectedSchemeId: null },
  };

  const building = readableBuildingSchema.safeParse(row.building);
  if (!building.success) return {
    compatible: false as const,
    study: { projectId: row.projectId, designId: row.designId, version: row.version, title: row.title, status: row.status, createdAt: row.createdAt, compatibility: "legacy_incompatible" as const, reason: "INVALID_BUILDING" as const },
  };
  const validation = readablePersistedValidationReportSchema.safeParse(row.validation);
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
  const requirementsVersion = buildingRequirementsContractVersion(requirements.data);
  const buildingVersion = buildingContractVersion(building.data);
  const validationVersion = "schemaVersion" in validation.data ? "v3" : "v2";
  if (!requirementsVersion || requirementsVersion !== buildingVersion || buildingVersion !== validationVersion) return {
    compatible: false as const,
    study: { projectId: row.projectId, designId: row.designId, version: row.version, title: row.title, status: row.status, createdAt: row.createdAt, compatibility: "legacy_incompatible" as const, reason: "INVALID_BUILDING" as const },
  };
  const schemes = row.schemes == null
    ? buildingVersion === "v2"
      ? z.array(persistedSchemeSchema).safeParse([legacyScheme(
          legacyBuildingSchema.parse(building.data),
          persistedValidationReportSchema.parse(validation.data),
        )])
      : z.array(readablePersistedSchemeSchema).safeParse([])
    : z.array(readablePersistedSchemeSchema).min(1).max(3).safeParse(row.schemes);
  if (!schemes.success) return {
    compatible: false as const,
    study: { projectId: row.projectId, designId: row.designId, version: row.version, title: row.title, status: row.status, createdAt: row.createdAt, compatibility: "legacy_incompatible" as const, reason: "INVALID_SCHEMES" as const },
  };
  if (buildingVersion === "v3" && aiReview.data === null) return {
    compatible: false as const,
    study: { projectId: row.projectId, designId: row.designId, version: row.version, title: row.title, status: row.status, createdAt: row.createdAt, compatibility: "legacy_incompatible" as const, reason: "INVALID_AI_REVIEW" as const },
  };
  const homogeneousSchemes = schemes.data.every((scheme) => {
    const schemeBuildingVersion = buildingContractVersion(scheme.building);
    const schemeValidationVersion = "schemaVersion" in scheme.validation ? "v3" : "v2";
    return schemeBuildingVersion === buildingVersion && schemeValidationVersion === validationVersion;
  });
  if (!homogeneousSchemes) return {
    compatible: false as const,
    study: { projectId: row.projectId, designId: row.designId, version: row.version, title: row.title, status: row.status, createdAt: row.createdAt, compatibility: "legacy_incompatible" as const, reason: "INVALID_SCHEMES" as const },
  };
  const selectedSchemeId = row.selectedSchemeId ?? schemes.data[0].schemeId;
  const selectedScheme = schemes.data.find((scheme) => scheme.schemeId === selectedSchemeId);
  if (!selectedScheme
    || buildingContractVersion(selectedScheme.building) !== buildingVersion
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

export type LegacyCompatibleStudy = PersistedStudyRow & {
  requirements: z.infer<typeof legacyBuildingRequirementsSchema>;
  building: z.infer<typeof legacyBuildingSchema> | null;
  validation: z.infer<typeof persistedValidationReportSchema> | null;
  costEstimate: z.infer<typeof costEstimateSchema> | null;
  aiReview: z.infer<typeof persistedAiReviewSchema> | null;
  intent?: z.infer<typeof persistedIntentSchema>;
  schemes: PersistedScheme[];
  selectedSchemeId: string | null;
};

export type LegacyStudyClassification =
  | { compatible: true; study: LegacyCompatibleStudy }
  | { compatible: false; study: IncompatibleStudy };

/**
 * Frozen adapter for existing v2-only UI/deck consumers. V3-aware consumers opt in to
 * classifyReadablePersistedStudy so schema rollout cannot accidentally feed them new geometry.
 */
export function classifyPersistedStudy(row: PersistedStudyRow): LegacyStudyClassification {
  const classified = classifyReadablePersistedStudy(row);
  if (!classified.compatible) return classified;
  if (classified.study.requirements.requirementSchemaVersion !== 2
    || (classified.study.building && classified.study.building.buildingSchemaVersion !== 2)) {
    return {
      compatible: false,
      study: {
        projectId: row.projectId,
        designId: row.designId,
        version: row.version,
        title: row.title,
        status: row.status,
        createdAt: row.createdAt,
        compatibility: "legacy_incompatible",
        reason: "INVALID_BUILDING",
      },
    };
  }
  return classified as { compatible: true; study: LegacyCompatibleStudy };
}
