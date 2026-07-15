import { z } from "zod";

const finitePositive = z.number().finite().positive();
const finiteNonNegative = z.number().finite().nonnegative();

export const cardinalDirectionSchema = z.enum(["north", "east", "south", "west"]);
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
]);

export const roomRequirementSchema = z
  .object({
    id: z.string().trim().regex(/^[a-z][a-z0-9-]*$/),
    name: z.string().trim().min(1).max(80),
    type: roomTypeSchema,
    minAreaSqFt: finitePositive.max(2_500),
    targetAreaSqFt: finitePositive.max(4_000).optional(),
    preferredZone: preferredZoneSchema.default("any"),
  })
  .superRefine((room, context) => {
    if (room.targetAreaSqFt !== undefined && room.targetAreaSqFt < room.minAreaSqFt) {
      context.addIssue({
        code: "custom",
        message: "targetAreaSqFt must be greater than or equal to minAreaSqFt",
        path: ["targetAreaSqFt"],
      });
    }
  });

export const requirementDataSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    units: z.literal("feet").default("feet"),
    name: z.string().trim().min(1).max(120),
    plot: z.object({
      widthFt: finitePositive.min(10).max(300),
      depthFt: finitePositive.min(10).max(300),
      facing: cardinalDirectionSchema,
    }),
    setbacks: z
      .object({
        northFt: finiteNonNegative.max(100).default(0),
        eastFt: finiteNonNegative.max(100).default(0),
        southFt: finiteNonNegative.max(100).default(0),
        westFt: finiteNonNegative.max(100).default(0),
      })
      .default({ northFt: 0, eastFt: 0, southFt: 0, westFt: 0 }),
    floors: z.literal(1).default(1),
    rooms: z.array(roomRequirementSchema).min(1).max(32),
  })
  .superRefine((requirements, context) => {
    const width = requirements.plot.widthFt - requirements.setbacks.eastFt - requirements.setbacks.westFt;
    const depth = requirements.plot.depthFt - requirements.setbacks.northFt - requirements.setbacks.southFt;

    if (width <= 0) {
      context.addIssue({ code: "custom", message: "East and west setbacks consume the plot width", path: ["setbacks"] });
    }
    if (depth <= 0) {
      context.addIssue({ code: "custom", message: "North and south setbacks consume the plot depth", path: ["setbacks"] });
    }

    const ids = new Set<string>();
    for (const [index, room] of requirements.rooms.entries()) {
      if (ids.has(room.id)) {
        context.addIssue({ code: "custom", message: `Duplicate room id: ${room.id}`, path: ["rooms", index, "id"] });
      }
      ids.add(room.id);
    }

    if (width > 0 && depth > 0) {
      const buildableArea = width * depth;
      const requiredArea = requirements.rooms.reduce((total, room) => total + room.minAreaSqFt, 0);
      if (requiredArea > buildableArea + 1e-8) {
        context.addIssue({
          code: "custom",
          message: `Required minimum room area (${requiredArea.toFixed(1)} sq ft) exceeds buildable area (${buildableArea.toFixed(1)} sq ft)`,
          path: ["rooms"],
        });
      }
    }
  });

const rectangleSchema = z.object({
  xFt: z.number().finite().nonnegative(),
  yFt: z.number().finite().nonnegative(),
  widthFt: finitePositive,
  depthFt: finitePositive,
  areaSqFt: finitePositive,
});

export const layoutRoomSchema = rectangleSchema.extend({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1).max(80),
  type: roomTypeSchema,
  floor: z.literal("G"),
  preferredZone: preferredZoneSchema,
  minAreaSqFt: finitePositive,
});

export const layoutDataSchema = z.object({
  schemaVersion: z.literal(1),
  algorithmVersion: z.literal("recursive-slicing-v1"),
  units: z.literal("feet"),
  seed: z.number().int().min(0).max(0xffff_ffff),
  floor: z.literal("G"),
  plot: z.object({
    widthFt: finitePositive,
    depthFt: finitePositive,
    facing: cardinalDirectionSchema,
  }),
  buildableBounds: rectangleSchema,
  rooms: z.array(layoutRoomSchema).min(1).max(32),
  coverageRatio: z.number().finite().min(0.999_999).max(1.000_001),
});

export type CardinalDirection = z.infer<typeof cardinalDirectionSchema>;
export type PreferredZone = z.infer<typeof preferredZoneSchema>;
export type RoomType = z.infer<typeof roomTypeSchema>;
export type RoomRequirement = z.infer<typeof roomRequirementSchema>;
export type RequirementData = z.infer<typeof requirementDataSchema>;
export type LayoutRoom = z.infer<typeof layoutRoomSchema>;
export type LayoutData = z.infer<typeof layoutDataSchema>;
