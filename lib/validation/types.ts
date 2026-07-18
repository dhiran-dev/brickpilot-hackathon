import { z } from "zod";

export const validationSeveritySchema = z.enum(["error", "warning", "info"]);
export const legacyValidationCategorySchema = z.enum(["geometry", "topology", "opening", "vertical", "planning", "structure", "cost"]);
export const validationCategoryV3Schema = z.enum([
  "geometry",
  "topology",
  "opening",
  "vertical",
  "planning",
  "structure",
  "cost",
  "circulation",
  "accessibility",
  "architecture",
  "site",
  "safety",
  "scheme_set",
]);
export const legacyValidationSourceKindSchema = z.enum(["geometry", "baseline_heuristic", "jurisdiction_source"]);
export const validationSourceKindV3Schema = z.enum([
  "geometry",
  "requirement",
  "requirement_and_geometry",
  "baseline_heuristic",
  "jurisdiction_source",
  "scheme_set",
]);

const measuredEvidenceSchema = z.object({ value: z.number(), unit: z.string() });
const requiredEvidenceSchema = z.object({ min: z.number().optional(), max: z.number().optional(), unit: z.string() });

export const legacyValidationFindingSchema = z.object({
  ruleId: z.string(),
  ruleVersion: z.number().int().positive(),
  severity: validationSeveritySchema,
  category: legacyValidationCategorySchema,
  floorId: z.string().optional(),
  objectIds: z.array(z.string()),
  measured: measuredEvidenceSchema.optional(),
  required: requiredEvidenceSchema.optional(),
  message: z.string(),
  suggestedAction: z.string().optional(),
  repairType: z.string().optional(),
  sourceKind: legacyValidationSourceKindSchema,
});

export const validationFindingV3Schema = z.object({
  ...legacyValidationFindingSchema.shape,
  category: validationCategoryV3Schema,
  sourceKind: validationSourceKindV3Schema,
});

const countsSchema = z.object({
  error: z.number().int().nonnegative(),
  warning: z.number().int().nonnegative(),
  info: z.number().int().nonnegative(),
});

export const legacyValidationReportSchema = z.object({
  rulePackVersion: z.string(),
  valid: z.boolean(),
  score: z.number().min(0).max(100),
  counts: countsSchema,
  findings: z.array(legacyValidationFindingSchema),
});

export const validationReportV3Schema = z.object({
  schemaVersion: z.literal("validation-report-v3"),
  rulePackVersion: z.string().min(1),
  valid: z.boolean(),
  score: z.number().min(0).max(100),
  counts: countsSchema,
  findings: z.array(validationFindingV3Schema),
});

export const readableValidationReportSchema = z.union([
  validationReportV3Schema,
  legacyValidationReportSchema.strict(),
]);

export const ARCHITECTURAL_VALIDATION_RULE_CODES = [
  "AREA_TARGET_EXCEEDED",
  "SCHEME_NOT_DISTINCT",
  "MAIN_ENTRY_MISSING",
  "MAIN_ENTRY_NOT_ROAD_SIDE",
  "MAIN_ENTRY_TOO_NARROW",
  "EXTERIOR_ENTRY_COUNT_EXCEEDED",
  "PRIVATE_ROOM_EXTERIOR_EXPOSURE",
  "PARKING_VEHICLE_ACCESS_MISSING",
  "ROOF_INTENT_NOT_REALIZED",
  "ROOF_GEOMETRY_INVALID",
  "ROOF_SITE_BOUNDARY_CONFLICT",
  "ROOF_SUPPORT_INCOMPLETE",
  "SUPPORT_CLEARANCE_CONFLICT",
  "EDGE_PROTECTION_MISSING",
  "SHADE_STRUCTURE_NOT_REALIZED",
  "FACADE_ENTRY_CONFLICT",
] as const;

export type ValidationSeverity = z.infer<typeof validationSeveritySchema>;
export type ValidationCategory = z.infer<typeof legacyValidationCategorySchema>;
export type ValidationCategoryV2 = ValidationCategory;
export type ValidationCategoryV3 = z.infer<typeof validationCategoryV3Schema>;
export type ValidationSourceKindV2 = z.infer<typeof legacyValidationSourceKindSchema>;
export type ValidationSourceKindV3 = z.infer<typeof validationSourceKindV3Schema>;
export type ValidationFinding = z.infer<typeof legacyValidationFindingSchema>;
export type ValidationFindingV2 = ValidationFinding;
export type ValidationFindingV3 = z.infer<typeof validationFindingV3Schema>;
export type ValidationReport = z.infer<typeof legacyValidationReportSchema>;
export type ValidationReportV2 = ValidationReport;
export type ValidationReportV3 = z.infer<typeof validationReportV3Schema>;
export type ReadableValidationReport = ValidationReportV2 | ValidationReportV3;
export type ArchitecturalValidationRuleCode = typeof ARCHITECTURAL_VALIDATION_RULE_CODES[number];
