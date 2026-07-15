import { requirementDataSchema, type RequirementData } from "@/lib/layout-engine/schemas";

function fixture(input: unknown): RequirementData {
  return requirementDataSchema.parse(input);
}

export const layoutFixtures = {
  eastFacing3Bhk30x50: fixture({
    name: "30 × 50 east-facing 3BHK",
    plot: { widthFt: 30, depthFt: 50, facing: "east" },
    setbacks: { northFt: 2, eastFt: 2, southFt: 2, westFt: 2 },
    rooms: [
      { id: "living", name: "Living", type: "living", minAreaSqFt: 150, targetAreaSqFt: 190, preferredZone: "northeast" },
      { id: "dining", name: "Dining", type: "dining", minAreaSqFt: 80, targetAreaSqFt: 100, preferredZone: "center" },
      { id: "kitchen", name: "Kitchen", type: "kitchen", minAreaSqFt: 85, targetAreaSqFt: 110, preferredZone: "southeast" },
      { id: "bed-primary", name: "Primary Suite", type: "bedroom", minAreaSqFt: 125, targetAreaSqFt: 155, preferredZone: "southwest" },
      { id: "bed-2", name: "Bedroom 2", type: "bedroom", minAreaSqFt: 100, targetAreaSqFt: 125, preferredZone: "northwest" },
      { id: "bed-3", name: "Bedroom 3", type: "bedroom", minAreaSqFt: 100, targetAreaSqFt: 120, preferredZone: "west" },
      { id: "bath-primary", name: "Primary Bath", type: "bathroom", minAreaSqFt: 42, targetAreaSqFt: 50, preferredZone: "south" },
      { id: "bath-common", name: "Common Bath", type: "bathroom", minAreaSqFt: 38, targetAreaSqFt: 46, preferredZone: "southeast" },
      { id: "foyer", name: "Foyer", type: "foyer", minAreaSqFt: 32, targetAreaSqFt: 42, preferredZone: "east" },
      { id: "utility", name: "Utility", type: "utility", minAreaSqFt: 40, targetAreaSqFt: 55, preferredZone: "southeast" },
      { id: "pooja", name: "Pooja", type: "pooja", minAreaSqFt: 24, targetAreaSqFt: 32, preferredZone: "northeast" },
    ],
  }),
  fourBhk40x60: fixture({
    name: "40 × 60 4BHK",
    plot: { widthFt: 40, depthFt: 60, facing: "north" },
    setbacks: { northFt: 3, eastFt: 3, southFt: 3, westFt: 3 },
    rooms: [
      { id: "living", name: "Living", type: "living", minAreaSqFt: 210, targetAreaSqFt: 260, preferredZone: "north" },
      { id: "dining", name: "Dining", type: "dining", minAreaSqFt: 120, targetAreaSqFt: 150, preferredZone: "center" },
      { id: "kitchen", name: "Kitchen", type: "kitchen", minAreaSqFt: 110, targetAreaSqFt: 140, preferredZone: "southeast" },
      { id: "bed-primary", name: "Primary Suite", type: "bedroom", minAreaSqFt: 170, targetAreaSqFt: 210, preferredZone: "southwest" },
      { id: "bed-2", name: "Bedroom 2", type: "bedroom", minAreaSqFt: 130, targetAreaSqFt: 155, preferredZone: "northwest" },
      { id: "bed-3", name: "Bedroom 3", type: "bedroom", minAreaSqFt: 125, targetAreaSqFt: 150, preferredZone: "west" },
      { id: "bed-4", name: "Bedroom 4", type: "bedroom", minAreaSqFt: 125, targetAreaSqFt: 150, preferredZone: "east" },
      { id: "bath-primary", name: "Primary Bath", type: "bathroom", minAreaSqFt: 55, targetAreaSqFt: 68, preferredZone: "south" },
      { id: "bath-common", name: "Common Bath", type: "bathroom", minAreaSqFt: 45, targetAreaSqFt: 55, preferredZone: "southeast" },
      { id: "powder", name: "Powder Room", type: "bathroom", minAreaSqFt: 30, targetAreaSqFt: 38, preferredZone: "east" },
      { id: "foyer", name: "Foyer", type: "foyer", minAreaSqFt: 45, targetAreaSqFt: 60, preferredZone: "north" },
      { id: "utility", name: "Utility", type: "utility", minAreaSqFt: 55, targetAreaSqFt: 70, preferredZone: "southeast" },
      { id: "pooja", name: "Pooja", type: "pooja", minAreaSqFt: 30, targetAreaSqFt: 40, preferredZone: "northeast" },
      { id: "study", name: "Study", type: "study", minAreaSqFt: 75, targetAreaSqFt: 95, preferredZone: "northwest" },
    ],
  }),
  compact2Bhk20x30: fixture({
    name: "20 × 30 compact 2BHK",
    plot: { widthFt: 20, depthFt: 30, facing: "west" },
    setbacks: { northFt: 1.5, eastFt: 1.5, southFt: 1.5, westFt: 1.5 },
    rooms: [
      { id: "living", name: "Living", type: "living", minAreaSqFt: 72, targetAreaSqFt: 90, preferredZone: "west" },
      { id: "dining", name: "Dining", type: "dining", minAreaSqFt: 32, targetAreaSqFt: 42, preferredZone: "center" },
      { id: "kitchen", name: "Kitchen", type: "kitchen", minAreaSqFt: 46, targetAreaSqFt: 58, preferredZone: "southeast" },
      { id: "bed-primary", name: "Primary Bed", type: "bedroom", minAreaSqFt: 68, targetAreaSqFt: 84, preferredZone: "southwest" },
      { id: "bed-2", name: "Bedroom 2", type: "bedroom", minAreaSqFt: 62, targetAreaSqFt: 76, preferredZone: "northwest" },
      { id: "bath-primary", name: "Primary Bath", type: "bathroom", minAreaSqFt: 24, targetAreaSqFt: 30, preferredZone: "south" },
      { id: "bath-common", name: "Common Bath", type: "bathroom", minAreaSqFt: 22, targetAreaSqFt: 27, preferredZone: "southeast" },
      { id: "foyer", name: "Foyer", type: "foyer", minAreaSqFt: 14, targetAreaSqFt: 18, preferredZone: "west" },
      { id: "utility", name: "Utility", type: "utility", minAreaSqFt: 14, targetAreaSqFt: 18, preferredZone: "southeast" },
    ],
  }),
} as const;

export type LayoutFixtureName = keyof typeof layoutFixtures;
