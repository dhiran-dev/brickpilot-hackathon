import { z } from "zod";

import { cardinalDirectionSchema, roomTypeSchema } from "@/lib/building/requirements";

export const pointSchema = z.object({ x: z.number().int(), y: z.number().int() });
export const rectangleSchema = z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int().positive(), depth: z.number().int().positive() });
export const polygonSchema = z.object({ points: z.array(pointSchema).min(4) });

export const wallSegmentSchema = z.object({
  id: z.string(),
  floorId: z.string(),
  start: pointSchema,
  end: pointSchema,
  thicknessMm: z.number().int().positive(),
  type: z.enum(["exterior", "interior", "shaft"]),
  adjacentSpaceIds: z.array(z.string()).max(2),
});

export const openingSchema = z.object({
  id: z.string(),
  floorId: z.string(),
  wallId: z.string(),
  kind: z.enum(["door", "window", "open_connection"]),
  usage: z.enum(["pedestrian", "vehicle", "daylight"]).optional(),
  offsetMm: z.number().int().nonnegative(),
  widthMm: z.number().int().positive(),
  heightMm: z.number().int().positive(),
  sillHeightMm: z.number().int().nonnegative().default(0),
  connects: z.tuple([z.string(), z.string()]),
  hinge: z.enum(["start", "end", "none"]),
  swing: z.enum(["clockwise", "counterclockwise", "none"]),
});

export const spaceSchema = z.object({
  id: z.string(),
  floorId: z.string(),
  name: z.string(),
  type: roomTypeSchema,
  planningCellPolygon: polygonSchema,
  bounds: rectangleSchema,
  areaMm2: z.number().int().positive(),
  occupied: z.boolean().default(true),
  accessible: z.boolean().default(false),
});

export const verticalConnectorSchema = z.object({
  id: z.string(),
  kind: z.enum(["straight_stair", "dog_leg_stair"]),
  servedFloorIds: z.array(z.string()).min(2),
  boundsByFloor: z.record(z.string(), rectangleSchema),
  widthMm: z.number().int().positive(),
  riseMm: z.number().int().positive(),
  runMm: z.number().int().positive(),
  direction: cardinalDirectionSchema,
});

export const structuralGridAxisSchema = z.object({
  id: z.string(),
  direction: z.enum(["x", "y"]),
  coordinateMm: z.number().int(),
});

export const structuralColumnSchema = z.object({
  id: z.string(),
  center: pointSchema,
  widthMm: z.number().int().positive(),
  depthMm: z.number().int().positive(),
  servedFloorIds: z.array(z.string()).min(1),
});

/**
 * Deterministic coordination aid only. It records an aligned conceptual column grid so obvious
 * multi-floor discontinuities and opening/stair collisions can be caught before presentation.
 * It is deliberately not a structural design, load calculation, or code approval artifact.
 */
export const structuralConceptSchema = z.object({
  structuralConceptVersion: z.literal(1),
  scope: z.literal("conceptual_column_coordination_only"),
  disclaimer: z.literal("Conceptual column coordination only; member sizing, loads, foundations and code compliance require a licensed structural engineer."),
  baselineMaxBayMm: z.number().int().positive(),
  axes: z.array(structuralGridAxisSchema),
  columns: z.array(structuralColumnSchema),
});

export const floorSchema = z.object({
  id: z.string(),
  label: z.string(),
  level: z.number().int().min(0).max(3),
  elevationMm: z.number().int().nonnegative(),
  floorHeightMm: z.number().int().positive(),
  envelope: rectangleSchema,
  spaces: z.array(spaceSchema).min(1),
  walls: z.array(wallSegmentSchema),
  openings: z.array(openingSchema),
});

export const buildingSchema = z.object({
  buildingSchemaVersion: z.literal(2),
  algorithmVersion: z.string(),
  rulePackVersion: z.string(),
  rendererVersion: z.string(),
  seed: z.number().int().nonnegative(),
  candidate: z.object({ generatorId: z.string(), index: z.number().int().nonnegative(), score: z.number().finite(), geometryHash: z.string() }),
  site: z.object({
    widthMm: z.number().int().positive(),
    depthMm: z.number().int().positive(),
    facing: cardinalDirectionSchema,
    roadEdges: z.array(cardinalDirectionSchema),
    buildableEnvelope: rectangleSchema,
  }),
  floors: z.array(floorSchema).min(1).max(4),
  verticalConnectors: z.array(verticalConnectorSchema),
  // Optional so already-persisted schema-v2 buildings remain readable. Newly generated buildings
  // always include this deterministic concept through generateBuilding().
  structuralConcept: structuralConceptSchema.optional(),
});

export type Point = z.infer<typeof pointSchema>;
export type Rectangle = z.infer<typeof rectangleSchema>;
export type Polygon = z.infer<typeof polygonSchema>;
export type WallSegment = z.infer<typeof wallSegmentSchema>;
export type Opening = z.infer<typeof openingSchema>;
export type Space = z.infer<typeof spaceSchema>;
export type Floor = z.infer<typeof floorSchema>;
export type VerticalConnector = z.infer<typeof verticalConnectorSchema>;
export type StructuralGridAxis = z.infer<typeof structuralGridAxisSchema>;
export type StructuralColumn = z.infer<typeof structuralColumnSchema>;
export type StructuralConcept = z.infer<typeof structuralConceptSchema>;
export type Building = z.infer<typeof buildingSchema>;

export function rectanglePolygon(rectangle: Rectangle): Polygon {
  const { x, y, width, depth } = rectangle;
  return { points: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + depth }, { x, y: y + depth }] };
}

export function canonicalBuildingJson(building: Building) {
  function sort(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sort);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, sort(nested)]),
      );
    }
    return value;
  }
  return JSON.stringify(sort(building));
}
