import type { RoomType } from "@/lib/building/requirements";

/** Concept-stage clear-dimension baselines shared by generation and validation. */
export const MINIMUM_CLEAR_DIMENSION_MM: Readonly<Partial<Record<RoomType, number>>> = Object.freeze({
  bedroom: 2_700,
  living: 2_700,
  dining: 2_400,
  kitchen: 2_100,
  study: 2_100,
  parking: 2_400,
  bathroom: 1_200,
  utility: 1_200,
  foyer: 1_200,
  pooja: 1_200,
  store: 1_000,
});

export const DEFAULT_MINIMUM_CLEAR_DIMENSION_MM = 900;
export const ACCESSIBLE_MINIMUM_CLEAR_DIMENSION_MM = 1_200;
export const DEFAULT_MINIMUM_REMAINING_DIMENSION_MM = 2_100;

/** Sweep-derived production thresholds; calibrated by `villa-fixture-sweep-v1`. */
export const HABITABLE_MAX_ASPECT_RATIO = 1.8;
export const SERVICE_MAX_ASPECT_RATIO = 2.2;
export const MAX_CONSECUTIVE_PARALLEL_BANDS = 2;
export const PARALLEL_BAND_MIN_ENVELOPE_SPAN_RATIO = 0.6;
export const MAX_CIRCULATION_RATIO = 0.15;
export const SOFT_CIRCULATION_RATIO_TARGET = 0.1;
export const SMALL_PLATE_AREA_THRESHOLD_MM2 = 35_000_000;
export const SMALL_PLATE_MAX_CIRCULATION_RATIO = 0.22;
export const MAX_GALLERY_ENVELOPE_DEPTH_RATIO = 0.4;
export const MINIMUM_ACCESS_SHARED_WALL_MM = 1_000;

export function minimumClearDimensionMm(type: RoomType, accessible = false) {
  const typeMinimum = MINIMUM_CLEAR_DIMENSION_MM[type] ?? DEFAULT_MINIMUM_CLEAR_DIMENSION_MM;
  return Math.max(accessible ? ACCESSIBLE_MINIMUM_CLEAR_DIMENSION_MM : DEFAULT_MINIMUM_CLEAR_DIMENSION_MM, typeMinimum);
}

export function minimumRemainingDimensionMm(type: RoomType) {
  return MINIMUM_CLEAR_DIMENSION_MM[type] ?? DEFAULT_MINIMUM_REMAINING_DIMENSION_MM;
}
