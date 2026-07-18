import { z } from "zod";

import { cardinalDirectionSchema, roomTypeSchema } from "@/lib/building/requirements";
import {
  DEFAULT_GUARD_HEIGHT_MM,
  ENCLOSURE_ROOF_MAX_OVERHANG_MM,
  PERGOLA_MAX_SLAT_SPACING_MM,
  PERGOLA_MIN_OPEN_AREA_RATIO,
  PERGOLA_MIN_SLAT_SPACING_MM,
  V3_GEOMETRY_POLICY_VERSION,
} from "@/lib/building/v3-constants";

export const pointSchema = z.object({ x: z.number().int(), y: z.number().int() });
export const rectangleSchema = z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int().positive(), depth: z.number().int().positive() });
export const polygonSchema = z.object({ points: z.array(pointSchema).min(4) });
export const point3Schema = z.object({ x: z.number().int(), y: z.number().int(), z: z.number().int() });
export const vector2Schema = z.object({ x: z.number(), y: z.number() });
export const vector3Schema = z.object({ x: z.number(), y: z.number(), z: z.number() });
export const segment2Schema = z.object({ start: pointSchema, end: pointSchema }).superRefine((segment, context) => {
  if (segment.start.x === segment.end.x && segment.start.y === segment.end.y) {
    context.addIssue({ code: "custom", message: "A segment must have non-zero length." });
  }
});
export const polygon3Schema = z.object({ vertices: z.array(point3Schema).min(3) });

function signedDoubleArea(points: Array<{ x: number; y: number }>) {
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0);
}

function orientation(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) {
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return Math.sign(cross);
}

function pointOnSegment(point: { x: number; y: number }, start: { x: number; y: number }, end: { x: number; y: number }) {
  return orientation(start, end, point) === 0
    && point.x >= Math.min(start.x, end.x)
    && point.x <= Math.max(start.x, end.x)
    && point.y >= Math.min(start.y, end.y)
    && point.y <= Math.max(start.y, end.y);
}

function segmentsIntersect(
  firstStart: { x: number; y: number },
  firstEnd: { x: number; y: number },
  secondStart: { x: number; y: number },
  secondEnd: { x: number; y: number },
) {
  const firstA = orientation(firstStart, firstEnd, secondStart);
  const firstB = orientation(firstStart, firstEnd, secondEnd);
  const secondA = orientation(secondStart, secondEnd, firstStart);
  const secondB = orientation(secondStart, secondEnd, firstEnd);
  if (firstA !== firstB && secondA !== secondB) return true;
  return (firstA === 0 && pointOnSegment(secondStart, firstStart, firstEnd))
    || (firstB === 0 && pointOnSegment(secondEnd, firstStart, firstEnd))
    || (secondA === 0 && pointOnSegment(firstStart, secondStart, secondEnd))
    || (secondB === 0 && pointOnSegment(firstEnd, secondStart, secondEnd));
}

/** Canonical schema-v3 planning polygon: simple, clockwise and orthogonal on the integer-mm grid. */
export const orthogonalPolygonSchema = z.object({ points: z.array(pointSchema).min(4) }).superRefine((polygon, context) => {
  const { points } = polygon;
  const first = points[0];
  const last = points.at(-1);
  if (first.x === last?.x && first.y === last.y) {
    context.addIssue({ code: "custom", path: ["points", points.length - 1], message: "Do not repeat the closing point." });
  }
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    if (point.x !== next.x && point.y !== next.y) {
      context.addIssue({ code: "custom", path: ["points", index], message: "Orthogonal polygon edges must be axis-aligned." });
    }
    if (point.x === next.x && point.y === next.y) {
      context.addIssue({ code: "custom", path: ["points", index], message: "Polygon edges must have non-zero length." });
    }
  }
  if (signedDoubleArea(points) >= 0) {
    context.addIssue({ code: "custom", path: ["points"], message: "Orthogonal polygon winding must be clockwise." });
  }
  for (let firstIndex = 0; firstIndex < points.length; firstIndex += 1) {
    const firstNext = (firstIndex + 1) % points.length;
    for (let secondIndex = firstIndex + 1; secondIndex < points.length; secondIndex += 1) {
      const secondNext = (secondIndex + 1) % points.length;
      const adjacent = firstIndex === secondIndex || firstNext === secondIndex || secondNext === firstIndex;
      if (adjacent) continue;
      if (segmentsIntersect(points[firstIndex], points[firstNext], points[secondIndex], points[secondNext])) {
        context.addIssue({ code: "custom", path: ["points", secondIndex], message: "Orthogonal polygon must not self-intersect." });
      }
    }
  }
});

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
  perimeterOpen: z.boolean().optional(),
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

const legacyBuildingObjectSchema = z.object({
  buildingSchemaVersion: z.literal(2),
  algorithmVersion: z.string(),
  rulePackVersion: z.string(),
  rendererVersion: z.string(),
  seed: z.number().int().nonnegative(),
  candidate: z.object({
    generatorId: z.string(),
    index: z.number().int().nonnegative(),
    score: z.number().finite(),
    geometryHash: z.string(),
    evidence: z.array(z.string()).optional(),
    relaxation: z.object({
      rung: z.number().int().min(0).max(3),
      id: z.enum(["preferred_parti", "alternate_parti", "simplified_court", "compact_fallback"]),
      simplifiedCourt: z.boolean(),
    }).optional(),
  }),
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

/**
 * Schema-v2 compatibility normalization for entry/gallery bays generated before the explicit
 * perimeter role was persisted. This inference is deliberately confined to the read boundary;
 * all newly generated spaces carry `perimeterOpen` directly.
 */
export const legacyBuildingSchema = legacyBuildingObjectSchema.transform((building) => {
  if (building.candidate.generatorId !== "t-hub") return building;
  const migratedLegacyPerimeterRole = building.floors.some((floor) => floor.level > 0 && floor.spaces.some((space) => (
    space.type === "verandah"
    && space.perimeterOpen === undefined
    && (space.id.endsWith("-entry-verandah") || space.id.endsWith("-covered-gallery") || space.id.endsWith("-branch"))
  )));
  return {
    ...building,
    candidate: migratedLegacyPerimeterRole ? {
      ...building.candidate,
      geometryHash: `${building.candidate.geometryHash}-perimeter-v1`,
    } : building.candidate,
    floors: building.floors.map((floor) => ({
      ...floor,
      spaces: floor.spaces.map((space) => {
        if (floor.level === 0 || space.type !== "verandah" || space.perimeterOpen !== undefined) return space;
        const isGeneratedUpperFacadeBay = space.id.endsWith("-entry-verandah")
          || space.id.endsWith("-covered-gallery")
          || space.id.endsWith("-branch");
        return isGeneratedUpperFacadeBay ? { ...space, perimeterOpen: false } : space;
      }),
    })),
  };
});

export const openingRoleSchema = z.enum([
  "main_entry",
  "secondary_entry",
  "service_entry",
  "interior_door",
  "vehicle_entry",
  "open_passage",
]);

export const currentOpeningSchema = openingSchema.safeExtend({
  role: openingRoleSchema.optional(),
  materialToken: z.string().min(1).optional(),
}).superRefine((opening, context) => {
  const requiresRole = opening.kind !== "window" || opening.usage === "pedestrian" || opening.usage === "vehicle";
  if (requiresRole && !opening.role) {
    context.addIssue({ code: "custom", path: ["role"], message: "Every pedestrian, vehicle, door, or passage opening requires a semantic role." });
  }
  if (opening.role === "vehicle_entry" && opening.usage !== "vehicle") {
    context.addIssue({ code: "custom", path: ["usage"], message: "Vehicle-entry openings must use vehicle usage." });
  }
  if (opening.role && opening.role !== "vehicle_entry" && opening.usage === "vehicle") {
    context.addIssue({ code: "custom", path: ["role"], message: "Vehicle openings must use the vehicle-entry role." });
  }
});

export const currentSpaceSchema = z.object({
  id: z.string().min(1),
  floorId: z.string().min(1),
  name: z.string().min(1),
  type: roomTypeSchema,
  regionId: z.string().min(1),
  accessible: z.boolean().default(false),
  perimeterOpen: z.boolean().optional(),
});

export const floorRegionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["interior", "covered_outdoor", "open_to_sky", "intentional_unbuilt"]),
  polygon: orthogonalPolygonSchema,
  spaceId: z.string().min(1).optional(),
}).superRefine((region, context) => {
  if (region.kind === "intentional_unbuilt" && region.spaceId) {
    context.addIssue({ code: "custom", path: ["spaceId"], message: "Intentional-unbuilt regions cannot be assigned to a space." });
  }
  if (region.kind !== "intentional_unbuilt" && !region.spaceId) {
    context.addIssue({ code: "custom", path: ["spaceId"], message: "Built and occupied floor regions must reference exactly one space." });
  }
});

export const roofPlaneSchema = z.object({
  id: z.string().min(1),
  vertices: z.array(point3Schema).min(3),
  drainageDirection: vector2Schema.optional(),
}).superRefine((plane, context) => {
  const [first, second, third] = plane.vertices;
  const ab = { x: second.x - first.x, y: second.y - first.y, z: second.z - first.z };
  const ac = { x: third.x - first.x, y: third.y - first.y, z: third.z - first.z };
  const cross = {
    x: ab.y * ac.z - ab.z * ac.y,
    y: ab.z * ac.x - ab.x * ac.z,
    z: ab.x * ac.y - ab.y * ac.x,
  };
  if (cross.x === 0 && cross.y === 0 && cross.z === 0) {
    context.addIssue({ code: "custom", path: ["vertices"], message: "A roof plane requires three non-collinear vertices." });
  }
});

export const linearMemberSchema = z.object({
  id: z.string().min(1),
  start: point3Schema,
  end: point3Schema,
  sectionMm: z.object({ width: z.number().int().positive(), depth: z.number().int().positive() }),
}).superRefine((member, context) => {
  if (member.start.x === member.end.x && member.start.y === member.end.y && member.start.z === member.end.z) {
    context.addIssue({ code: "custom", message: "A linear member must have non-zero length." });
  }
});

export const enclosureRoofSystemSchema = z.object({
  id: z.string().min(1),
  servesSpaceIds: z.array(z.string().min(1)),
  footprint: orthogonalPolygonSchema,
  kind: z.enum(["flat_slab", "gable", "hip", "shed", "solid_canopy"]),
  planes: z.array(roofPlaneSchema).min(1),
  eaveHeightMm: z.number().int().nonnegative(),
  overhangMm: z.number().int().min(0).max(ENCLOSURE_ROOF_MAX_OVERHANG_MM),
}).superRefine((roof, context) => {
  if (roof.kind !== "solid_canopy" && roof.servesSpaceIds.length === 0) {
    context.addIssue({ code: "custom", path: ["servesSpaceIds"], message: "Enclosure roofs must identify the spaces they serve." });
  }
});

export const openPergolaSystemSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("open_pergola"),
  hostFloorId: z.string().min(1),
  hostSpaceId: z.string().min(1).optional(),
  footprint: orthogonalPolygonSchema,
  frameMembers: z.array(linearMemberSchema).min(1),
  slatMembers: z.array(linearMemberSchema).min(1),
  slatOrientation: z.enum(["x", "y"]),
  slatSpacingMm: z.number().int().min(PERGOLA_MIN_SLAT_SPACING_MM).max(PERGOLA_MAX_SLAT_SPACING_MM),
  openAreaRatio: z.number().min(PERGOLA_MIN_OPEN_AREA_RATIO).max(1),
  topElevationMm: z.number().int().nonnegative(),
});

export const roofSystemSchema = z.union([enclosureRoofSystemSchema, openPergolaSystemSchema]);

const pointRoofSupportSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["canopy_post", "pergola_post"]),
  floorId: z.string().min(1),
  baseElevationMm: z.number().int().nonnegative(),
  topElevationMm: z.number().int().positive(),
  roofSystemIds: z.array(z.string().min(1)).min(1),
  geometry: pointSchema,
  sectionMm: z.object({ x: z.number().int().positive(), y: z.number().int().positive() }),
});

const ledgerRoofSupportSchema = z.object({
  id: z.string().min(1),
  role: z.literal("ledger"),
  floorId: z.string().min(1),
  baseElevationMm: z.number().int().nonnegative(),
  topElevationMm: z.number().int().positive(),
  roofSystemIds: z.array(z.string().min(1)).min(1),
  geometry: segment2Schema,
  sectionMm: z.object({ x: z.number().int().positive(), y: z.number().int().positive() }).optional(),
});

export const secondaryRoofSupportSchema = z.union([pointRoofSupportSchema, ledgerRoofSupportSchema]).superRefine((support, context) => {
  if (support.topElevationMm <= support.baseElevationMm) {
    context.addIssue({ code: "custom", path: ["topElevationMm"], message: "Roof support top must be above its base." });
  }
});

export const roofBearingLineSchema = z.object({
  id: z.string().min(1),
  segment: segment2Schema,
  role: z.enum(["perimeter", "interior"]),
  bearingWallIds: z.array(z.string().min(1)),
  structuralColumnIds: z.array(z.string().min(1)),
  secondarySupportIds: z.array(z.string().min(1)),
}).superRefine((line, context) => {
  if (line.bearingWallIds.length + line.structuralColumnIds.length + line.secondarySupportIds.length === 0) {
    context.addIssue({ code: "custom", message: "A roof bearing line must reference an authoritative wall, primary column, or secondary support." });
  }
});

export const roofSupportReferenceSchema = z.object({
  roofSystemId: z.string().min(1),
  bearingLines: z.array(roofBearingLineSchema).min(1),
});

export const edgeProtectionSchema = z.object({
  id: z.string().min(1),
  floorId: z.string().min(1),
  edge: segment2Schema,
  kind: z.enum(["parapet", "metal_rail", "glass_rail"]),
  heightMm: z.number().int().positive().default(DEFAULT_GUARD_HEIGHT_MM),
  dropHeightMm: z.number().int().nonnegative(),
});

export const facadeZoneSchema = z.object({
  side: cardinalDirectionSchema,
  exteriorWallIds: z.array(z.string().min(1)),
  articulationPolygons: z.array(polygon3Schema),
  role: z.enum(["primary_road_elevation", "secondary_road_elevation", "garden", "service"]),
  containsMainEntry: z.boolean(),
  allowedMaterialArticulation: z.array(z.string().min(1)),
});

export const intentRealizationSchema = z.object({
  requirementPath: z.string().min(1),
  requirementId: z.string().min(1).optional(),
  requestedValue: z.unknown(),
  realizedObjectIds: z.array(z.string().min(1)),
  status: z.enum(["realized", "relaxed", "incompatible"]),
  relaxationCode: z.string().min(1).optional(),
}).superRefine((realization, context) => {
  if (realization.status === "realized" && realization.realizedObjectIds.length === 0) {
    context.addIssue({ code: "custom", path: ["realizedObjectIds"], message: "Realized intent must reference canonical geometry." });
  }
  if (realization.status !== "realized" && !realization.relaxationCode) {
    context.addIssue({ code: "custom", path: ["relaxationCode"], message: "Relaxed or incompatible intent requires a stable code." });
  }
});

export const currentFloorSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  level: z.number().int().min(0).max(3),
  elevationMm: z.number().int().nonnegative(),
  floorHeightMm: z.number().int().positive(),
  envelope: orthogonalPolygonSchema,
  regions: z.array(floorRegionSchema).min(1),
  spaces: z.array(currentSpaceSchema),
  walls: z.array(wallSegmentSchema),
  openings: z.array(currentOpeningSchema),
}).superRefine((floor, context) => {
  const regionIds = new Set(floor.regions.map((region) => region.id));
  const spaceIds = new Set(floor.spaces.map((space) => space.id));
  const wallIds = new Set(floor.walls.map((wall) => wall.id));
  if (regionIds.size !== floor.regions.length) context.addIssue({ code: "custom", path: ["regions"], message: "Floor-region IDs must be unique." });
  if (spaceIds.size !== floor.spaces.length) context.addIssue({ code: "custom", path: ["spaces"], message: "Space IDs must be unique." });
  for (const [index, space] of floor.spaces.entries()) {
    const region = floor.regions.find((candidate) => candidate.id === space.regionId);
    if (!region || region.spaceId !== space.id) {
      context.addIssue({ code: "custom", path: ["spaces", index, "regionId"], message: "Each space must reference its single authoritative floor region." });
    }
    if (space.floorId !== floor.id) context.addIssue({ code: "custom", path: ["spaces", index, "floorId"], message: "Space floor ID must match its containing floor." });
  }
  for (const [index, region] of floor.regions.entries()) {
    if (region.spaceId && !spaceIds.has(region.spaceId)) {
      context.addIssue({ code: "custom", path: ["regions", index, "spaceId"], message: "Floor region references an unknown space." });
    }
  }
  for (const [index, opening] of floor.openings.entries()) {
    if (opening.floorId !== floor.id || !wallIds.has(opening.wallId)) {
      context.addIssue({ code: "custom", path: ["openings", index], message: "Opening references an unknown wall or a different floor." });
    }
  }
});

const currentBuildingObjectSchema = z.object({
  buildingSchemaVersion: z.literal(3),
  geometryPolicyVersion: z.literal(V3_GEOMETRY_POLICY_VERSION),
  algorithmVersion: z.string().min(1),
  rulePackVersion: z.string().min(1),
  rendererVersion: z.string().min(1),
  seed: z.number().int().nonnegative(),
  candidate: z.object({
    generatorId: z.string().min(1),
    index: z.number().int().nonnegative(),
    score: z.number().finite(),
    geometryHash: z.string().min(1),
    evidence: z.array(z.string()).optional(),
    relaxation: z.object({
      rung: z.number().int().min(0).max(3),
      id: z.string().min(1),
      simplifiedCourt: z.boolean().default(false),
    }).optional(),
  }),
  site: z.object({
    widthMm: z.number().int().positive(),
    depthMm: z.number().int().positive(),
    facing: cardinalDirectionSchema,
    roadEdges: z.array(cardinalDirectionSchema).min(1).max(4),
    buildableEnvelope: rectangleSchema,
  }),
  floors: z.array(currentFloorSchema).min(1).max(4),
  verticalConnectors: z.array(verticalConnectorSchema),
  structuralConcept: structuralConceptSchema,
  roofSystems: z.array(roofSystemSchema).min(1),
  secondaryRoofSupports: z.array(secondaryRoofSupportSchema),
  roofSupportReferences: z.array(roofSupportReferenceSchema),
  edgeProtections: z.array(edgeProtectionSchema),
  facadeZones: z.array(facadeZoneSchema).min(1).max(4),
  intentRealizations: z.array(intentRealizationSchema),
});

export const currentBuildingSchema = currentBuildingObjectSchema.superRefine((building, context) => {
  const floorIds = new Set(building.floors.map((floor) => floor.id));
  if (floorIds.size !== building.floors.length) context.addIssue({ code: "custom", path: ["floors"], message: "Floor IDs must be unique." });
  const wallIds = new Set(building.floors.flatMap((floor) => floor.walls.map((wall) => wall.id)));
  const spaceIds = new Set(building.floors.flatMap((floor) => floor.spaces.map((space) => space.id)));
  const columnIds = new Set(building.structuralConcept.columns.map((column) => column.id));
  const roofIds = new Set(building.roofSystems.map((roof) => roof.id));
  const secondarySupportIds = new Set(building.secondaryRoofSupports.map((support) => support.id));
  if (roofIds.size !== building.roofSystems.length) context.addIssue({ code: "custom", path: ["roofSystems"], message: "Roof-system IDs must be unique." });
  if (secondarySupportIds.size !== building.secondaryRoofSupports.length) context.addIssue({ code: "custom", path: ["secondaryRoofSupports"], message: "Secondary-support IDs must be unique." });
  const allOpenings = building.floors.flatMap((floor) => floor.openings);
  if (allOpenings.filter((opening) => opening.role === "main_entry").length !== 1) {
    context.addIssue({ code: "custom", path: ["floors"], message: "A current building must contain exactly one main-entry opening." });
  }
  for (const [index, roof] of building.roofSystems.entries()) {
    const servedSpaceIds = roof.kind === "open_pergola" ? [roof.hostSpaceId].filter(Boolean) : roof.servesSpaceIds;
    if (servedSpaceIds.some((spaceId) => !spaceIds.has(spaceId as string))) {
      context.addIssue({ code: "custom", path: ["roofSystems", index], message: "Roof system references an unknown space." });
    }
  }
  for (const [index, support] of building.secondaryRoofSupports.entries()) {
    if (!floorIds.has(support.floorId) || support.roofSystemIds.some((roofId) => !roofIds.has(roofId))) {
      context.addIssue({ code: "custom", path: ["secondaryRoofSupports", index], message: "Secondary support references an unknown floor or roof system." });
    }
  }
  for (const [referenceIndex, reference] of building.roofSupportReferences.entries()) {
    if (!roofIds.has(reference.roofSystemId)) context.addIssue({ code: "custom", path: ["roofSupportReferences", referenceIndex, "roofSystemId"], message: "Roof support reference targets an unknown roof system." });
    for (const [lineIndex, line] of reference.bearingLines.entries()) {
      if (line.bearingWallIds.some((id) => !wallIds.has(id))
        || line.structuralColumnIds.some((id) => !columnIds.has(id))
        || line.secondarySupportIds.some((id) => !secondarySupportIds.has(id))) {
        context.addIssue({ code: "custom", path: ["roofSupportReferences", referenceIndex, "bearingLines", lineIndex], message: "Bearing line references a non-authoritative support object." });
      }
    }
  }
  const referencedRoofIds = building.roofSupportReferences.map((reference) => reference.roofSystemId);
  if (new Set(referencedRoofIds).size !== referencedRoofIds.length
    || roofIds.size !== new Set(referencedRoofIds).size
    || [...roofIds].some((roofId) => !referencedRoofIds.includes(roofId))) {
    context.addIssue({ code: "custom", path: ["roofSupportReferences"], message: "Every roof system must have exactly one support reference." });
  }
  for (const [index, protection] of building.edgeProtections.entries()) {
    if (!floorIds.has(protection.floorId)) context.addIssue({ code: "custom", path: ["edgeProtections", index, "floorId"], message: "Edge protection references an unknown floor." });
  }
  const primaryFacades = building.facadeZones.filter((zone) => zone.role === "primary_road_elevation");
  const mainEntry = allOpenings.find((opening) => opening.role === "main_entry");
  if (primaryFacades.length !== 1
    || !primaryFacades[0]?.containsMainEntry
    || !mainEntry
    || !primaryFacades[0].exteriorWallIds.includes(mainEntry.wallId)) {
    context.addIssue({ code: "custom", path: ["facadeZones"], message: "Exactly one primary road facade must contain the main entry." });
  }
  for (const [index, facade] of building.facadeZones.entries()) {
    if (facade.exteriorWallIds.some((wallId) => !wallIds.has(wallId))) {
      context.addIssue({ code: "custom", path: ["facadeZones", index, "exteriorWallIds"], message: "Facade zone references an unknown exterior wall." });
    }
  }
});

/** Backwards-compatible export for existing schema-v2 consumers. */
export const buildingSchema = legacyBuildingSchema;
/** Read-only boundary. Mutation/generation code must parse the explicit versioned schema. */
export const readableBuildingSchema = z.union([legacyBuildingSchema, currentBuildingSchema]);

/**
 * Lightweight persisted-contract discriminator. This identifies routing metadata only; callers
 * must still parse with the full schema for the returned version before consuming geometry.
 */
export const buildingVersionDiscriminatorSchema = z.object({
  buildingSchemaVersion: z.union([z.literal(2), z.literal(3)]),
}).passthrough();

export type BuildingContractVersion = "v2" | "v3";

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
export type LegacyBuilding = z.infer<typeof legacyBuildingSchema>;
export type CurrentBuilding = z.infer<typeof currentBuildingSchema>;
/** Backwards-compatible type alias for existing schema-v2 consumers. */
export type Building = LegacyBuilding;
export type ReadableBuilding = LegacyBuilding | CurrentBuilding;

export type Point3 = z.infer<typeof point3Schema>;
export type Vector2 = z.infer<typeof vector2Schema>;
export type Vector3 = z.infer<typeof vector3Schema>;
export type Segment2 = z.infer<typeof segment2Schema>;
export type OrthogonalPolygon = z.infer<typeof orthogonalPolygonSchema>;
export type OpeningRole = z.infer<typeof openingRoleSchema>;
export type CurrentOpening = z.infer<typeof currentOpeningSchema>;
export type CurrentSpace = z.infer<typeof currentSpaceSchema>;
export type FloorRegion = z.infer<typeof floorRegionSchema>;
export type CurrentFloor = z.infer<typeof currentFloorSchema>;
export type RoofPlane = z.infer<typeof roofPlaneSchema>;
export type LinearMember = z.infer<typeof linearMemberSchema>;
export type EnclosureRoofSystem = z.infer<typeof enclosureRoofSystemSchema>;
export type OpenPergolaSystem = z.infer<typeof openPergolaSystemSchema>;
export type RoofSystem = z.infer<typeof roofSystemSchema>;
export type SecondaryRoofSupport = z.infer<typeof secondaryRoofSupportSchema>;
export type RoofBearingLine = z.infer<typeof roofBearingLineSchema>;
export type RoofSupportReference = z.infer<typeof roofSupportReferenceSchema>;
export type EdgeProtection = z.infer<typeof edgeProtectionSchema>;
export type FacadeZone = z.infer<typeof facadeZoneSchema>;
export type IntentRealization = z.infer<typeof intentRealizationSchema>;

export type ReadableBuildingDescriptor = {
  contractVersion: BuildingContractVersion;
  buildingSchemaVersion: 2 | 3;
  geometryHash: string;
  building: ReadableBuilding;
};

export type ReadableBuildingResult =
  | { success: true; data: ReadableBuildingDescriptor }
  | { success: false; reason: "INVALID_BUILDING" | "UNSUPPORTED_BUILDING_VERSION"; contractVersion: BuildingContractVersion | null };

export function buildingContractVersion(value: unknown): BuildingContractVersion | null {
  const parsed = buildingVersionDiscriminatorSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data.buildingSchemaVersion === 2 ? "v2" : "v3";
}

/**
 * Full, fail-closed read adapter for canonical persisted buildings. WS3 extends the v3 branch when
 * the current building schema lands; until then a v3 marker is recognized but never treated as
 * validated geometry.
 */
export function readCanonicalBuilding(value: unknown): ReadableBuildingResult {
  const contractVersion = buildingContractVersion(value);
  if (!contractVersion) return { success: false, reason: "UNSUPPORTED_BUILDING_VERSION", contractVersion };
  const parsed = contractVersion === "v2"
    ? legacyBuildingSchema.safeParse(value)
    : currentBuildingSchema.safeParse(value);
  if (!parsed.success) return { success: false, reason: "INVALID_BUILDING", contractVersion };
  return {
    success: true,
    data: {
      contractVersion,
      buildingSchemaVersion: parsed.data.buildingSchemaVersion,
      geometryHash: parsed.data.candidate.geometryHash,
      building: parsed.data,
    },
  };
}

export function readableBuildingGeometryHash(value: unknown): string | null {
  const parsed = readCanonicalBuilding(value);
  return parsed.success ? parsed.data.geometryHash : null;
}

export function rectanglePolygon(rectangle: Rectangle): Polygon {
  const { x, y, width, depth } = rectangle;
  return { points: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + depth }, { x, y: y + depth }] };
}

export function canonicalBuildingJson(building: ReadableBuilding) {
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
