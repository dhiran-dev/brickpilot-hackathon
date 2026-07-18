import type { BuildingRequirements, CurrentBuildingRequirements, FormStrategy, RoomRequirement } from "@/lib/building/requirements";
import type { Rectangle } from "@/lib/building/schema";
import { entranceRoadSide } from "@/lib/building/topology";

export type ClimateClass =
  | "hot_humid"
  | "hot_dry"
  | "temperate"
  | "cold_continental"
  | "mediterranean";

export type PartiId = "t_hub" | "l_court" | "courtyard" | "verandah_bungalow" | "compact";
export type AccessEdge = "north" | "east" | "south" | "west";
export type V3PartiId = "courtyard_ring" | "compact_bar" | "articulated_l" | "t_hub";

export type PartiDefinition = {
  id: PartiId;
  name: string;
  minimumWidthMm: number;
  minimumDepthMm: number;
  maximumFloors?: number;
  minimumRoomsPerFloor?: number;
  courtStrategy: "none" | "entry_recess" | "corner" | "central" | "verandah_rear";
};

export type PartiZoneRole = "access_spine" | "outer_room" | "inner_service" | "open_space";

export type PartiGrammar = {
  id: PartiId;
  accessZones: readonly string[];
  zones: Readonly<Record<string, PartiZoneRole>>;
  edges: readonly (readonly [string, string])[];
  maximumOccupiedDepth: 2;
  innerCellTypes: readonly ("bathroom" | "utility" | "store" | "pooja")[];
};

export type PartiSelectionInput = {
  formStrategy: FormStrategy;
  climateClass: ClimateClass;
  envelope: Rectangle;
  floorCount: number;
  rooms: RoomRequirement[];
  seed: number;
};

export const PARTI_DEFINITIONS: Readonly<Record<PartiId, PartiDefinition>> = Object.freeze({
  t_hub: {
    id: "t_hub",
    name: "T-Hub Villa",
    minimumWidthMm: 7_000,
    minimumDepthMm: 0,
    courtStrategy: "entry_recess",
  },
  l_court: {
    id: "l_court",
    name: "L-Court Villa",
    minimumWidthMm: 9_000,
    minimumDepthMm: 12_000,
    courtStrategy: "corner",
  },
  courtyard: {
    id: "courtyard",
    name: "Courtyard Villa",
    minimumWidthMm: 10_000,
    minimumDepthMm: 12_000,
    minimumRoomsPerFloor: 8,
    courtStrategy: "central",
  },
  verandah_bungalow: {
    id: "verandah_bungalow",
    name: "Verandah Bungalow",
    minimumWidthMm: 7_000,
    minimumDepthMm: 0,
    maximumFloors: 2,
    courtStrategy: "verandah_rear",
  },
  compact: {
    id: "compact",
    name: "Compact Villa",
    minimumWidthMm: 0,
    minimumDepthMm: 0,
    courtStrategy: "none",
  },
});

/** Declarative access-edge graphs consumed by the zone tiler and its depth invariant. */
export const PARTI_GRAMMARS: Readonly<Record<PartiId, PartiGrammar>> = Object.freeze({
  t_hub: {
    id: "t_hub",
    accessZones: ["crossbar", "stem"],
    zones: { crossbar: "access_spine", stem: "access_spine", westWing: "outer_room", eastWing: "outer_room", serviceLeaf: "inner_service" },
    edges: [["crossbar", "stem"], ["crossbar", "westWing"], ["crossbar", "eastWing"], ["westWing", "serviceLeaf"]],
    maximumOccupiedDepth: 2,
    innerCellTypes: ["bathroom", "utility", "store", "pooja"],
  },
  l_court: {
    id: "l_court",
    accessZones: ["entryLeg", "gardenLeg"],
    zones: { entryLeg: "access_spine", gardenLeg: "access_spine", streetWing: "outer_room", gardenWing: "outer_room", court: "open_space", serviceLeaf: "inner_service" },
    edges: [["entryLeg", "gardenLeg"], ["entryLeg", "streetWing"], ["gardenLeg", "gardenWing"], ["gardenLeg", "court"], ["gardenWing", "serviceLeaf"]],
    maximumOccupiedDepth: 2,
    innerCellTypes: ["bathroom", "utility", "store", "pooja"],
  },
  courtyard: {
    id: "courtyard",
    accessZones: ["ringNorth", "ringEast", "ringSouth", "ringWest"],
    zones: { ringNorth: "access_spine", ringEast: "access_spine", ringSouth: "access_spine", ringWest: "access_spine", northWing: "outer_room", eastWing: "outer_room", southWing: "outer_room", westWing: "outer_room", court: "open_space" },
    edges: [["ringNorth", "ringEast"], ["ringEast", "ringSouth"], ["ringSouth", "ringWest"], ["ringWest", "ringNorth"], ["ringNorth", "northWing"], ["ringEast", "eastWing"], ["ringSouth", "southWing"], ["ringWest", "westWing"]],
    maximumOccupiedDepth: 2,
    innerCellTypes: ["bathroom", "utility", "store", "pooja"],
  },
  verandah_bungalow: {
    id: "verandah_bungalow",
    accessZones: ["frontVerandah", "centralHall", "rearVerandah"],
    zones: { frontVerandah: "access_spine", centralHall: "access_spine", rearVerandah: "access_spine", westRooms: "outer_room", eastRooms: "outer_room", rearGarden: "open_space", serviceLeaf: "inner_service" },
    edges: [["frontVerandah", "centralHall"], ["centralHall", "rearVerandah"], ["centralHall", "westRooms"], ["centralHall", "eastRooms"], ["rearVerandah", "rearGarden"], ["eastRooms", "serviceLeaf"]],
    maximumOccupiedDepth: 2,
    innerCellTypes: ["bathroom", "utility", "store", "pooja"],
  },
  compact: {
    id: "compact",
    accessZones: ["centralHall"],
    zones: { centralHall: "access_spine", northRooms: "outer_room", southRooms: "outer_room", serviceLeaf: "inner_service" },
    edges: [["centralHall", "northRooms"], ["centralHall", "southRooms"], ["southRooms", "serviceLeaf"]],
    maximumOccupiedDepth: 2,
    innerCellTypes: ["bathroom", "utility", "store", "pooja"],
  },
});

export const FORM_STRATEGY_PARTIS: Readonly<Record<FormStrategy, readonly PartiId[]>> = Object.freeze({
  compact: ["compact"],
  stepped_terraces: ["t_hub", "verandah_bungalow", "l_court"],
  courtyard: ["courtyard", "l_court", "t_hub"],
  articulated_wings: ["l_court", "t_hub", "courtyard"],
});

function stableSeedRank(seed: number, id: string) {
  let hash = seed ^ 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function eligible(definition: PartiDefinition, input: PartiSelectionInput) {
  if (input.envelope.width < definition.minimumWidthMm || input.envelope.depth < definition.minimumDepthMm) return false;
  if (definition.maximumFloors && input.floorCount > definition.maximumFloors) return false;
  if (definition.minimumRoomsPerFloor) {
    const counts = input.rooms.reduce((map, room) => map.set(room.floorId, (map.get(room.floorId) ?? 0) + 1), new Map<string, number>());
    if ([...counts.values()].some((count) => count < (definition.minimumRoomsPerFloor ?? 0))) return false;
  }
  return true;
}

const CLIMATE_PRIORITY: Readonly<Record<ClimateClass, Readonly<Partial<Record<PartiId, number>>>>> = Object.freeze({
  hot_humid: { verandah_bungalow: -3, courtyard: -2, l_court: -1 },
  hot_dry: { courtyard: -3, l_court: -2, verandah_bungalow: -1 },
  temperate: { t_hub: -1 },
  cold_continental: { compact: -3, t_hub: -1 },
  mediterranean: { l_court: -3, courtyard: -1 },
});

export type V3PartiDefinition = {
  id: V3PartiId;
  name: string;
  topology: "ring" | "bar" | "l_wings" | "t_hub";
  minimumShortSideMm: number;
  minimumLongSideMm: number;
};

export const V3_PARTI_DEFINITIONS: Readonly<Record<V3PartiId, V3PartiDefinition>> = Object.freeze({
  courtyard_ring: { id: "courtyard_ring", name: "Courtyard Ring", topology: "ring", minimumShortSideMm: 10_000, minimumLongSideMm: 12_000 },
  compact_bar: { id: "compact_bar", name: "Compact Bar", topology: "bar", minimumShortSideMm: 5_000, minimumLongSideMm: 7_000 },
  articulated_l: { id: "articulated_l", name: "Articulated L", topology: "l_wings", minimumShortSideMm: 9_000, minimumLongSideMm: 11_000 },
  t_hub: { id: "t_hub", name: "T-Hub", topology: "t_hub", minimumShortSideMm: 7_000, minimumLongSideMm: 9_000 },
});

const V3_FORM_PRIORITY: Readonly<Record<FormStrategy, readonly V3PartiId[]>> = Object.freeze({
  compact: ["compact_bar", "t_hub", "articulated_l", "courtyard_ring"],
  stepped_terraces: ["articulated_l", "t_hub", "compact_bar", "courtyard_ring"],
  courtyard: ["courtyard_ring", "articulated_l", "t_hub", "compact_bar"],
  articulated_wings: ["articulated_l", "t_hub", "courtyard_ring", "compact_bar"],
});

const V3_CLIMATE_TIE_BREAK: Readonly<Record<ClimateClass, Readonly<Partial<Record<V3PartiId, number>>>>> = Object.freeze({
  hot_humid: { courtyard_ring: 0, articulated_l: 1, t_hub: 2, compact_bar: 3 },
  hot_dry: { courtyard_ring: 0, articulated_l: 1, compact_bar: 2, t_hub: 3 },
  temperate: { articulated_l: 0, t_hub: 1, compact_bar: 2, courtyard_ring: 3 },
  cold_continental: { compact_bar: 0, t_hub: 1, articulated_l: 2, courtyard_ring: 3 },
  mediterranean: { articulated_l: 0, courtyard_ring: 1, t_hub: 2, compact_bar: 3 },
});

export type V3PartiEligibility = {
  eligible: V3PartiId[];
  rejected: Array<{ partiId: V3PartiId; reason: "ENVELOPE_TOO_SMALL" }>;
};

/**
 * V3 selection keeps the explicitly selected form in rank zero. Climate may order only the
 * alternative rank; it can never displace the user's feasible primary form.
 */
export function evaluateV3Partis(input: {
  requirements: Pick<CurrentBuildingRequirements, "architecture" | "seed">;
  climateClass: ClimateClass;
  envelope: Rectangle;
}): V3PartiEligibility {
  const configured = V3_FORM_PRIORITY[input.requirements.architecture.formStrategy];
  const primary = configured[0];
  const shortSide = Math.min(input.envelope.width, input.envelope.depth);
  const longSide = Math.max(input.envelope.width, input.envelope.depth);
  const feasible = configured.filter((partiId) => {
    const definition = V3_PARTI_DEFINITIONS[partiId];
    return shortSide >= definition.minimumShortSideMm && longSide >= definition.minimumLongSideMm;
  });
  const alternatives = feasible.filter((partiId) => partiId !== primary).sort((left, right) =>
    (V3_CLIMATE_TIE_BREAK[input.climateClass][left] ?? 99) - (V3_CLIMATE_TIE_BREAK[input.climateClass][right] ?? 99)
    || stableSeedRank(input.requirements.seed, left) - stableSeedRank(input.requirements.seed, right)
    || left.localeCompare(right),
  );
  const eligible = feasible.includes(primary) ? [primary, ...alternatives] : alternatives;
  return {
    eligible,
    rejected: configured
      .filter((partiId) => !feasible.includes(partiId))
      .map((partiId) => ({ partiId, reason: "ENVELOPE_TOO_SMALL" as const })),
  };
}

/**
 * Eligibility never depends on seed. Seed is only a stable tie-break among partis with the same
 * form/climate priority, so changing taste seed cannot turn a feasible brief into an impossible one.
 */
export function selectEligiblePartis(input: PartiSelectionInput): PartiId[] {
  const configured = FORM_STRATEGY_PARTIS[input.formStrategy];
  const baseRank = new Map(configured.map((id, index) => [id, index]));
  const candidates = configured
    .filter((id) => eligible(PARTI_DEFINITIONS[id], input))
    .sort((left, right) => {
      const climateDelta = (CLIMATE_PRIORITY[input.climateClass][left] ?? 0) - (CLIMATE_PRIORITY[input.climateClass][right] ?? 0);
      if (climateDelta !== 0) return climateDelta;
      const formDelta = (baseRank.get(left) ?? 99) - (baseRank.get(right) ?? 99);
      if (formDelta !== 0) return formDelta;
      return stableSeedRank(input.seed, left) - stableSeedRank(input.seed, right) || left.localeCompare(right);
    });
  if (!candidates.includes("compact")) candidates.push("compact");
  return candidates;
}

export function defaultPartiName(id: PartiId, ordinal = 0) {
  return `${PARTI_DEFINITIONS[id].name} · Scheme ${String.fromCharCode(65 + ordinal)}`;
}

/**
 * The aligned grammar's crossbar is roughly half of its local width. When that would exceed the
 * world-space 40%-of-depth gallery cap, tile the parti in a quarter-turned local frame instead.
 */
export function shouldQuarterTurnParti(envelope: Rectangle) {
  return (envelope.width - 900) / 2 > envelope.depth * 0.4;
}

/**
 * Canonical world-space stair anchor owned by the selected parti. Mirrored access orientations
 * receive the matching opposite corner so the tiler's source-frame mirror restores the stair to
 * this exact reserved footprint on every floor.
 */
export function partiStairAnchor(
  partiId: PartiId,
  requirements: Pick<BuildingRequirements, "vertical"> & {
    site?: Pick<BuildingRequirements["site"], "facing" | "roadEdges">;
  },
  envelope: Rectangle,
): Rectangle {
  const clearWidth = requirements.vertical.stairWidthMm;
  const dogLeg = requirements.vertical.stairFamily === "dog_leg";
  const width = dogLeg ? clearWidth * 2 + 230 : clearWidth + 230;
  const depth = dogLeg ? Math.max(3_200, clearWidth * 3) : Math.max(4_200, clearWidth * 4);
  const landingClearance = partiId === "compact" ? 900 : 1_000;
  const quarterTurned = shouldQuarterTurnParti(envelope);
  const orientedWidth = quarterTurned ? depth : width;
  const orientedDepth = quarterTurned ? width : depth;
  const entranceSide = requirements.site ? entranceRoadSide(requirements.site) : "east";
  if (orientedWidth + landingClearance >= envelope.width || orientedDepth + landingClearance >= envelope.depth) {
    throw new Error(`STAIR_CORE_EXCEEDS_ENVELOPE:${partiId}`);
  }
  if (quarterTurned) {
    if (entranceSide === "south") return {
      x: envelope.x,
      y: envelope.y,
      width: orientedWidth,
      depth: orientedDepth,
    };
    if (entranceSide === "west") return {
      x: envelope.x + envelope.width - orientedWidth,
      y: envelope.y + envelope.depth - orientedDepth,
      width: orientedWidth,
      depth: orientedDepth,
    };
    return {
      x: envelope.x,
      y: envelope.y + envelope.depth - orientedDepth,
      width: orientedWidth,
      depth: orientedDepth,
    };
  }
  if (entranceSide === "north") return { x: envelope.x, y: envelope.y + envelope.depth - depth, width, depth };
  if (entranceSide === "west") return { x: envelope.x + envelope.width - width, y: envelope.y, width, depth };
  return { x: envelope.x, y: envelope.y, width, depth };
}
