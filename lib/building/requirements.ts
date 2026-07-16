import { z } from "zod";

const positiveMm = z.number().int().positive();
const nonNegativeMm = z.number().int().nonnegative();

export const BUILDING_TYPE_OPTIONS = [
  { value: "detached_house", label: "Detached house", available: true },
  { value: "apartment", label: "Apartments", available: false, note: "Coming soon" },
  { value: "corporate_commercial", label: "Corporate / commercial", available: false, note: "Coming soon" },
] as const;

export const buildingTypeSchema = z.enum(["detached_house", "apartment", "corporate_commercial"]);
export const cardinalDirectionSchema = z.enum(["north", "east", "south", "west"]);
export const displayUnitSchema = z.enum(["metric", "imperial"]);
export const qualityTierSchema = z.enum(["essential", "standard", "premium"]);
export const roomTypeSchema = z.enum([
  "living",
  "dining",
  "kitchen",
  "bedroom",
  "bathroom",
  "pooja",
  "utility",
  "foyer",
  "parking",
  "study",
  "balcony",
  "circulation",
  "stair",
  "store",
  "courtyard",
  "terrace",
]);
export const privacySchema = z.enum(["public", "semi_private", "private", "service"]);
export const preferredZoneSchema = z.enum([
  "north",
  "northeast",
  "east",
  "southeast",
  "south",
  "southwest",
  "west",
  "northwest",
  "center",
  "any",
]);

export const floorRequirementSchema = z.object({
  id: z.string().regex(/^F[0-3]$/),
  label: z.string().min(1).max(32),
  level: z.number().int().min(0).max(3),
  floorHeightMm: positiveMm.min(2400).max(6000),
});

export const roomRequirementSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    name: z.string().trim().min(1).max(80),
    type: roomTypeSchema,
    floorId: z.string().regex(/^F[0-3]$/),
    minAreaMm2: z.number().int().positive(),
    targetAreaMm2: z.number().int().positive(),
    privacy: privacySchema.default("semi_private"),
    preferredZone: preferredZoneSchema.default("any"),
    mustBeExterior: z.boolean().default(false),
    accessible: z.boolean().default(false),
  })
  .superRefine((room, context) => {
    if (room.targetAreaMm2 < room.minAreaMm2) {
      context.addIssue({ code: "custom", path: ["targetAreaMm2"], message: "Target area cannot be below minimum area." });
    }
  });

export const relationshipSchema = z.object({
  type: z.enum(["must_connect", "prefer_near", "avoid_adjacent", "must_avoid", "stack_with"]),
  fromRoomId: z.string(),
  toRoomId: z.string(),
});

export const buildingRequirementsSchema = z
  .object({
    requirementSchemaVersion: z.literal(2).default(2),
    projectName: z.string().trim().min(1).max(120),
    buildingType: buildingTypeSchema.default("detached_house"),
    region: z.object({
      countryCode: z.string().length(2).transform((value) => value.toUpperCase()),
      adminArea: z.string().trim().min(1).max(80),
      locality: z.string().trim().min(1).max(120).optional(),
      locale: z.string().trim().min(2).max(24),
      currency: z.string().length(3).transform((value) => value.toUpperCase()),
    }),
    displayUnit: displayUnitSchema.default("metric"),
    site: z.object({
      widthMm: positiveMm.min(5000).max(200_000),
      depthMm: positiveMm.min(5000).max(200_000),
      facing: cardinalDirectionSchema,
      roadEdges: z.array(cardinalDirectionSchema).min(1).max(4),
      irregular: z.boolean().default(false),
      setbacksMm: z.object({
        north: nonNegativeMm,
        east: nonNegativeMm,
        south: nonNegativeMm,
        west: nonNegativeMm,
      }),
    }),
    floors: z.array(floorRequirementSchema).min(1).max(4),
    rooms: z.array(roomRequirementSchema).min(1).max(80),
    relationships: z.array(relationshipSchema).max(160).default([]),
    household: z.object({
      occupants: z.number().int().min(1).max(30),
      accessibilityRequired: z.boolean().default(false),
    }),
    vertical: z.object({
      stairFamily: z.enum(["straight", "dog_leg"]).default("dog_leg"),
      stairWidthMm: positiveMm.min(900).max(2400).default(1000),
      liftProvision: z.boolean().default(false),
    }),
    budget: z.object({
      qualityTier: qualityTierSchema.default("standard"),
      targetLowMinor: z.number().int().nonnegative().optional(),
      targetHighMinor: z.number().int().nonnegative().optional(),
      contingencyPercent: z.number().min(0).max(50).default(7.5),
      taxPercent: z.number().min(0).max(50).default(0),
    }),
    seed: z.number().int().min(0).max(0xffff_ffff).default(42),
  })
  .superRefine((requirements, context) => {
    if (requirements.buildingType !== "detached_house") {
      context.addIssue({ code: "custom", path: ["buildingType"], message: "BUILDING_TYPE_COMING_SOON" });
    }
    if (requirements.site.irregular) {
      context.addIssue({ code: "custom", path: ["site", "irregular"], message: "IRREGULAR_SITE_NOT_SUPPORTED" });
    }
    const buildableWidth = requirements.site.widthMm - requirements.site.setbacksMm.east - requirements.site.setbacksMm.west;
    const buildableDepth = requirements.site.depthMm - requirements.site.setbacksMm.north - requirements.site.setbacksMm.south;
    if (buildableWidth <= 0 || buildableDepth <= 0) {
      context.addIssue({ code: "custom", path: ["site", "setbacksMm"], message: "Setbacks consume the site envelope." });
    }
    const floorIds = new Set(requirements.floors.map((floor) => floor.id));
    if (floorIds.size !== requirements.floors.length) {
      context.addIssue({ code: "custom", path: ["floors"], message: "Floor IDs must be unique." });
    }
    const floorLevels = new Set<number>();
    for (const [index, floor] of requirements.floors.entries()) {
      if (floorLevels.has(floor.level)) {
        context.addIssue({ code: "custom", path: ["floors", index, "level"], message: "Floor levels must be unique." });
      }
      floorLevels.add(floor.level);
      if (floor.id !== `F${floor.level}`) {
        context.addIssue({ code: "custom", path: ["floors", index, "id"], message: "Floor ID must match its level." });
      }
    }
    for (let level = 0; level < requirements.floors.length; level += 1) {
      if (!floorLevels.has(level)) {
        context.addIssue({ code: "custom", path: ["floors"], message: "Floor levels must be contiguous from 0." });
        break;
      }
    }
    const roomIds = new Set<string>();
    for (const [index, room] of requirements.rooms.entries()) {
      if (!floorIds.has(room.floorId)) {
        context.addIssue({ code: "custom", path: ["rooms", index, "floorId"], message: "Room references an unknown floor." });
      }
      if (roomIds.has(room.id)) {
        context.addIssue({ code: "custom", path: ["rooms", index, "id"], message: "Room IDs must be unique." });
      }
      roomIds.add(room.id);
    }
    for (const [index, relation] of requirements.relationships.entries()) {
      if (!roomIds.has(relation.fromRoomId) || !roomIds.has(relation.toRoomId)) {
        context.addIssue({ code: "custom", path: ["relationships", index], message: "Relationship references an unknown room." });
      }
    }
  });

export type BuildingRequirements = z.infer<typeof buildingRequirementsSchema>;
export type FloorRequirement = z.infer<typeof floorRequirementSchema>;
export type RoomRequirement = z.infer<typeof roomRequirementSchema>;
export type RoomType = z.infer<typeof roomTypeSchema>;
export type PreferredZone = z.infer<typeof preferredZoneSchema>;
export type CardinalDirection = z.infer<typeof cardinalDirectionSchema>;

export function squareMetresToMm2(value: number) {
  return Math.round(value * 1_000_000);
}

export function mm2ToSquareMetres(value: number) {
  return value / 1_000_000;
}
