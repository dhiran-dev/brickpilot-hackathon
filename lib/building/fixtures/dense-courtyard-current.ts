import {
  createCurrentRequirements,
  DEFAULT_INTAKE_DRAFT,
  type IntakeDraft,
} from "@/components/guided-intake/model";
import {
  currentBuildingRequirementsSchema,
  type CurrentBuildingRequirements,
} from "@/lib/building/requirements";

/**
 * Redacted, exact questionnaire reconstruction for the first universal-planner regression.
 *
 * The default 12 m x 18 m site and 1.2/1.5/2.5 m setbacks produce the reproduced
 * 9.6 m x 14 m buildable envelope. The saved project used a mixed roof; this fixture
 * intentionally records that persisted input instead of changing it to match a screenshot.
 */
export const DENSE_COURTYARD_CURRENT_DRAFT: IntakeDraft = {
  ...DEFAULT_INTAKE_DRAFT,
  projectName: "Dense courtyard regression",
  adminArea: "Tamil Nadu",
  locality: "Chennai",
  facing: "south",
  roadEdges: ["north", "east"],
  floorCount: 3,
  formStrategy: "courtyard",
  roofCharacter: "mixed",
  materialDirection: "monochrome",
  qualityTier: "premium",
  programs: [
    { bedrooms: 1, bathrooms: 2, attachedBathrooms: 1, studies: 1, balcony: false },
    { bedrooms: 2, bathrooms: 2, attachedBathrooms: 2, studies: 0, balcony: true },
    { bedrooms: 1, bathrooms: 1, attachedBathrooms: 1, studies: 1, balcony: true },
    { ...DEFAULT_INTAKE_DRAFT.programs[3] },
  ],
  includeCourtyard: true,
  includeVerandah: true,
  includeParking: true,
  seed: 4_227_593_031,
  shadeStructures: [
    {
      id: "front-entry-open-pergola",
      type: "open_pergola",
      location: "front_entry",
      source: "user",
    },
    {
      id: "parking-solid-canopy",
      type: "solid_canopy",
      location: "parking",
      source: "user",
    },
    {
      id: "verandah-solid-canopy",
      type: "solid_canopy",
      location: "verandah",
      source: "user",
    },
    {
      id: "terrace-open-pergola",
      type: "open_pergola",
      location: "terrace",
      source: "user",
    },
  ],
  aboveParkingUse: { value: "auto", source: "default" },
};

export const DENSE_COURTYARD_CURRENT_REQUIREMENTS: CurrentBuildingRequirements =
  currentBuildingRequirementsSchema.parse(
    createCurrentRequirements(DENSE_COURTYARD_CURRENT_DRAFT),
  );

export const DENSE_COURTYARD_CURRENT_EXPECTED_FACTS = {
  buildableWidthMm: 9_600,
  buildableDepthMm: 14_000,
  floorCount: 3,
  roadEdges: ["north", "east"],
  resolvedPrimaryEntrySide: "north",
  resolvedParkingSide: "north",
  roof: "mixed",
  seed: 4_227_593_031,
  parkingVehicleCount: 1,
  courtyard: "open_to_sky",
  aboveParkingUse: "auto",
  groundProgramRoomCountBeforeInferredStair: 14,
  groundRoomIdsBeforeInferredStair: [
    "bathroom-f0-1",
    "bathroom-f0-2",
    "bedroom-f0-1",
    "circulation-f0",
    "courtyard",
    "dining",
    "foyer",
    "kitchen",
    "living",
    "parking",
    "pooja",
    "study-f0-1",
    "utility",
    "verandah",
  ],
  groundAreaM2ByRoomId: {
    "bathroom-f0-1": { minimum: 3.2, target: 4.5 },
    "bathroom-f0-2": { minimum: 3.2, target: 4.5 },
    "bedroom-f0-1": { minimum: 10, target: 14 },
    "circulation-f0": { minimum: 4, target: 8 },
    courtyard: { minimum: 8, target: 14 },
    dining: { minimum: 9, target: 13 },
    foyer: { minimum: 3, target: 5 },
    kitchen: { minimum: 8, target: 12 },
    living: { minimum: 15, target: 22 },
    parking: { minimum: 14, target: 18 },
    pooja: { minimum: 2.5, target: 4 },
    "study-f0-1": { minimum: 7, target: 10 },
    utility: { minimum: 3.5, target: 5 },
    verandah: { minimum: 6, target: 12 },
  },
  requestedShadeLocations: ["front_entry", "parking", "terrace", "verandah"],
} as const;
