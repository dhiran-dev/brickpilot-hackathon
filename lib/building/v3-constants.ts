/**
 * Schema-v3 conceptual feasibility constants.
 *
 * These are product heuristics, not structural engineering or jurisdictional approval. Generator,
 * validation, drawing, massing and costing code must import this module instead of copying values.
 */
export const V3_GEOMETRY_POLICY_VERSION = "building-geometry-v3.0.0" as const;

export const COORDINATE_GRID_MM = 1;
export const EDGE_EQUALITY_TOLERANCE_MM = 1;
export const AREA_TOLERANCE_MM2 = 100;

export const MAIN_ENTRY_TARGET_CLEAR_WIDTH_MM = 1200;
export const MAIN_ENTRY_MIN_CLEAR_WIDTH_MM = 1000;
export const DOOR_JUNCTION_CLEARANCE_MM = 50;
export const MAIN_ENTRY_MIN_WALL_RUN_MM = 1300;
export const VEHICLE_APERTURE_MIN_CLEAR_WIDTH_MM = 2400;

export const GUARD_TRIGGER_DROP_MM = 600;
export const DEFAULT_GUARD_HEIGHT_MM = 1100;

export const ENCLOSURE_ROOF_MAX_SUPPORT_REACH_MM = 3000;
export const ENCLOSURE_ROOF_MAX_OVERHANG_MM = 750;
export const CANOPY_MAX_UNSUPPORTED_SPAN_MM = 4000;
export const PERGOLA_MAX_POST_SPACING_MM = 3500;
export const PERGOLA_MIN_SLAT_SPACING_MM = 150;
export const PERGOLA_MAX_SLAT_SPACING_MM = 450;
export const PERGOLA_MIN_OPEN_AREA_RATIO = 0.5;

export const PARTI_VARIATION_RETRIES = 3;
export const RENDER_EVAL_SAMPLE_COUNT = 5;

export const V3_GEOMETRY_POLICY = Object.freeze({
  version: V3_GEOMETRY_POLICY_VERSION,
  coordinateGridMm: COORDINATE_GRID_MM,
  edgeEqualityToleranceMm: EDGE_EQUALITY_TOLERANCE_MM,
  areaToleranceMm2: AREA_TOLERANCE_MM2,
  mainEntryTargetClearWidthMm: MAIN_ENTRY_TARGET_CLEAR_WIDTH_MM,
  mainEntryMinClearWidthMm: MAIN_ENTRY_MIN_CLEAR_WIDTH_MM,
  doorJunctionClearanceMm: DOOR_JUNCTION_CLEARANCE_MM,
  mainEntryMinWallRunMm: MAIN_ENTRY_MIN_WALL_RUN_MM,
  vehicleApertureMinClearWidthMm: VEHICLE_APERTURE_MIN_CLEAR_WIDTH_MM,
  guardTriggerDropMm: GUARD_TRIGGER_DROP_MM,
  defaultGuardHeightMm: DEFAULT_GUARD_HEIGHT_MM,
  enclosureRoofMaxSupportReachMm: ENCLOSURE_ROOF_MAX_SUPPORT_REACH_MM,
  enclosureRoofMaxOverhangMm: ENCLOSURE_ROOF_MAX_OVERHANG_MM,
  canopyMaxUnsupportedSpanMm: CANOPY_MAX_UNSUPPORTED_SPAN_MM,
  pergolaMaxPostSpacingMm: PERGOLA_MAX_POST_SPACING_MM,
  pergolaSlatSpacingMm: {
    min: PERGOLA_MIN_SLAT_SPACING_MM,
    max: PERGOLA_MAX_SLAT_SPACING_MM,
  },
  pergolaMinOpenAreaRatio: PERGOLA_MIN_OPEN_AREA_RATIO,
  partiVariationRetries: PARTI_VARIATION_RETRIES,
  renderEvalSampleCount: RENDER_EVAL_SAMPLE_COUNT,
});
