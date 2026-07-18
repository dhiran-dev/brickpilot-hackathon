import { z } from "zod";

const positiveMm = z.number().int().positive();
const nonNegativeMm = z.number().int().nonnegative();

export const BUILDING_TYPE_OPTIONS = [
  { value: "detached_house", label: "Villa / bungalow", available: true },
  { value: "apartment", label: "Apartments", available: false, note: "Coming soon" },
  { value: "corporate_commercial", label: "Corporate / commercial", available: false, note: "Coming soon" },
] as const;

export const buildingTypeSchema = z.enum(["detached_house", "apartment", "corporate_commercial"]);
export const cardinalDirectionSchema = z.enum(["north", "east", "south", "west"]);
export const displayUnitSchema = z.enum(["metric", "imperial"]);
export const qualityTierSchema = z.enum(["essential", "standard", "premium"]);
export const architecturalStyleSchema = z.enum([
  "contemporary_tropical",
  "warm_minimal",
  "kerala_contemporary",
  "modernist",
  "courtyard_vernacular",
]);
export const formStrategySchema = z.enum(["compact", "stepped_terraces", "courtyard", "articulated_wings"]);
export const roofCharacterSchema = z.enum(["flat_parapet", "sloped", "mixed"]);
export const materialDirectionSchema = z.enum(["warm_natural", "light_mineral", "earthy_textured", "monochrome"]);
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
  "verandah",
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

export const choiceSourceSchema = z.enum(["user", "inferred", "default"]);

export function sourcedChoiceSchema<const T extends z.ZodType>(value: T) {
  return z.object({ value, source: choiceSourceSchema });
}

export const entryRequirementsSchema = z.object({
  primarySide: sourcedChoiceSchema(z.enum(["north", "east", "south", "west", "auto_road_side"])),
  secondaryEntry: sourcedChoiceSchema(z.enum(["none", "rear", "service_side", "auto"])),
  primaryDoorClearWidthMm: positiveMm.min(1000).max(2400).default(1200),
});

export const shadeStructureRequirementSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  type: z.enum(["open_pergola", "solid_canopy"]),
  location: z.enum(["front_entry", "parking", "verandah", "terrace"]),
  targetAreaM2: z.number().positive().max(200).optional(),
  source: choiceSourceSchema,
});

export const boundedAreaRequirementSchema = z.object({
  targetAreaMm2: z.number().int().nonnegative().optional(),
  minimumAreaMm2: z.number().int().nonnegative().optional(),
  maximumAreaMm2: z.number().int().positive().optional(),
}).superRefine((area, context) => {
  if (area.minimumAreaMm2 !== undefined && area.maximumAreaMm2 !== undefined && area.minimumAreaMm2 > area.maximumAreaMm2) {
    context.addIssue({ code: "custom", path: ["minimumAreaMm2"], message: "Minimum area cannot exceed maximum area." });
  }
  if (area.targetAreaMm2 !== undefined && area.minimumAreaMm2 !== undefined && area.targetAreaMm2 < area.minimumAreaMm2) {
    context.addIssue({ code: "custom", path: ["targetAreaMm2"], message: "Target area cannot be below minimum area." });
  }
  if (area.targetAreaMm2 !== undefined && area.maximumAreaMm2 !== undefined && area.targetAreaMm2 > area.maximumAreaMm2) {
    context.addIssue({ code: "custom", path: ["targetAreaMm2"], message: "Target area cannot exceed maximum area." });
  }
});

export const outdoorAreaRequirementSchema = boundedAreaRequirementSchema.safeExtend({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  floorId: z.string().regex(/^F[0-3]$/),
  type: z.enum(["balcony", "verandah"]),
  source: choiceSourceSchema,
});

export const parkingRequirementSchema = boundedAreaRequirementSchema.safeExtend({
  vehicleCount: z.number().int().min(0).max(8),
  preferredSide: sourcedChoiceSchema(z.enum(["north", "east", "south", "west", "auto_road_side"])),
});

/**
 * Frozen requirements contract used by the schema-v2 design pipeline.
 *
 * Keep this schema behaviorally stable while current-v2 projects remain mutable. New requirement
 * fields belong in the current/v3 contract, not in this compatibility schema.
 */
export const legacyBuildingRequirementsSchema = z
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
    architecture: z.object({
      style: architecturalStyleSchema.default("contemporary_tropical"),
      formStrategy: formStrategySchema.default("stepped_terraces"),
      roofCharacter: roofCharacterSchema.default("mixed"),
      materialDirection: materialDirectionSchema.default("warm_natural"),
    }).default({
      style: "contemporary_tropical",
      formStrategy: "stepped_terraces",
      roofCharacter: "mixed",
      materialDirection: "warm_natural",
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

/**
 * Current requirements contract. It retains the stable residential program fields so adapters can
 * share intake primitives, while all new architectural intent is explicit and provenance-aware.
 */
export const currentBuildingRequirementsSchema = z.object({
  ...legacyBuildingRequirementsSchema.shape,
  requirementSchemaVersion: z.literal(3),
  entry: entryRequirementsSchema,
  parking: parkingRequirementSchema,
  outdoorAreas: z.array(outdoorAreaRequirementSchema).max(16).default([]),
  courtyard: sourcedChoiceSchema(z.enum(["none", "open_to_sky", "covered", "auto"])),
  roof: sourcedChoiceSchema(roofCharacterSchema),
  shadeStructures: z.array(shadeStructureRequirementSchema).max(16).default([]),
  aboveParkingUse: sourcedChoiceSchema(z.enum(["occupied_rooms", "balcony", "terrace", "unbuilt", "auto"])),
  maxExteriorPedestrianEntryCount: z.number().int().min(1).max(4).default(2),
}).superRefine((requirements, context) => {
  const legacyCompatibility = legacyBuildingRequirementsSchema.safeParse({ ...requirements, requirementSchemaVersion: 2 });
  if (!legacyCompatibility.success) {
    for (const issue of legacyCompatibility.error.issues) context.addIssue({ ...issue });
  }
  const floorIds = new Set(requirements.floors.map((floor) => floor.id));
  const outdoorIds = new Set<string>();
  for (const [index, outdoor] of requirements.outdoorAreas.entries()) {
    if (!floorIds.has(outdoor.floorId)) {
      context.addIssue({ code: "custom", path: ["outdoorAreas", index, "floorId"], message: "Outdoor area references an unknown floor." });
    }
    if (outdoorIds.has(outdoor.id)) {
      context.addIssue({ code: "custom", path: ["outdoorAreas", index, "id"], message: "Outdoor area IDs must be unique." });
    }
    outdoorIds.add(outdoor.id);
  }
  const shadeIds = new Set<string>();
  for (const [index, shade] of requirements.shadeStructures.entries()) {
    if (shadeIds.has(shade.id)) {
      context.addIssue({ code: "custom", path: ["shadeStructures", index, "id"], message: "Shade-structure IDs must be unique." });
    }
    shadeIds.add(shade.id);
  }
  if (requirements.parking.vehicleCount === 0 && requirements.parking.minimumAreaMm2 && requirements.parking.minimumAreaMm2 > 0) {
    context.addIssue({ code: "custom", path: ["parking", "minimumAreaMm2"], message: "Parking area cannot be required when vehicle count is zero." });
  }
  const parkingRooms = requirements.rooms.filter((room) => room.type === "parking");
  if ((requirements.parking.vehicleCount > 0) !== (parkingRooms.length > 0)) {
    context.addIssue({ code: "custom", path: ["parking", "vehicleCount"], message: "Vehicle count and the canonical parking program must agree." });
  }
  for (const [index, outdoor] of requirements.outdoorAreas.entries()) {
    if (!requirements.rooms.some((room) => room.floorId === outdoor.floorId && room.type === outdoor.type)) {
      context.addIssue({ code: "custom", path: ["outdoorAreas", index], message: "Outdoor-area intent must correspond to a programmed balcony or verandah." });
    }
  }
  const hasCourtyardRoom = requirements.rooms.some((room) => room.type === "courtyard");
  if (requirements.courtyard.value === "none" && hasCourtyardRoom) {
    context.addIssue({ code: "custom", path: ["courtyard"], message: "Courtyard provenance conflicts with the room program." });
  }
  if (["open_to_sky", "covered"].includes(requirements.courtyard.value) && !hasCourtyardRoom) {
    context.addIssue({ code: "custom", path: ["courtyard"], message: "Requested courtyard intent requires a courtyard room in the program." });
  }
  if (requirements.roof.value !== requirements.architecture.roofCharacter) {
    context.addIssue({ code: "custom", path: ["roof"], message: "Provenance-aware roof intent must match the architectural brief value." });
  }
});

/** Backwards-compatible export for existing v2 callers. */
export const buildingRequirementsSchema = legacyBuildingRequirementsSchema;
/** Read-only boundary. Mutation/generation code must parse the explicit contract instead. */
export const readableBuildingRequirementsSchema = z.union([
  legacyBuildingRequirementsSchema,
  currentBuildingRequirementsSchema,
]);

export const buildingRequirementsVersionDiscriminatorSchema = z.object({
  requirementSchemaVersion: z.union([z.literal(2), z.literal(3)]),
}).passthrough();

export type BuildingRequirementsContractVersion = "v2" | "v3";
export type LegacyBuildingRequirements = z.infer<typeof legacyBuildingRequirementsSchema>;
export type CurrentBuildingRequirements = z.infer<typeof currentBuildingRequirementsSchema>;
/** Backwards-compatible type alias for existing v2 callers. */
export type BuildingRequirements = LegacyBuildingRequirements;
export type ReadableBuildingRequirements = LegacyBuildingRequirements | CurrentBuildingRequirements;
export type FloorRequirement = z.infer<typeof floorRequirementSchema>;
export type RoomRequirement = z.infer<typeof roomRequirementSchema>;
export type RoomType = z.infer<typeof roomTypeSchema>;
export type PreferredZone = z.infer<typeof preferredZoneSchema>;
export type CardinalDirection = z.infer<typeof cardinalDirectionSchema>;
export type ArchitecturalStyle = z.infer<typeof architecturalStyleSchema>;
export type FormStrategy = z.infer<typeof formStrategySchema>;
export type ChoiceSource = z.infer<typeof choiceSourceSchema>;
export type SourcedChoice<T> = { value: T; source: ChoiceSource };
export type EntryRequirements = z.infer<typeof entryRequirementsSchema>;
export type ShadeStructureRequirement = z.infer<typeof shadeStructureRequirementSchema>;
export type OutdoorAreaRequirement = z.infer<typeof outdoorAreaRequirementSchema>;
export type ParkingRequirement = z.infer<typeof parkingRequirementSchema>;

export function buildingRequirementsContractVersion(value: unknown): BuildingRequirementsContractVersion | null {
  const parsed = buildingRequirementsVersionDiscriminatorSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data.requirementSchemaVersion === 2 ? "v2" : "v3";
}

export function hasMinimumResidentialRoomProgram(requirements: BuildingRequirements) {
  return requirements.rooms.some((room) => room.type === "bedroom")
    && requirements.rooms.some((room) => room.type === "bathroom");
}

export function squareMetresToMm2(value: number) {
  return Math.round(value * 1_000_000);
}

export function mm2ToSquareMetres(value: number) {
  return value / 1_000_000;
}
