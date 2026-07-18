import {
  buildingRequirementsSchema,
  squareMetresToMm2,
  type BuildingRequirements,
  type RoomRequirement,
} from "@/lib/building/requirements";

type RoomOverrides = Partial<Omit<RoomRequirement, "id" | "name" | "type" | "floorId" | "minAreaMm2" | "targetAreaMm2">>;

function room(
  id: string,
  name: string,
  type: RoomRequirement["type"],
  floorId: RoomRequirement["floorId"],
  minimumM2: number,
  targetM2: number,
  overrides: RoomOverrides = {},
): RoomRequirement {
  return {
    id,
    name,
    type,
    floorId,
    minAreaMm2: squareMetresToMm2(minimumM2),
    targetAreaMm2: squareMetresToMm2(targetM2),
    privacy: "semi_private",
    preferredZone: "any",
    mustBeExterior: false,
    accessible: false,
    ...overrides,
  };
}

/**
 * Redacted reproduction of the questionnaire attached to the remediation report.
 *
 * The fixture intentionally retains the legacy v2 requirements contract. It records the
 * questionnaire input that produced the reported before-state; later workstreams must not
 * rewrite it to look like a successful v3 result.
 */
export const REFERENCE_ARTICULATED_SLOPED_REQUIREMENTS: BuildingRequirements = buildingRequirementsSchema.parse({
  requirementSchemaVersion: 2,
  projectName: "Redacted south-east road articulated villa",
  buildingType: "detached_house",
  region: {
    countryCode: "IN",
    adminArea: "Kerala",
    locality: "Redacted",
    locale: "en-IN",
    currency: "INR",
  },
  displayUnit: "metric",
  site: {
    widthMm: 20_000,
    depthMm: 18_000,
    facing: "north",
    roadEdges: ["south", "east"],
    irregular: false,
    setbacksMm: { north: 1_500, east: 1_200, south: 2_500, west: 1_200 },
  },
  floors: [
    { id: "F0", label: "Ground floor", level: 0, floorHeightMm: 3_100 },
    { id: "F1", label: "First floor", level: 1, floorHeightMm: 3_100 },
    { id: "F2", label: "Second floor", level: 2, floorHeightMm: 3_100 },
  ],
  rooms: [
    room("foyer", "Entry foyer", "foyer", "F0", 3, 5, {
      privacy: "public",
      preferredZone: "south",
    }),
    room("living", "Living / dining hall", "living", "F0", 24, 35, {
      privacy: "public",
      mustBeExterior: true,
    }),
    room("kitchen", "Kitchen", "kitchen", "F0", 8, 12, {
      privacy: "service",
      mustBeExterior: true,
    }),
    room("circulation-f0", "Circulation", "circulation", "F0", 4, 8),
    room("utility", "Utility", "utility", "F0", 3.5, 5, {
      privacy: "service",
      mustBeExterior: true,
    }),
    room("pooja", "Pooja", "pooja", "F0", 2.5, 4, {
      privacy: "private",
      preferredZone: "northeast",
    }),
    room("courtyard", "Courtyard", "courtyard", "F0", 8, 14, {
      preferredZone: "center",
      mustBeExterior: true,
    }),
    room("parking", "Covered parking", "parking", "F0", 14, 18, {
      privacy: "service",
      preferredZone: "south",
      mustBeExterior: true,
    }),
    room("bedroom-f0-1", "Bedroom 1", "bedroom", "F0", 10, 14, {
      privacy: "private",
      mustBeExterior: true,
    }),
    room("bathroom-f0-1", "Attached bathroom 1", "bathroom", "F0", 3.2, 4.5, {
      privacy: "service",
    }),

    room("circulation-f1", "Upper lobby", "circulation", "F1", 4, 8),
    room("family-lounge-f1", "Family lounge", "living", "F1", 15, 22, {
      privacy: "semi_private",
      preferredZone: "south",
      mustBeExterior: true,
    }),
    room("bedroom-f1-1", "L1 Bedroom 1", "bedroom", "F1", 10, 14, {
      privacy: "private",
      mustBeExterior: true,
    }),
    room("bedroom-f1-2", "L1 Bedroom 2", "bedroom", "F1", 10, 14, {
      privacy: "private",
      mustBeExterior: true,
    }),
    room("bedroom-f1-3", "L1 Bedroom 3", "bedroom", "F1", 10, 14, {
      privacy: "private",
      mustBeExterior: true,
    }),
    room("bathroom-f1-1", "L1 Attached bathroom 1", "bathroom", "F1", 3.2, 4.5, {
      privacy: "service",
    }),
    room("bathroom-f1-2", "L1 Bathroom 2", "bathroom", "F1", 3.2, 4.5, {
      privacy: "service",
    }),
    room("bathroom-f1-3", "L1 Bathroom 3", "bathroom", "F1", 3.2, 4.5, {
      privacy: "service",
    }),
    room("balcony-f1", "Shaded balcony / terrace edge", "balcony", "F1", 4, 7, {
      privacy: "semi_private",
      mustBeExterior: true,
    }),

    room("circulation-f2", "Upper lobby", "circulation", "F2", 4, 8),
    room("family-lounge-f2", "Sky family lounge", "living", "F2", 15, 22, {
      privacy: "semi_private",
      preferredZone: "south",
      mustBeExterior: true,
    }),
    room("bedroom-f2-1", "L2 Bedroom 1", "bedroom", "F2", 10, 14, {
      privacy: "private",
      mustBeExterior: true,
    }),
    room("bedroom-f2-2", "L2 Bedroom 2", "bedroom", "F2", 10, 14, {
      privacy: "private",
      mustBeExterior: true,
    }),
    room("bathroom-f2-1", "L2 Attached bathroom 1", "bathroom", "F2", 3.2, 4.5, {
      privacy: "service",
    }),
    room("bathroom-f2-2", "L2 Bathroom 2", "bathroom", "F2", 3.2, 4.5, {
      privacy: "service",
    }),
    room("study-f2-1", "Study / office", "study", "F2", 7, 10, {
      privacy: "private",
      mustBeExterior: true,
    }),
    room("balcony-f2", "Shaded balcony / terrace edge", "balcony", "F2", 4, 7, {
      privacy: "semi_private",
      mustBeExterior: true,
    }),
  ],
  relationships: [
    { type: "must_connect", fromRoomId: "foyer", toRoomId: "living" },
    { type: "prefer_near", fromRoomId: "living", toRoomId: "kitchen" },
    { type: "prefer_near", fromRoomId: "kitchen", toRoomId: "utility" },
    { type: "prefer_near", fromRoomId: "bedroom-f0-1", toRoomId: "circulation-f0" },
    { type: "must_connect", fromRoomId: "bedroom-f0-1", toRoomId: "bathroom-f0-1" },
    { type: "prefer_near", fromRoomId: "family-lounge-f1", toRoomId: "circulation-f1" },
    { type: "prefer_near", fromRoomId: "bedroom-f1-1", toRoomId: "circulation-f1" },
    { type: "prefer_near", fromRoomId: "bedroom-f1-2", toRoomId: "circulation-f1" },
    { type: "prefer_near", fromRoomId: "bedroom-f1-3", toRoomId: "circulation-f1" },
    { type: "must_connect", fromRoomId: "bedroom-f1-1", toRoomId: "bathroom-f1-1" },
    { type: "prefer_near", fromRoomId: "family-lounge-f2", toRoomId: "circulation-f2" },
    { type: "prefer_near", fromRoomId: "bedroom-f2-1", toRoomId: "circulation-f2" },
    { type: "prefer_near", fromRoomId: "bedroom-f2-2", toRoomId: "circulation-f2" },
    { type: "must_connect", fromRoomId: "bedroom-f2-1", toRoomId: "bathroom-f2-1" },
    { type: "stack_with", fromRoomId: "bathroom-f1-1", toRoomId: "bathroom-f0-1" },
    { type: "stack_with", fromRoomId: "bathroom-f2-1", toRoomId: "bathroom-f1-1" },
  ],
  household: { occupants: 6, accessibilityRequired: false },
  vertical: { stairFamily: "dog_leg", stairWidthMm: 1_000, liftProvision: false },
  architecture: {
    style: "courtyard_vernacular",
    formStrategy: "articulated_wings",
    roofCharacter: "sloped",
    materialDirection: "earthy_textured",
  },
  budget: { qualityTier: "premium", contingencyPercent: 7.5, taxPercent: 0 },
  seed: 42,
});

/** A deliberately tight brief: only the compact fallback is eligible in the current parti table. */
export const CONSTRAINED_SINGLE_PARTI_REQUIREMENTS: BuildingRequirements = buildingRequirementsSchema.parse({
  requirementSchemaVersion: 2,
  projectName: "Redacted constrained infill house",
  buildingType: "detached_house",
  region: {
    countryCode: "IN",
    adminArea: "Kerala",
    locality: "Redacted",
    locale: "en-IN",
    currency: "INR",
  },
  displayUnit: "metric",
  site: {
    widthMm: 6_096,
    depthMm: 9_144,
    facing: "east",
    roadEdges: ["east"],
    irregular: false,
    setbacksMm: { north: 0, east: 0, south: 0, west: 0 },
  },
  floors: [{ id: "F0", label: "Ground floor", level: 0, floorHeightMm: 3_100 }],
  rooms: [
    room("foyer-constrained", "Entry foyer", "foyer", "F0", 3, 4, {
      privacy: "public",
      preferredZone: "east",
      mustBeExterior: true,
      accessible: true,
    }),
    room("living-constrained", "Living / dining", "living", "F0", 12, 16, {
      privacy: "public",
      mustBeExterior: true,
      accessible: true,
    }),
    room("bedroom-constrained-1", "Bedroom 1", "bedroom", "F0", 9, 11, {
      privacy: "private",
      mustBeExterior: true,
    }),
    room("bedroom-constrained-2", "Bedroom 2", "bedroom", "F0", 9, 11, {
      privacy: "private",
      mustBeExterior: true,
    }),
    room("bathroom-constrained", "Bathroom", "bathroom", "F0", 3, 3.6, {
      privacy: "service",
      mustBeExterior: true,
    }),
    room("kitchen-constrained", "Kitchen", "kitchen", "F0", 7, 9, {
      privacy: "service",
      mustBeExterior: true,
    }),
    room("circulation-constrained", "Circulation", "circulation", "F0", 3, 5),
  ],
  relationships: [
    { type: "must_connect", fromRoomId: "foyer-constrained", toRoomId: "living-constrained" },
    { type: "prefer_near", fromRoomId: "living-constrained", toRoomId: "kitchen-constrained" },
    { type: "prefer_near", fromRoomId: "bedroom-constrained-1", toRoomId: "circulation-constrained" },
    { type: "prefer_near", fromRoomId: "bedroom-constrained-2", toRoomId: "circulation-constrained" },
  ],
  household: { occupants: 2, accessibilityRequired: false },
  vertical: { stairFamily: "straight", stairWidthMm: 900, liftProvision: false },
  architecture: {
    style: "warm_minimal",
    formStrategy: "articulated_wings",
    roofCharacter: "sloped",
    materialDirection: "warm_natural",
  },
  budget: { qualityTier: "standard", contingencyPercent: 7.5, taxPercent: 0 },
  seed: 731,
});

export type CourtyardTransitionFixture = {
  id: string;
  priorChoice: { value: "courtyard"; source: "user" | "inferred" };
  nextFormStrategy: "compact";
  expectedDisposition: "remove" | "report_incompatible";
  expectedRequirementPath: "architecture.courtyard";
};

/** Future v3 provenance cases. They are data-only until WS3 owns the sourced-choice schema. */
export const COURTYARD_TRANSITION_FIXTURES: readonly CourtyardTransitionFixture[] = [
  {
    id: "explicit-courtyard-survives-or-reports",
    priorChoice: { value: "courtyard", source: "user" },
    nextFormStrategy: "compact",
    expectedDisposition: "report_incompatible",
    expectedRequirementPath: "architecture.courtyard",
  },
  {
    id: "inferred-courtyard-is-removed",
    priorChoice: { value: "courtyard", source: "inferred" },
    nextFormStrategy: "compact",
    expectedDisposition: "remove",
    expectedRequirementPath: "architecture.courtyard",
  },
] as const;
