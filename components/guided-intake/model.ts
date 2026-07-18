import {
  buildingRequirementsSchema,
  currentBuildingRequirementsSchema,
  MAX_REQUIREMENT_ROOMS,
  squareMetresToMm2,
  type BuildingRequirements,
  type CurrentBuildingRequirements,
  type EntryRequirements,
  type ReadableBuildingRequirements,
  type ShadeStructureRequirement,
  type RoomType,
} from "@/lib/building/requirements";
import { roomAreaDefaultsMm2 } from "@/lib/building/room-defaults";
import { regionalIntakePrefill } from "@/lib/design/regional-packs";

export type FloorProgram = { bedrooms: number; bathrooms: number; attachedBathrooms: number; studies: number; balcony: boolean };

// These per-floor caps still allow a very large G+3 villa (up to 24 bedrooms),
// while ensuring every combination of optional rooms remains inside the canonical
// 80-room requirements contract.
export const MAX_BEDROOMS_PER_FLOOR = 6;
export const MAX_BATHROOMS_PER_FLOOR = 6;
export const MAX_STUDIES_PER_FLOOR = 2;

export type IntakeDraft = {
  projectName: string;
  buildingType: "detached_house";
  countryCode: string;
  adminArea: string;
  locality: string;
  locale: string;
  currency: string;
  displayUnit: "metric" | "imperial";
  siteWidth: number;
  siteDepth: number;
  facing: "north" | "east" | "south" | "west";
  roadEdges: Array<"north" | "east" | "south" | "west">;
  setbacks: { north: number; east: number; south: number; west: number };
  floorCount: number;
  floorHeightM: number;
  stairFamily: "straight" | "dog_leg";
  stairWidthMm: number;
  liftProvision: boolean;
  occupants: number;
  accessibilityRequired: boolean;
  socialSpaceMode: "separate" | "combined";
  architecturalStyle: "contemporary_tropical" | "warm_minimal" | "kerala_contemporary" | "modernist" | "courtyard_vernacular";
  formStrategy: "compact" | "stepped_terraces" | "courtyard" | "articulated_wings";
  roofCharacter: "flat_parapet" | "sloped" | "mixed";
  materialDirection: "warm_natural" | "light_mineral" | "earthy_textured" | "monochrome";
  programs: FloorProgram[];
  includeUtility: boolean;
  includePooja: boolean;
  includeCourtyard: boolean;
  includeParking: boolean;
  includeVerandah: boolean;
  currentEntry: EntryRequirements;
  shadeStructures: ShadeStructureRequirement[];
  aboveParkingUse: CurrentBuildingRequirements["aboveParkingUse"];
  maxExteriorPedestrianEntryCount: number;
  qualityTier: "essential" | "standard" | "premium";
  budgetLowMajor: number;
  budgetHighMajor: number;
  contingencyPercent: number;
  taxPercent: number;
  seed: number;
};

export const DEFAULT_INTAKE_DRAFT: IntakeDraft = {
  projectName: "My family home",
  buildingType: "detached_house",
  countryCode: "IN",
  adminArea: "Kerala",
  locality: "Kochi",
  locale: "en-IN",
  currency: "INR",
  displayUnit: "metric",
  siteWidth: 12,
  siteDepth: 18,
  facing: "south",
  roadEdges: ["south"],
  setbacks: { north: 1.5, east: 1.2, south: 2.5, west: 1.2 },
  floorCount: 1,
  floorHeightM: 3.1,
  stairFamily: "dog_leg",
  stairWidthMm: 1000,
  liftProvision: false,
  occupants: 5,
  accessibilityRequired: false,
  socialSpaceMode: "separate",
  architecturalStyle: "contemporary_tropical",
  formStrategy: "articulated_wings",
  roofCharacter: "mixed",
  materialDirection: "warm_natural",
  programs: [
    { bedrooms: 1, bathrooms: 1, attachedBathrooms: 1, studies: 0, balcony: false },
    { bedrooms: 3, bathrooms: 3, attachedBathrooms: 1, studies: 0, balcony: true },
    { bedrooms: 2, bathrooms: 2, attachedBathrooms: 1, studies: 1, balcony: true },
    { bedrooms: 1, bathrooms: 1, attachedBathrooms: 1, studies: 0, balcony: true },
  ],
  includeUtility: true,
  includePooja: true,
  includeCourtyard: false,
  includeParking: true,
  includeVerandah: false,
  currentEntry: {
    primarySide: { value: "auto_road_side", source: "inferred" },
    secondaryEntry: { value: "auto", source: "default" },
    primaryDoorClearWidthMm: 1200,
  },
  shadeStructures: [],
  aboveParkingUse: { value: "auto", source: "default" },
  maxExteriorPedestrianEntryCount: 2,
  qualityTier: "standard",
  budgetLowMajor: 5_500_000,
  budgetHighMajor: 7_500_000,
  contingencyPercent: 7.5,
  taxPercent: 0,
  seed: 42,
};

/** Applies suggestions only; every returned field remains an ordinary editable intake choice. */
export function applyRegionalPrefill(draft: IntakeDraft, countryCode = draft.countryCode, adminArea = draft.adminArea): IntakeDraft {
  return { ...draft, ...regionalIntakePrefill(countryCode, adminArea) };
}

const ZERO_DECIMAL_CURRENCIES = new Set(["BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);

function minorFactor(currency: string) {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 1 : 100;
}

function inputUnitToMm(value: number, unit: IntakeDraft["displayUnit"]) {
  return Math.round(value * (unit === "metric" ? 1000 : 304.8));
}

export function normalizeFloorProgram(program: Partial<FloorProgram> | undefined, fallback: FloorProgram): FloorProgram {
  const bedrooms = Math.max(0, Math.min(MAX_BEDROOMS_PER_FLOOR, Math.round(program?.bedrooms ?? fallback.bedrooms)));
  const bathrooms = Math.max(0, Math.min(MAX_BATHROOMS_PER_FLOOR, Math.round(program?.bathrooms ?? fallback.bathrooms)));
  const attachedBathrooms = Math.max(0, Math.min(
    bedrooms,
    bathrooms,
    Math.round(program?.attachedBathrooms ?? 0),
  ));
  return {
    bedrooms,
    bathrooms,
    attachedBathrooms,
    studies: Math.max(0, Math.min(MAX_STUDIES_PER_FLOOR, Math.round(program?.studies ?? fallback.studies))),
    balcony: program?.balcony ?? fallback.balcony,
  };
}

export function upgradeLegacyFloorProgram(program: Partial<FloorProgram> | undefined, fallback: FloorProgram): FloorProgram {
  const normalized = normalizeFloorProgram(program, fallback);
  return {
    ...normalized,
    attachedBathrooms: Math.min(1, normalized.bedrooms, normalized.bathrooms),
  };
}

export type FloorProgramBrief = {
  attachedBedrooms: number;
  bedroomsWithoutAttachedBathroom: number;
  sharedBathrooms: number;
};

export function floorProgramBrief(program: FloorProgram): FloorProgramBrief {
  const normalized = normalizeFloorProgram(program, program);
  return {
    attachedBedrooms: normalized.attachedBathrooms,
    bedroomsWithoutAttachedBathroom: normalized.bedrooms - normalized.attachedBathrooms,
    sharedBathrooms: normalized.bathrooms - normalized.attachedBathrooms,
  };
}

export function updateFloorProgramBrief(program: FloorProgram, next: Partial<FloorProgramBrief>): FloorProgram {
  const current = floorProgramBrief(program);
  const attachedBedrooms = Math.max(0, Math.min(
    MAX_BEDROOMS_PER_FLOOR,
    MAX_BATHROOMS_PER_FLOOR,
    Math.round(next.attachedBedrooms ?? current.attachedBedrooms),
  ));
  const bedroomsWithoutAttachedBathroom = Math.max(0, Math.min(
    MAX_BEDROOMS_PER_FLOOR - attachedBedrooms,
    Math.round(next.bedroomsWithoutAttachedBathroom ?? current.bedroomsWithoutAttachedBathroom),
  ));
  const sharedBathrooms = Math.max(0, Math.min(
    MAX_BATHROOMS_PER_FLOOR - attachedBedrooms,
    Math.round(next.sharedBathrooms ?? current.sharedBathrooms),
  ));
  return normalizeFloorProgram({
    ...program,
    bedrooms: attachedBedrooms + bedroomsWithoutAttachedBathroom,
    bathrooms: attachedBedrooms + sharedBathrooms,
    attachedBathrooms: attachedBedrooms,
  }, program);
}

export function createRequirements(draft: IntakeDraft): BuildingRequirements {
  const rooms: BuildingRequirements["rooms"] = [];
  const relationships: BuildingRequirements["relationships"] = [];
  const firstBathroomByFloor: string[] = [];
  let accessibleBedroomAssigned = false;
  let accessibleBathroomAssigned = false;

  function addRoom(room: { id: string; name: string; type: RoomType; floorId: string; privacy: "public" | "semi_private" | "private" | "service"; preferredZone?: BuildingRequirements["rooms"][number]["preferredZone"]; mustBeExterior?: boolean; accessible?: boolean }) {
    rooms.push({ ...room, ...roomAreaDefaultsMm2(room.type), preferredZone: room.preferredZone ?? "any", mustBeExterior: room.mustBeExterior ?? false, accessible: room.accessible ?? false });
  }

  const primaryRoadEdge = draft.roadEdges.includes(draft.facing) ? draft.facing : draft.roadEdges[0] ?? draft.facing;
  const socialSpaceMode = draft.socialSpaceMode ?? "separate";
  addRoom({ id: "foyer", name: "Entry foyer", type: "foyer", floorId: "F0", privacy: "public", preferredZone: primaryRoadEdge });
  if (socialSpaceMode === "combined") {
    rooms.push({
      id: "living",
      name: "Living / dining hall",
      type: "living",
      floorId: "F0",
      minAreaMm2: squareMetresToMm2(24),
      targetAreaMm2: squareMetresToMm2(35),
      privacy: "public",
      preferredZone: "any",
      mustBeExterior: true,
      accessible: false,
    });
  } else {
    addRoom({ id: "living", name: "Living room", type: "living", floorId: "F0", privacy: "public", mustBeExterior: true });
    addRoom({ id: "dining", name: "Dining", type: "dining", floorId: "F0", privacy: "public" });
  }
  addRoom({ id: "kitchen", name: "Kitchen", type: "kitchen", floorId: "F0", privacy: "service", mustBeExterior: true });
  addRoom({ id: "circulation-f0", name: "Circulation", type: "circulation", floorId: "F0", privacy: "semi_private", accessible: draft.accessibilityRequired });
  if (draft.includeUtility) addRoom({ id: "utility", name: "Utility", type: "utility", floorId: "F0", privacy: "service", mustBeExterior: true });
  if (draft.includePooja) addRoom({ id: "pooja", name: "Pooja", type: "pooja", floorId: "F0", privacy: "private", preferredZone: "northeast" });
  const includeCourtyard = draft.includeCourtyard || draft.formStrategy === "courtyard";
  if (includeCourtyard) addRoom({ id: "courtyard", name: "Courtyard", type: "courtyard", floorId: "F0", privacy: "semi_private", mustBeExterior: true, preferredZone: "center" });
  if (draft.includeParking) addRoom({ id: "parking", name: "Covered parking", type: "parking", floorId: "F0", privacy: "service", preferredZone: primaryRoadEdge, mustBeExterior: true });
  if (draft.includeVerandah) addRoom({ id: "verandah", name: "Covered verandah", type: "verandah", floorId: "F0", privacy: "semi_private", preferredZone: primaryRoadEdge, mustBeExterior: true });
  relationships.push({ type: "must_connect", fromRoomId: "foyer", toRoomId: "living" });
  if (socialSpaceMode === "combined") {
    relationships.push({ type: "prefer_near", fromRoomId: "living", toRoomId: "kitchen" });
  } else {
    relationships.push(
      { type: "must_connect", fromRoomId: "living", toRoomId: "dining" },
      { type: "prefer_near", fromRoomId: "dining", toRoomId: "kitchen" },
    );
  }
  if (draft.includeUtility) relationships.push({ type: "prefer_near", fromRoomId: "kitchen", toRoomId: "utility" });

  for (let level = 0; level < draft.floorCount; level += 1) {
    const floorId = `F${level}`;
    const program = normalizeFloorProgram(draft.programs[level], DEFAULT_INTAKE_DRAFT.programs[level]);
    if (draft.floorCount > 1 && level > 0) addRoom({ id: `circulation-f${level}`, name: "Upper lobby", type: "circulation", floorId, privacy: "semi_private" });
    const isVillaFamilyLevel = level > 0 && (level === 1 || level === draft.floorCount - 1);
    if (isVillaFamilyLevel) {
      const familyLoungeId = `family-lounge-f${level}`;
      addRoom({
        id: familyLoungeId,
        name: level === draft.floorCount - 1 && level > 1 ? "Sky family lounge" : "Family lounge",
        type: "living",
        floorId,
        privacy: "semi_private",
        preferredZone: primaryRoadEdge,
        mustBeExterior: true,
      });
      relationships.push({ type: "prefer_near", fromRoomId: familyLoungeId, toRoomId: `circulation-f${level}` });
    }
    for (let index = 0; index < program.bedrooms; index += 1) {
      const id = `bedroom-f${level}-${index + 1}`;
      const isAccessible: boolean = draft.accessibilityRequired && level === 0 && !accessibleBedroomAssigned;
      accessibleBedroomAssigned = accessibleBedroomAssigned || isAccessible;
      addRoom({ id, name: `${level === 0 ? "" : `L${level} `}Bedroom ${index + 1}`.trim(), type: "bedroom", floorId, privacy: "private", mustBeExterior: true, accessible: isAccessible });
      relationships.push({ type: "prefer_near", fromRoomId: id, toRoomId: `circulation-f${level}` });
    }
    for (let index = 0; index < program.bathrooms; index += 1) {
      const id = `bathroom-f${level}-${index + 1}`;
      const attachedBedroomId = index < program.attachedBathrooms ? `bedroom-f${level}-${index + 1}` : undefined;
      const isAccessible: boolean = draft.accessibilityRequired && level === 0 && !accessibleBathroomAssigned;
      accessibleBathroomAssigned = accessibleBathroomAssigned || isAccessible;
      addRoom({ id, name: attachedBedroomId ? `${level === 0 ? "" : `L${level} `}Attached bathroom ${index + 1}`.trim() : `${level === 0 ? "" : `L${level} `}Bathroom ${index + 1}`.trim(), type: "bathroom", floorId, privacy: "service", accessible: isAccessible });
      if (attachedBedroomId) relationships.push({ type: "must_connect", fromRoomId: attachedBedroomId, toRoomId: id });
      if (index === 0) firstBathroomByFloor.push(id);
    }
    for (let index = 0; index < program.studies; index += 1) addRoom({ id: `study-f${level}-${index + 1}`, name: index ? `Study ${index + 1}` : "Study / office", type: "study", floorId, privacy: "private", mustBeExterior: true });
    if (level > 0 && program.balcony) addRoom({ id: `balcony-f${level}`, name: "Balcony", type: "balcony", floorId, privacy: "semi_private", mustBeExterior: true });
  }

  for (let index = 1; index < firstBathroomByFloor.length; index += 1) relationships.push({ type: "stack_with", fromRoomId: firstBathroomByFloor[index], toRoomId: firstBathroomByFloor[index - 1] });

  const factor = minorFactor(draft.currency);
  const raw: BuildingRequirements = {
    requirementSchemaVersion: 2,
    projectName: draft.projectName.trim(),
    buildingType: "detached_house",
    region: { countryCode: draft.countryCode.toUpperCase(), adminArea: draft.adminArea.trim(), locality: draft.locality.trim() || undefined, locale: draft.locale.trim(), currency: draft.currency.toUpperCase() },
    displayUnit: draft.displayUnit,
    site: {
      widthMm: inputUnitToMm(draft.siteWidth, draft.displayUnit),
      depthMm: inputUnitToMm(draft.siteDepth, draft.displayUnit),
      facing: draft.facing,
      roadEdges: draft.roadEdges,
      irregular: false,
      setbacksMm: {
        north: inputUnitToMm(draft.setbacks.north, draft.displayUnit),
        east: inputUnitToMm(draft.setbacks.east, draft.displayUnit),
        south: inputUnitToMm(draft.setbacks.south, draft.displayUnit),
        west: inputUnitToMm(draft.setbacks.west, draft.displayUnit),
      },
    },
    floors: Array.from({ length: draft.floorCount }, (_, level) => ({ id: `F${level}`, label: level === 0 ? "Ground floor" : `Floor ${level}`, level, floorHeightMm: Math.round(draft.floorHeightM * 1000) })),
    rooms,
    relationships,
    household: { occupants: draft.occupants, accessibilityRequired: draft.accessibilityRequired },
    vertical: { stairFamily: draft.stairFamily, stairWidthMm: draft.stairWidthMm, liftProvision: draft.liftProvision },
    architecture: {
      style: draft.architecturalStyle ?? DEFAULT_INTAKE_DRAFT.architecturalStyle,
      formStrategy: draft.formStrategy ?? DEFAULT_INTAKE_DRAFT.formStrategy,
      roofCharacter: draft.roofCharacter ?? DEFAULT_INTAKE_DRAFT.roofCharacter,
      materialDirection: draft.materialDirection ?? DEFAULT_INTAKE_DRAFT.materialDirection,
    },
    budget: {
      qualityTier: draft.qualityTier,
      targetLowMinor: draft.budgetLowMajor > 0 ? Math.round(draft.budgetLowMajor * factor) : undefined,
      targetHighMinor: draft.budgetHighMajor > 0 ? Math.round(draft.budgetHighMajor * factor) : undefined,
      contingencyPercent: draft.contingencyPercent,
      taxPercent: draft.taxPercent,
    },
    seed: draft.seed,
  };
  // This assertion documents the invariant guaranteed by the per-floor UI/model caps.
  // Keep it close to construction so future optional-room additions cannot silently
  // push a valid questionnaire beyond the public requirements contract.
  if (rooms.length > MAX_REQUIREMENT_ROOMS) {
    throw new Error(`Room programme cannot exceed ${MAX_REQUIREMENT_ROOMS} rooms.`);
  }
  return buildingRequirementsSchema.parse(raw);
}

export type CurrentRequirementIntent = {
  entry?: EntryRequirements;
  shadeStructures?: ShadeStructureRequirement[];
  aboveParkingUse?: CurrentBuildingRequirements["aboveParkingUse"];
  maxExteriorPedestrianEntryCount?: number;
};

/** Pure state transition used by the architecture-step shade selector and its interaction tests. */
export function applyShadeStructureChoice(
  draft: IntakeDraft,
  location: ShadeStructureRequirement["location"],
  type: ShadeStructureRequirement["type"] | "none",
): IntakeDraft {
  const shadeStructures = draft.shadeStructures.filter((shade) => shade.location !== location);
  if (type !== "none") shadeStructures.push({
    id: `${location.replaceAll("_", "-")}-${type.replaceAll("_", "-")}`,
    location,
    type,
    source: "user",
  });
  return { ...draft, shadeStructures };
}

/**
 * Additive v3 intake adapter. The existing createRequirements path remains the frozen v2 contract
 * until lifecycle rollout selects v3 explicitly.
 */
export function createCurrentRequirements(
  draft: IntakeDraft,
  intent: CurrentRequirementIntent = {},
): CurrentBuildingRequirements {
  const legacy = createRequirements(draft);
  const primaryRoadSide = draft.roadEdges.includes(draft.facing) ? draft.facing : draft.roadEdges[0];
  const parkingRoom = legacy.rooms.find((room) => room.type === "parking");
  const outdoorAreas = legacy.rooms
    .filter((room) => room.type === "balcony" || room.type === "verandah")
    .map((room) => ({
      id: `outdoor-${room.id}`,
      floorId: room.floorId,
      type: room.type as "balcony" | "verandah",
      targetAreaMm2: room.targetAreaMm2,
      minimumAreaMm2: room.minAreaMm2,
      maximumAreaMm2: Math.max(room.targetAreaMm2 * 2, room.minAreaMm2),
      source: "user" as const,
    }));
  const current = {
    ...legacy,
    requirementSchemaVersion: 3 as const,
    entry: intent.entry ?? (draft.currentEntry.primarySide.source === "inferred"
      ? { ...draft.currentEntry, primarySide: { value: primaryRoadSide ?? "auto_road_side", source: "inferred" as const } }
      : draft.currentEntry),
    parking: {
      vehicleCount: parkingRoom ? 1 : 0,
      targetAreaMm2: parkingRoom?.targetAreaMm2,
      minimumAreaMm2: parkingRoom?.minAreaMm2,
      maximumAreaMm2: parkingRoom ? Math.round(parkingRoom.targetAreaMm2 * 1.5) : undefined,
      preferredSide: { value: primaryRoadSide ?? "auto_road_side", source: "inferred" as const },
    },
    outdoorAreas,
    courtyard: {
      value: draft.includeCourtyard || draft.formStrategy === "courtyard" ? "open_to_sky" as const : "none" as const,
      source: draft.includeCourtyard ? "user" as const : draft.formStrategy === "courtyard" ? "inferred" as const : "default" as const,
    },
    roof: { value: draft.roofCharacter, source: "user" as const },
    shadeStructures: intent.shadeStructures ?? draft.shadeStructures,
    aboveParkingUse: intent.aboveParkingUse ?? draft.aboveParkingUse,
    maxExteriorPedestrianEntryCount: intent.maxExteriorPedestrianEntryCount ?? draft.maxExteriorPedestrianEntryCount,
  };
  return currentBuildingRequirementsSchema.parse(current);
}

export function draftFromRequirements(value: ReadableBuildingRequirements): IntakeDraft {
  const unitFactor = value.displayUnit === "metric" ? 1000 : 304.8;
  const programs = DEFAULT_INTAKE_DRAFT.programs.map((program, level) => {
    const floorId = `F${level}`;
    const floorRooms = value.rooms.filter((room) => room.floorId === floorId);
    const bedroomIds = new Set(floorRooms.filter((room) => room.type === "bedroom").map((room) => room.id));
    const bathroomIds = new Set(floorRooms.filter((room) => room.type === "bathroom").map((room) => room.id));
    const attachedBathroomIds = new Set(value.relationships.flatMap((relationship) => {
      if (relationship.type !== "must_connect") return [];
      if (bedroomIds.has(relationship.fromRoomId) && bathroomIds.has(relationship.toRoomId)) return [relationship.toRoomId];
      if (bedroomIds.has(relationship.toRoomId) && bathroomIds.has(relationship.fromRoomId)) return [relationship.fromRoomId];
      return [];
    }));
    return {
      bedrooms: bedroomIds.size,
      bathrooms: bathroomIds.size,
      attachedBathrooms: attachedBathroomIds.size,
      studies: floorRooms.filter((room) => room.type === "study").length,
      balcony: floorRooms.some((room) => room.type === "balcony"),
    };
  });
  const factor = minorFactor(value.region.currency);
  return {
    ...DEFAULT_INTAKE_DRAFT,
    projectName: value.projectName,
    countryCode: value.region.countryCode,
    adminArea: value.region.adminArea,
    locality: value.region.locality ?? "",
    locale: value.region.locale,
    currency: value.region.currency,
    displayUnit: value.displayUnit,
    siteWidth: Number((value.site.widthMm / unitFactor).toFixed(2)),
    siteDepth: Number((value.site.depthMm / unitFactor).toFixed(2)),
    facing: value.site.facing,
    roadEdges: value.site.roadEdges,
    setbacks: Object.fromEntries(Object.entries(value.site.setbacksMm).map(([key, mm]) => [key, Number((mm / unitFactor).toFixed(2))])) as IntakeDraft["setbacks"],
    floorCount: value.floors.length,
    floorHeightM: value.floors[0].floorHeightMm / 1000,
    stairFamily: value.vertical.stairFamily,
    stairWidthMm: value.vertical.stairWidthMm,
    liftProvision: value.vertical.liftProvision,
    occupants: value.household.occupants,
    accessibilityRequired: value.household.accessibilityRequired,
    socialSpaceMode: value.rooms.some((room) => room.type === "dining") ? "separate" : "combined",
    architecturalStyle: value.architecture.style,
    formStrategy: value.architecture.formStrategy,
    roofCharacter: value.architecture.roofCharacter,
    materialDirection: value.architecture.materialDirection,
    programs,
    includeUtility: value.rooms.some((room) => room.type === "utility"),
    includePooja: value.rooms.some((room) => room.type === "pooja"),
    includeCourtyard: value.rooms.some((room) => room.type === "courtyard"),
    includeParking: value.rooms.some((room) => room.type === "parking"),
    includeVerandah: value.rooms.some((room) => room.type === "verandah"),
    currentEntry: value.requirementSchemaVersion === 3 ? value.entry : DEFAULT_INTAKE_DRAFT.currentEntry,
    shadeStructures: value.requirementSchemaVersion === 3 ? value.shadeStructures : DEFAULT_INTAKE_DRAFT.shadeStructures,
    aboveParkingUse: value.requirementSchemaVersion === 3 ? value.aboveParkingUse : DEFAULT_INTAKE_DRAFT.aboveParkingUse,
    maxExteriorPedestrianEntryCount: value.requirementSchemaVersion === 3 ? value.maxExteriorPedestrianEntryCount : DEFAULT_INTAKE_DRAFT.maxExteriorPedestrianEntryCount,
    qualityTier: value.budget.qualityTier,
    budgetLowMajor: value.budget.targetLowMinor ? value.budget.targetLowMinor / factor : 0,
    budgetHighMajor: value.budget.targetHighMinor ? value.budget.targetHighMinor / factor : 0,
    contingencyPercent: value.budget.contingencyPercent,
    taxPercent: value.budget.taxPercent,
    seed: value.seed,
  };
}

export type FloorCapacityAssessment = {
  floorId: string;
  label: string;
  minimumRoomAreaMm2: number;
  usableAreaMm2: number;
  utilization: number;
  status: "comfortable" | "tight" | "over_capacity";
};

export type BriefCapacityAssessment = {
  blocking: boolean;
  floors: FloorCapacityAssessment[];
  actions: string[];
};

function reservedStairCoreArea(requirements: BuildingRequirements) {
  if (requirements.floors.length <= 1) return 0;
  const clearWidth = requirements.vertical.stairWidthMm;
  const dogLeg = requirements.vertical.stairFamily === "dog_leg";
  const width = dogLeg ? clearWidth * 2 + 230 : clearWidth + 230;
  const depth = dogLeg ? Math.max(3200, clearWidth * 3) : Math.max(4200, clearWidth * 4);
  return width * depth;
}

export function assessBriefCapacity(requirements: BuildingRequirements): BriefCapacityAssessment {
  const buildableWidth = requirements.site.widthMm - requirements.site.setbacksMm.east - requirements.site.setbacksMm.west;
  const buildableDepth = requirements.site.depthMm - requirements.site.setbacksMm.north - requirements.site.setbacksMm.south;
  const buildableArea = Math.max(0, buildableWidth) * Math.max(0, buildableDepth);
  const usableArea = Math.max(0, buildableArea - reservedStairCoreArea(requirements));
  const floors = requirements.floors.map((floor) => {
    const minimumRoomAreaMm2 = requirements.rooms.filter((room) => room.floorId === floor.id).reduce((sum, room) => sum + room.minAreaMm2, 0);
    const utilization = usableArea > 0 ? minimumRoomAreaMm2 / usableArea : Number.POSITIVE_INFINITY;
    return {
      floorId: floor.id,
      label: floor.label,
      minimumRoomAreaMm2,
      usableAreaMm2: usableArea,
      utilization,
      status: utilization > 1 ? "over_capacity" as const : utilization > 0.82 ? "tight" as const : "comfortable" as const,
    };
  });
  const blocking = floors.some((floor) => floor.status === "over_capacity");
  return {
    blocking,
    floors,
    actions: blocking
      ? ["Reduce rooms or optional ground-floor features.", "Move rooms to an upper floor.", "Reduce setbacks only if locally permitted, or use a larger plot."]
      : floors.some((floor) => floor.status === "tight")
        ? ["This floor is tightly programmed. Removing an optional room or moving it upstairs will give doors and circulation more working space."]
        : [],
  };
}
