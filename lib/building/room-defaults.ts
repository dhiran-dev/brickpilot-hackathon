import { squareMetresToMm2, type RoomType } from "@/lib/building/requirements";

export const ROOM_AREAS: Record<RoomType, { min: number; target: number }> = {
  living: { min: 15, target: 22 },
  dining: { min: 9, target: 13 },
  kitchen: { min: 8, target: 12 },
  bedroom: { min: 10, target: 14 },
  bathroom: { min: 3.2, target: 4.5 },
  pooja: { min: 2.5, target: 4 },
  utility: { min: 3.5, target: 5 },
  foyer: { min: 3, target: 5 },
  parking: { min: 14, target: 18 },
  study: { min: 7, target: 10 },
  balcony: { min: 4, target: 7 },
  circulation: { min: 4, target: 8 },
  stair: { min: 6, target: 9 },
  store: { min: 2, target: 3 },
  courtyard: { min: 8, target: 14 },
  terrace: { min: 8, target: 16 },
};

export function roomAreaDefaultsMm2(type: RoomType) {
  const values = ROOM_AREAS[type];
  return {
    minAreaMm2: squareMetresToMm2(values.min),
    targetAreaMm2: squareMetresToMm2(values.target),
  };
}
