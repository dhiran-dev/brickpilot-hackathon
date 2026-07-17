import type { RoomType } from "@/lib/building/requirements";
import type { Space } from "@/lib/building/schema";

/**
 * Verandahs are roofed exterior circulation, not interior rooms and not sky voids.
 *
 * These semantics are derived from the persisted room type so schema-v2 buildings do not need
 * new stored flags and older saved buildings remain readable.
 */
export const VERANDAH_SEMANTICS = Object.freeze({
  covered: true,
  occupied: false,
  openToSky: false,
  perimeterOpen: true,
  pedestrian: true,
  circulationBackbone: true,
  costQuantityFactor: 0.5,
} as const);

export function isVerandahType(type: RoomType) {
  return type === "verandah";
}

export function isVerandahSpace(space: Pick<Space, "type"> | undefined) {
  return Boolean(space && isVerandahType(space.type));
}

export function isPerimeterOpenVerandah(
  space: Pick<Space, "type" | "perimeterOpen"> | undefined,
) {
  return Boolean(
    space
    && isVerandahSpace(space)
    && (space.perimeterOpen ?? VERANDAH_SEMANTICS.perimeterOpen),
  );
}

export function isCoveredSpace(space: Pick<Space, "type"> | undefined) {
  if (!space) return false;
  if (isVerandahSpace(space)) return VERANDAH_SEMANTICS.covered;
  return space.type !== "courtyard" && space.type !== "terrace";
}

export function defaultRoomOccupancy(type: RoomType) {
  if (isVerandahType(type)) return VERANDAH_SEMANTICS.occupied;
  return !["balcony", "courtyard", "parking", "terrace"].includes(type);
}

export function costQuantityFactor(type: RoomType) {
  if (isVerandahType(type)) return VERANDAH_SEMANTICS.costQuantityFactor;
  if (type === "terrace" || type === "courtyard") return 0;
  return 1;
}
