import type { ValidationCategory, ValidationFinding, ValidationSeverity } from "@/lib/validation/types";

export const RULE_PACK_VERSION = "residential-baseline-2026.5";
export const MIN_CONCEPT_PASSAGE_WIDTH_MM = 700;
export const MIN_VEHICLE_ACCESS_WIDTH_MM = 2400;

export const RULES = {
  geometryOverlap: "GEOMETRY_NO_OVERLAP",
  geometryGap: "GEOMETRY_NO_GAPS",
  geometryEnvelope: "GEOMETRY_WITHIN_ENVELOPE",
  wallCanonical: "TOPOLOGY_CANONICAL_WALL",
  reachable: "CIRCULATION_REACHABLE",
  circulationPrivacy: "CIRCULATION_PRIVACY_CONFLICT",
  passableOpening: "OPENING_REQUIRED",
  openingPassageWidth: "OPENING_MIN_PASSAGE_WIDTH",
  openingOnWall: "OPENING_ON_WALL",
  openingClearance: "OPENING_CLEARANCE",
  accessibilityClearance: "ACCESSIBILITY_OPENING_CLEARANCE",
  windowExterior: "WINDOW_EXTERIOR_ONLY",
  parkingRoadAccess: "PARKING_ROAD_ACCESS_REQUIRED",
  vehicleOpening: "OPENING_VEHICLE_ACCESS_INVALID",
  stairRequired: "VERTICAL_STAIR_REQUIRED",
  stairContinuous: "VERTICAL_STAIR_CONTINUOUS",
  stairGeometry: "VERTICAL_STAIR_GEOMETRY",
  structuralColumnContinuous: "STRUCTURE_COLUMN_CONTINUOUS",
  structuralColumnClearance: "STRUCTURE_COLUMN_CLEARANCE",
  structuralGridDuplicate: "STRUCTURE_GRID_DUPLICATE",
  structuralBayBaseline: "STRUCTURE_BAY_SPAN_BASELINE",
  roomMinimumArea: "PLANNING_ROOM_MIN_AREA",
  roomMinimumDimension: "PLANNING_ROOM_MIN_DIMENSION",
  roomAspect: "PLANNING_ROOM_ASPECT",
  roomProportion: "ROOM_PROPORTION",
  parallelBands: "PARALLEL_BANDS",
  circulationRatio: "CIRCULATION_RATIO",
  galleryLength: "GALLERY_LENGTH",
  floatingVolume: "FLOATING_VOLUME",
  exteriorPreference: "PLANNING_EXTERIOR_ROOM",
  daylight: "PLANNING_DAYLIGHT_INDICATION",
  relationshipConnect: "PLANNING_MUST_CONNECT",
  stackAlignment: "PLANNING_STACK_ALIGNMENT",
} as const;

export function finding(
  ruleId: string,
  severity: ValidationSeverity,
  category: ValidationCategory,
  message: string,
  fields: Partial<Omit<ValidationFinding, "ruleId" | "ruleVersion" | "severity" | "category" | "message" | "sourceKind">> &
    Pick<ValidationFinding, "objectIds">,
  sourceKind: ValidationFinding["sourceKind"] = "geometry",
): ValidationFinding {
  return { ruleId, ruleVersion: 1, severity, category, message, sourceKind, ...fields };
}
