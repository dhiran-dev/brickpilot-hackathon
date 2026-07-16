import { buildingRequirementsSchema, squareMetresToMm2, type BuildingRequirements } from "@/lib/building/requirements";

export type BuildingFixture = {
  id: string;
  label: string;
  description: string;
  requirements: BuildingRequirements;
};

const BASE_SETBACKS = { north: 0, east: 0, south: 0, west: 0 };

function fixture(overrides: {
  id: string;
  label: string;
  description: string;
  projectName: string;
  widthMm: number;
  depthMm: number;
  rooms: BuildingRequirements["rooms"];
  relationships: BuildingRequirements["relationships"];
}): BuildingFixture {
  const raw: BuildingRequirements = {
    requirementSchemaVersion: 2,
    projectName: overrides.projectName,
    buildingType: "detached_house",
    region: { countryCode: "IN", adminArea: "Delhi", locality: "New Delhi", locale: "en-IN", currency: "INR" },
    displayUnit: "metric",
    site: {
      widthMm: overrides.widthMm,
      depthMm: overrides.depthMm,
      facing: "east",
      roadEdges: ["east"],
      irregular: false,
      setbacksMm: BASE_SETBACKS,
    },
    floors: [{ id: "F0", label: "Ground floor", level: 0, floorHeightMm: 3100 }],
    rooms: overrides.rooms,
    relationships: overrides.relationships,
    household: { occupants: 4, accessibilityRequired: false },
    vertical: { stairFamily: "dog_leg", stairWidthMm: 1000, liftProvision: false },
    budget: { qualityTier: "standard", contingencyPercent: 7.5, taxPercent: 0 },
    seed: 42,
  };
  return { id: overrides.id, label: overrides.label, description: overrides.description, requirements: buildingRequirementsSchema.parse(raw) };
}

function room(
  id: string,
  name: string,
  type: BuildingRequirements["rooms"][number]["type"],
  privacy: BuildingRequirements["rooms"][number]["privacy"],
  areaM2: { min: number; target: number },
  extra: Partial<BuildingRequirements["rooms"][number]> = {},
) {
  return {
    id,
    name,
    type,
    floorId: "F0",
    minAreaMm2: squareMetresToMm2(areaM2.min),
    targetAreaMm2: squareMetresToMm2(areaM2.target),
    privacy,
    preferredZone: "any" as const,
    mustBeExterior: false,
    accessible: false,
    ...extra,
  };
}

export const BUILDING_FIXTURES: BuildingFixture[] = [
  fixture({
    id: "compact-2bhk-20x30",
    label: "Compact 2BHK, 20×30 ft plot",
    description: "A tight two-bedroom home on a small east-facing plot.",
    projectName: "Compact 2BHK concept",
    widthMm: 6096,
    depthMm: 9144,
    rooms: [
      room("foyer", "Entry foyer", "foyer", "public", { min: 3, target: 4 }, { mustBeExterior: true, preferredZone: "east" }),
      room("living", "Living room", "living", "public", { min: 12, target: 16 }, { mustBeExterior: true }),
      room("kitchen", "Kitchen", "kitchen", "service", { min: 7, target: 9 }, { mustBeExterior: true }),
      room("circulation-f0", "Circulation", "circulation", "semi_private", { min: 3, target: 5 }),
      room("bedroom-f0-1", "Bedroom 1", "bedroom", "private", { min: 9, target: 11 }, { mustBeExterior: true }),
      room("bedroom-f0-2", "Bedroom 2", "bedroom", "private", { min: 9, target: 11 }, { mustBeExterior: true }),
      room("bathroom-f0-1", "Bathroom 1", "bathroom", "service", { min: 3, target: 3.6 }, { mustBeExterior: true }),
    ],
    relationships: [
      { type: "must_connect", fromRoomId: "foyer", toRoomId: "living" },
      { type: "prefer_near", fromRoomId: "bedroom-f0-1", toRoomId: "circulation-f0" },
      { type: "prefer_near", fromRoomId: "bedroom-f0-2", toRoomId: "circulation-f0" },
    ],
  }),
  fixture({
    id: "east-facing-3bhk-30x50",
    label: "East-facing 3BHK, 30×50 ft plot",
    description: "The headline demo configuration: a family 3BHK on an ordinary suburban plot.",
    projectName: "East-facing 3BHK concept",
    widthMm: 9144,
    depthMm: 15_240,
    rooms: [
      room("foyer", "Entry foyer", "foyer", "public", { min: 3, target: 5 }, { mustBeExterior: true, preferredZone: "east" }),
      room("living", "Living room", "living", "public", { min: 15, target: 22 }, { mustBeExterior: true }),
      room("dining", "Dining", "dining", "public", { min: 9, target: 13 }),
      room("kitchen", "Kitchen", "kitchen", "service", { min: 8, target: 12 }, { mustBeExterior: true }),
      room("circulation-f0", "Circulation", "circulation", "semi_private", { min: 4, target: 8 }),
      room("bedroom-f0-1", "Bedroom 1", "bedroom", "private", { min: 10, target: 14 }, { mustBeExterior: true }),
      room("bedroom-f0-2", "Bedroom 2", "bedroom", "private", { min: 10, target: 14 }, { mustBeExterior: true }),
      room("bedroom-f0-3", "Bedroom 3", "bedroom", "private", { min: 10, target: 14 }, { mustBeExterior: true }),
      room("bathroom-f0-1", "Attached bathroom 1", "bathroom", "service", { min: 3.2, target: 4.5 }, { mustBeExterior: true }),
      room("bathroom-f0-2", "Bathroom 2", "bathroom", "service", { min: 3.2, target: 4.5 }, { mustBeExterior: true }),
      room("utility", "Utility", "utility", "service", { min: 3.5, target: 5 }, { mustBeExterior: true }),
      room("pooja", "Pooja", "pooja", "private", { min: 2.5, target: 4 }, { preferredZone: "northeast" }),
      room("parking", "Covered parking", "parking", "service", { min: 14, target: 18 }, { mustBeExterior: true, preferredZone: "east" }),
    ],
    relationships: [
      { type: "must_connect", fromRoomId: "foyer", toRoomId: "living" },
      { type: "must_connect", fromRoomId: "living", toRoomId: "dining" },
      { type: "prefer_near", fromRoomId: "dining", toRoomId: "kitchen" },
      { type: "prefer_near", fromRoomId: "kitchen", toRoomId: "utility" },
      { type: "must_connect", fromRoomId: "bedroom-f0-1", toRoomId: "bathroom-f0-1" },
      { type: "prefer_near", fromRoomId: "bedroom-f0-2", toRoomId: "circulation-f0" },
      { type: "prefer_near", fromRoomId: "bedroom-f0-3", toRoomId: "circulation-f0" },
    ],
  }),
  fixture({
    id: "large-4bhk-40x60",
    label: "Large 4BHK, 40×60 ft plot",
    description: "A generously sized four-bedroom home on a large plot.",
    projectName: "Large 4BHK concept",
    widthMm: 12_192,
    depthMm: 18_288,
    rooms: [
      room("foyer", "Entry foyer", "foyer", "public", { min: 4, target: 6 }, { mustBeExterior: true, preferredZone: "east" }),
      room("living", "Living room", "living", "public", { min: 20, target: 28 }, { mustBeExterior: true }),
      room("dining", "Dining", "dining", "public", { min: 12, target: 16 }),
      room("kitchen", "Kitchen", "kitchen", "service", { min: 10, target: 14 }, { mustBeExterior: true }),
      room("circulation-f0", "Circulation", "circulation", "semi_private", { min: 6, target: 10 }),
      room("bedroom-f0-1", "Bedroom 1", "bedroom", "private", { min: 12, target: 16 }, { mustBeExterior: true }),
      room("bedroom-f0-2", "Bedroom 2", "bedroom", "private", { min: 11, target: 15 }, { mustBeExterior: true }),
      room("bedroom-f0-3", "Bedroom 3", "bedroom", "private", { min: 11, target: 15 }, { mustBeExterior: true }),
      room("bedroom-f0-4", "Bedroom 4", "bedroom", "private", { min: 10, target: 14 }, { mustBeExterior: true }),
      room("bathroom-f0-1", "Attached bathroom 1", "bathroom", "service", { min: 3.6, target: 5 }, { mustBeExterior: true }),
      room("bathroom-f0-2", "Attached bathroom 2", "bathroom", "service", { min: 3.2, target: 4.5 }, { mustBeExterior: true }),
      room("bathroom-f0-3", "Bathroom 3", "bathroom", "service", { min: 3.2, target: 4.5 }, { mustBeExterior: true }),
      room("study", "Study / office", "study", "private", { min: 7, target: 10 }, { mustBeExterior: true }),
      room("utility", "Utility", "utility", "service", { min: 4, target: 6 }, { mustBeExterior: true }),
      room("pooja", "Pooja", "pooja", "private", { min: 3, target: 4.5 }, { preferredZone: "northeast" }),
      room("parking", "Covered parking", "parking", "service", { min: 18, target: 24 }, { mustBeExterior: true, preferredZone: "east" }),
    ],
    relationships: [
      { type: "must_connect", fromRoomId: "foyer", toRoomId: "living" },
      { type: "must_connect", fromRoomId: "living", toRoomId: "dining" },
      { type: "prefer_near", fromRoomId: "dining", toRoomId: "kitchen" },
      { type: "prefer_near", fromRoomId: "kitchen", toRoomId: "utility" },
      { type: "must_connect", fromRoomId: "bedroom-f0-1", toRoomId: "bathroom-f0-1" },
      { type: "must_connect", fromRoomId: "bedroom-f0-2", toRoomId: "bathroom-f0-2" },
      { type: "prefer_near", fromRoomId: "bedroom-f0-3", toRoomId: "circulation-f0" },
      { type: "prefer_near", fromRoomId: "bedroom-f0-4", toRoomId: "circulation-f0" },
    ],
  }),
];
