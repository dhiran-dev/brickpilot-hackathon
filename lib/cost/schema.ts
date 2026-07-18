import { z } from "zod";

export const confidenceGradeSchema = z.enum(["A", "B", "C", "D", "unavailable"]);
export const estimateBandSchema = z.object({
  lowMinor: z.number().int(),
  expectedMinor: z.number().int(),
  highMinor: z.number().int(),
});

export const costSourceSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  publisher: z.string().min(1),
  publicationDate: z.string().date().optional(),
  effectiveDate: z.string().date(),
  ingestionDate: z.string().date(),
  sourceKind: z.enum(["official_rate", "official_index", "calibration_reference", "assumption"]),
  note: z.string().min(1).optional(),
});

export const ratePackSchema = z.object({
  schemaVersion: z.literal(1),
  ratePackVersion: z.string().min(1),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  name: z.string().min(1),
  status: z.enum(["reviewed_reference", "verified_local"]),
  region: z.object({
    countryCode: z.string().length(2),
    adminArea: z.string().min(1),
    localities: z.array(z.string()).default([]),
    referenceFallbackCountryCodes: z.array(z.string().length(2)).default([]),
  }),
  currency: z.string().length(3),
  locale: z.string().min(2),
  measurement: z.object({
    rateUnit: z.literal("currency_minor_per_square_metre_gfa"),
    standard: z.string().min(1),
    note: z.string().min(1),
  }),
  effectiveDate: z.string().date(),
  staleAfterMonths: z.number().int().positive(),
  sourceConfidence: z.enum(["A", "B", "C", "D"]),
  sources: z.array(costSourceSchema).min(1),
  baseRate: estimateBandSchema,
  factorsBasisPoints: z.object({
    qualityTier: z.object({ essential: z.number().int().positive(), standard: z.number().int().positive(), premium: z.number().int().positive() }),
    floorCount: z.object({ one: z.number().int().positive(), two: z.number().int().positive(), three: z.number().int().positive(), four: z.number().int().positive() }),
    siteConditions: z.number().int().positive(),
    localityIndex: z.number().int().positive(),
  }),
  allowancesBasisPoints: z.object({
    externalWorks: z.number().int().nonnegative(),
    professionalFees: z.number().int().nonnegative(),
  }),
  inclusions: z.array(z.string().min(1)),
  exclusions: z.array(z.string().min(1)),
  assumptions: z.array(z.string().min(1)),
  disclaimer: z.string().min(1),
});

export const costLineItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  category: z.enum(["base_building", "external_works", "professional_fees", "contingency", "tax"]),
  basis: z.string().min(1),
  amounts: estimateBandSchema,
});

export const costWarningSchema = z.object({
  code: z.enum(["REFERENCE_FALLBACK", "STALE_RATE_PACK", "CURRENCY_MISMATCH", "COST_REGION_UNSUPPORTED"]),
  message: z.string().min(1),
});

export const legacyQuantityTakeoffSchema = z.object({
  grossFloorAreaMm2: z.number().int().nonnegative(),
  floorAreasMm2: z.array(z.object({ floorId: z.string(), areaMm2: z.number().int().nonnegative() })),
  floorCount: z.number().int().positive(),
  spaceCount: z.number().int().nonnegative(),
  doorCount: z.number().int().nonnegative(),
  windowCount: z.number().int().nonnegative(),
  stairCount: z.number().int().nonnegative(),
});
export const currentQuantityTakeoffSchema = legacyQuantityTakeoffSchema.extend({
  quantitySchemaVersion: z.literal(3),
  roofSurfaceAreaMm2: z.number().int().nonnegative(),
  solidCanopySurfaceAreaMm2: z.number().int().nonnegative(),
  canopyPostCount: z.number().int().nonnegative(),
  pergolaPostCount: z.number().int().nonnegative(),
  pergolaMemberLengthMm: z.number().int().nonnegative(),
  edgeProtectionLengthMm: z.number().int().nonnegative(),
  informationalBasis: z.literal("Physical-system quantities are informational and remain included in the GFA base rate; no separate unit rates are applied."),
});
// Put the discriminated v3 shape first: the intentionally permissive legacy
// object would otherwise accept a v3 value and strip its informational fields.
export const quantityTakeoffSchema = z.union([currentQuantityTakeoffSchema, legacyQuantityTakeoffSchema]);

const estimateBaseSchema = z.object({
  estimateSchemaVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  currency: z.string().length(3),
  locale: z.string().min(2),
  warnings: z.array(costWarningSchema),
});

export const availableCostEstimateSchema = estimateBaseSchema.extend({
  status: z.literal("available"),
  confidence: z.enum(["A", "B", "C", "D"]),
  selection: z.object({
    match: z.enum(["locality", "admin_area", "country_reference"]),
    ratePackVersion: z.string(),
    ratePackName: z.string(),
    effectiveDate: z.string().date(),
    stale: z.boolean(),
  }),
  quantities: quantityTakeoffSchema,
  appliedFactors: z.array(z.object({ id: z.string(), label: z.string(), basisPoints: z.number().int().positive() })),
  lineItems: z.array(costLineItemSchema).min(1),
  subtotals: z.object({
    construction: estimateBandSchema,
    feesAndContingency: estimateBandSchema,
    tax: estimateBandSchema,
  }),
  total: estimateBandSchema,
  included: z.array(z.string()),
  excluded: z.array(z.string()),
  assumptions: z.array(z.string()),
  sources: z.array(costSourceSchema),
  disclaimer: z.string(),
  improveConfidenceActions: z.array(z.string()),
});

export const unavailableCostEstimateSchema = estimateBaseSchema.extend({
  status: z.literal("unavailable"),
  confidence: z.literal("unavailable"),
  reason: z.enum(["unsupported_region", "currency_mismatch", "no_rate_pack"]),
  improveConfidenceActions: z.array(z.string()),
});

export const costEstimateSchema = z.discriminatedUnion("status", [availableCostEstimateSchema, unavailableCostEstimateSchema]);

export type ConfidenceGrade = z.infer<typeof confidenceGradeSchema>;
export type EstimateBand = z.infer<typeof estimateBandSchema>;
export type CostSource = z.infer<typeof costSourceSchema>;
export type RatePack = z.infer<typeof ratePackSchema>;
export type CostLineItem = z.infer<typeof costLineItemSchema>;
export type CostWarning = z.infer<typeof costWarningSchema>;
export type QuantityTakeoff = z.infer<typeof quantityTakeoffSchema>;
export type CurrentQuantityTakeoff = z.infer<typeof currentQuantityTakeoffSchema>;
export type AvailableCostEstimate = z.infer<typeof availableCostEstimateSchema>;
export type UnavailableCostEstimate = z.infer<typeof unavailableCostEstimateSchema>;
export type CostEstimate = z.infer<typeof costEstimateSchema>;
