import { z } from "zod";

const floorProgramExtractionSchema = z.object({
  level: z.number().int().min(0).max(3),
  bedrooms: z.number().int().min(0).max(8).optional(),
  bathrooms: z.number().int().min(0).max(8).optional(),
  attachedBathrooms: z.number().int().min(0).max(8).optional(),
  studies: z.number().int().min(0).max(4).optional(),
  balcony: z.boolean().optional(),
}).strict();

export const nlIntakeExtractionSchema = z.object({
  projectName: z.string().trim().min(1).max(120).optional(),
  countryCode: z.string().regex(/^[A-Za-z]{2}$/).optional(),
  adminArea: z.string().trim().min(1).max(80).optional(),
  locality: z.string().trim().min(1).max(120).optional(),
  currency: z.string().regex(/^[A-Za-z]{3}$/).optional(),
  siteWidthFeet: z.number().positive().max(600).optional(),
  siteDepthFeet: z.number().positive().max(600).optional(),
  siteWidthMetres: z.number().positive().max(200).optional(),
  siteDepthMetres: z.number().positive().max(200).optional(),
  facing: z.enum(["north", "east", "south", "west"]).optional(),
  roadEdges: z.array(z.enum(["north", "east", "south", "west"])).min(1).max(4).optional(),
  floorCount: z.number().int().min(1).max(4).optional(),
  floorHeightMetres: z.number().min(2.4).max(6).optional(),
  stairWidthMm: z.number().int().min(900).max(2400).optional(),
  occupants: z.number().int().min(1).max(30).optional(),
  floorPrograms: z.array(floorProgramExtractionSchema).max(4).optional(),
  bedroomsGroundFloor: z.number().int().min(0).max(8).optional(),
  bathroomsGroundFloor: z.number().int().min(0).max(8).optional(),
  includeParking: z.boolean().optional(),
  includePooja: z.boolean().optional(),
  includeUtility: z.boolean().optional(),
  includeCourtyard: z.boolean().optional(),
  socialSpaceMode: z.enum(["separate", "combined"]).optional(),
  qualityTier: z.enum(["essential", "standard", "premium"]).optional(),
  budgetLowMajor: z.number().nonnegative().optional(),
  budgetHighMajor: z.number().nonnegative().optional(),
}).strict().superRefine((value, context) => {
  if (Object.keys(value).length === 0) {
    context.addIssue({ code: "custom", message: "At least one concrete requirement must be extracted." });
  }
  if ((value.siteWidthFeet === undefined) !== (value.siteDepthFeet === undefined)) {
    context.addIssue({ code: "custom", path: ["siteDepthFeet"], message: "Plot width and depth in feet must be provided together." });
  }
  if ((value.siteWidthMetres === undefined) !== (value.siteDepthMetres === undefined)) {
    context.addIssue({ code: "custom", path: ["siteDepthMetres"], message: "Plot width and depth in metres must be provided together." });
  }
  if (value.siteWidthFeet !== undefined && value.siteWidthMetres !== undefined) {
    context.addIssue({ code: "custom", path: ["siteWidthMetres"], message: "Use one plot unit system only." });
  }
  const levels = value.floorPrograms?.map((program) => program.level) ?? [];
  if (new Set(levels).size !== levels.length) {
    context.addIssue({ code: "custom", path: ["floorPrograms"], message: "Floor program levels must be unique." });
  }
  if (value.floorCount !== undefined && levels.some((level) => level >= value.floorCount!)) {
    context.addIssue({ code: "custom", path: ["floorPrograms"], message: "Floor program level exceeds the selected storey count." });
  }
  if (value.roadEdges && new Set(value.roadEdges).size !== value.roadEdges.length) {
    context.addIssue({ code: "custom", path: ["roadEdges"], message: "Road edges must be unique." });
  }
  if (value.budgetLowMajor !== undefined && value.budgetHighMajor !== undefined && value.budgetHighMajor < value.budgetLowMajor) {
    context.addIssue({ code: "custom", path: ["budgetHighMajor"], message: "Budget high value cannot be below the low value." });
  }
});

export type NlIntakeExtraction = z.infer<typeof nlIntakeExtractionSchema>;
