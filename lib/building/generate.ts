import { z } from "zod";

import { generateRecursiveSlicingCandidate } from "@/lib/building/candidates/recursive-slicing";
import { generateSpineGrowthCandidate } from "@/lib/building/candidates/spine-growth";
import { candidateRoom, type CandidateGeneratorOptions, type CandidateRoom, type FloorCandidate } from "@/lib/building/candidates/types";
import { buildingRequirementsSchema, type BuildingRequirements } from "@/lib/building/requirements";
import { buildingSchema, type Building, type Floor, type Rectangle } from "@/lib/building/schema";
import { placeFloorOpenings } from "@/lib/building/openings";
import { normalizeFloorTopology } from "@/lib/building/topology";
import { buildVerticalConnectors, floorElevations, stairCandidateRoom, stairCoreBounds } from "@/lib/building/vertical";
import { validateBuilding, type ValidationFinding, type ValidationReport } from "@/lib/validation";
import { RULE_PACK_VERSION } from "@/lib/validation/rules";
import { CAD_RENDERER_VERSION } from "@/lib/renderer-version";

export type BuildingGenerationErrorCode =
  | "INVALID_REQUIREMENTS"
  | "BUILDING_TYPE_COMING_SOON"
  | "IRREGULAR_SITE_NOT_SUPPORTED"
  | "UNSUPPORTED_PROGRAM_TOPOLOGY"
  | "NO_FEASIBLE_LAYOUT";

export class BuildingGenerationError extends Error {
  constructor(
    readonly code: BuildingGenerationErrorCode,
    message: string,
    readonly conflicts: ValidationFinding[] = [],
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "BuildingGenerationError";
  }
}

export type GeneratedBuilding = {
  building: Building;
  validation: ValidationReport;
  evaluatedCandidateCount: number;
};

const MAX_CANDIDATES_PER_SEARCH_FAMILY = 256;
const SEARCH_SEED_SALTS = [0, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35] as const;
const RECOVERY_CANDIDATES_PER_FAMILY = 64;
const RECOVERY_ANCHOR_SEEDS = [31, 42] as const;

type SearchFamily = {
  searchSeed: number;
  candidateLimit: number;
  ordinalOffset: number;
  generatorMode: "mixed" | "backbone";
};

/**
 * User-relative families preserve seeded variety. Canonical recovery families deliberately
 * decouple feasibility from that style seed: if a valid topology exists in this bounded search
 * bank, a particular random seed cannot incorrectly make the same brief look impossible.
 */
function searchFamilies(seed: number): SearchFamily[] {
  const raw = [
    ...SEARCH_SEED_SALTS.map((salt) => ({ searchSeed: (seed ^ salt) >>> 0, candidateLimit: MAX_CANDIDATES_PER_SEARCH_FAMILY, generatorMode: "mixed" as const })),
    ...RECOVERY_ANCHOR_SEEDS.map((anchor) => ({ searchSeed: (anchor ^ 0x9e3779b9) >>> 0, candidateLimit: RECOVERY_CANDIDATES_PER_FAMILY, generatorMode: "backbone" as const })),
  ];
  const unique = [...new Map(raw.map((family) => [`${family.generatorMode}:${family.searchSeed}`, family])).values()];
  let ordinalOffset = 0;
  return unique.map((family) => {
    const result = { ...family, ordinalOffset };
    ordinalOffset += family.candidateLimit;
    return result;
  });
}

function recoveryGroups(rooms: BuildingRequirements["rooms"], requiredConnections: Array<[string, string]>) {
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const graph = new Map<string, Set<string>>(rooms.map((room) => [room.id, new Set()]));
  for (const [left, right] of requiredConnections) {
    if (!byId.has(left) || !byId.has(right)) continue;
    graph.get(left)?.add(right);
    graph.get(right)?.add(left);
  }
  const visited = new Set<string>();
  const groups: BuildingRequirements["rooms"][] = [];
  for (const room of [...rooms].sort((left, right) => left.id.localeCompare(right.id))) {
    if (visited.has(room.id)) continue;
    const component: string[] = [];
    const queue = [room.id];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      if (visited.has(current)) continue;
      visited.add(current);
      component.push(current);
      for (const next of [...(graph.get(current) ?? [])].sort()) if (!visited.has(next)) queue.push(next);
    }
    const componentSet = new Set(component);
    const start = component
      .filter((id) => [...(graph.get(id) ?? [])].filter((next) => componentSet.has(next)).length <= 1)
      .sort()[0] ?? component.sort()[0];
    const ordered: string[] = [];
    let previous: string | undefined;
    let current: string | undefined = start;
    while (current && !ordered.includes(current)) {
      ordered.push(current);
      const next: string | undefined = [...(graph.get(current) ?? [])]
        .filter((id) => componentSet.has(id) && id !== previous && !ordered.includes(id))
        .sort()[0];
      previous = current;
      current = next;
    }
    for (const id of component.sort()) if (!ordered.includes(id)) ordered.push(id);
    groups.push(ordered.map((id) => byId.get(id) as BuildingRequirements["rooms"][number]));
  }
  return groups;
}

function sliceRecoveryBand(rooms: BuildingRequirements["rooms"], bounds: Rectangle): CandidateRoom[] {
  if (rooms.length === 0) return [];
  const minimumWidth = 1120;
  if (bounds.width < rooms.length * minimumWidth) throw new Error("RECOVERY_BAND_TOO_NARROW");
  const remaining = bounds.width - rooms.length * minimumWidth;
  const totalWeight = rooms.reduce((sum, room) => sum + room.targetAreaMm2, 0);
  let x = bounds.x;
  return rooms.map((room, index) => {
    const width = index === rooms.length - 1
      ? bounds.x + bounds.width - x
      : minimumWidth + Math.floor(remaining * room.targetAreaMm2 / Math.max(1, totalWeight));
    const output = candidateRoom(room, { x, y: bounds.y, width, depth: bounds.depth });
    x += width;
    return output;
  });
}

/**
 * Recovery topology: one full-width common-access strip touches every destination room and the
 * fixed stair core. Required direct-connection components remain consecutive within a band.
 * This is intentionally conservative and runs only after the richer seeded families fail.
 */
function generateBackboneRecoveryCandidate(
  options: CandidateGeneratorOptions,
  requiredConnections: Array<[string, string]>,
): FloorCandidate {
  const circulation = options.rooms.find((room) => room.type === "circulation");
  if (!circulation) return generateRecursiveSlicingCandidate(options);
  const ordinaryRooms = options.rooms.filter((room) => room.id !== circulation.id);
  const stripDepth = Math.max(900, Math.min(1400, Math.round(circulation.targetAreaMm2 / options.envelope.width)));
  const topDepth = options.stairCore?.bounds.depth ?? Math.floor((options.envelope.depth - stripDepth) * 0.36);
  const stripY = options.envelope.y + topDepth;
  const bottomDepth = options.envelope.depth - topDepth - stripDepth;
  if (bottomDepth < 1200) throw new Error("RECOVERY_STRIP_EXCEEDS_ENVELOPE");
  const topBounds: Rectangle = {
    x: options.stairCore ? options.stairCore.bounds.x + options.stairCore.bounds.width : options.envelope.x,
    y: options.envelope.y,
    width: options.stairCore ? options.envelope.width - options.stairCore.bounds.width : options.envelope.width,
    depth: topDepth,
  };
  const bottomBounds: Rectangle = { x: options.envelope.x, y: stripY + stripDepth, width: options.envelope.width, depth: bottomDepth };
  const groups = recoveryGroups(ordinaryRooms, requiredConnections);
  const groupPriority = (group: BuildingRequirements["rooms"]) => {
    if (group.some((room) => room.id === "foyer")) return 3;
    if (group.length > 1 && group.some((room) => room.type === "bedroom") && group.some((room) => room.type === "bathroom")) return 0;
    if (group.every((room) => room.privacy === "private" || room.privacy === "service")) return 1;
    return 2;
  };
  const orderedGroups = [...groups].sort((left, right) => groupPriority(left) - groupPriority(right) || left[0].id.localeCompare(right[0].id));
  const minimumWidth = 1120;
  const topCapacity = Math.floor(topBounds.width / minimumWidth);
  const bottomCapacity = Math.floor(bottomBounds.width / minimumWidth);
  const desiredTopCount = Math.max(1, Math.round(ordinaryRooms.length * (topBounds.width * topBounds.depth) / Math.max(1, topBounds.width * topBounds.depth + bottomBounds.width * bottomBounds.depth)));
  const requiredTopCount = Math.max(desiredTopCount, ordinaryRooms.length - bottomCapacity);
  const topGroups: typeof groups = [];
  const bottomGroups: typeof groups = [];
  let topCount = 0;
  for (const group of orderedGroups) {
    if (topCount < requiredTopCount && topCount + group.length <= topCapacity && !group.some((room) => room.id === "foyer")) {
      topGroups.push(group);
      topCount += group.length;
    } else {
      bottomGroups.push(group);
    }
  }
  if (bottomGroups.flat().length > bottomCapacity || topGroups.flat().length > topCapacity) throw new Error("RECOVERY_BAND_CAPACITY");
  const orderBand = (bandGroups: typeof groups) => [...bandGroups]
    .sort((left, right) => Number(left.some((room) => room.id === "foyer")) - Number(right.some((room) => room.id === "foyer")) || left[0].id.localeCompare(right[0].id))
    .flat();
  const cells: CandidateRoom[] = [
    ...(options.stairCore ? [options.stairCore] : []),
    candidateRoom(circulation, { x: options.envelope.x, y: stripY, width: options.envelope.width, depth: stripDepth }),
    ...sliceRecoveryBand(orderBand(topGroups), topBounds),
    ...sliceRecoveryBand(orderBand(bottomGroups), bottomBounds),
  ];
  return { floor: options.floor, cells };
}

function buildableEnvelope(requirements: BuildingRequirements): Rectangle {
  return {
    x: requirements.site.setbacksMm.west,
    y: requirements.site.setbacksMm.north,
    width: requirements.site.widthMm - requirements.site.setbacksMm.west - requirements.site.setbacksMm.east,
    depth: requirements.site.depthMm - requirements.site.setbacksMm.north - requirements.site.setbacksMm.south,
  };
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function geometryHash(floors: Floor[]) {
  return stableHash(JSON.stringify(floors.map((floor) => ({
    id: floor.id,
    spaces: floor.spaces.map((space) => ({ id: space.id, bounds: space.bounds })),
    walls: floor.walls.map((wall) => ({ start: wall.start, end: wall.end, adjacent: wall.adjacentSpaceIds })),
    openings: floor.openings.map((opening) => ({ wallId: opening.wallId, kind: opening.kind, offset: opening.offsetMm, width: opening.widthMm })),
  }))));
}

function softCandidateScore(building: Building, validation: ValidationReport, requirements: BuildingRequirements) {
  const targetById = new Map(requirements.rooms.map((room) => [room.id, room.targetAreaMm2]));
  const areaPenalty = building.floors.reduce((total, floor) => total + floor.spaces.reduce((floorTotal, space) => {
    const target = targetById.get(space.id);
    return floorTotal + (target ? Math.abs(space.areaMm2 - target) / target : 0);
  }, 0), 0);
  const circulationArea = building.floors.reduce((total, floor) => total + floor.spaces
    .filter((space) => space.type === "circulation")
    .reduce((sum, space) => sum + space.areaMm2, 0), 0);
  const totalArea = building.floors.reduce((total, floor) => total + floor.envelope.width * floor.envelope.depth, 0);
  return validation.score - areaPenalty * 1.5 - circulationArea / Math.max(1, totalArea) * 8;
}

function parseRequirements(input: unknown) {
  const parsed = buildingRequirementsSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map((issue) => issue.message);
  const special = issues.find((message) => message === "BUILDING_TYPE_COMING_SOON" || message === "IRREGULAR_SITE_NOT_SUPPORTED");
  if (special) throw new BuildingGenerationError(special as BuildingGenerationErrorCode, special, [], parsed.error);
  throw new BuildingGenerationError("INVALID_REQUIREMENTS", z.prettifyError(parsed.error), [], parsed.error);
}

function generateCandidate(
  requirements: BuildingRequirements,
  envelope: Rectangle,
  candidateIndex: number,
  searchSeed: number,
  candidateOrdinal: number,
  generatorMode: SearchFamily["generatorMode"],
): Building {
  const hasUpperFloors = requirements.floors.length > 1;
  const coreBounds = hasUpperFloors ? stairCoreBounds(requirements, envelope) : undefined;
  const elevations = floorElevations(requirements.floors);
  const generatorId = generatorMode === "backbone" ? "backbone-strip" : candidateIndex % 2 === 0 ? "recursive-slicing" : "spine-growth";
  const generator = generatorId === "recursive-slicing" ? generateRecursiveSlicingCandidate : generateSpineGrowthCandidate;
  const orderedFloors = [...requirements.floors].sort((left, right) => left.level - right.level);
  const floors = orderedFloors.map((floorRequirement) => {
    const rooms = requirements.rooms.filter((room) => room.floorId === floorRequirement.id);
    const stairCore = coreBounds ? stairCandidateRoom(floorRequirement, coreBounds) : undefined;
    const usableArea = envelope.width * envelope.depth - (stairCore ? stairCore.bounds.width * stairCore.bounds.depth : 0);
    const minimumArea = rooms.reduce((sum, room) => sum + room.minAreaMm2, 0);
    if (minimumArea > usableArea) throw new BuildingGenerationError(
      "UNSUPPORTED_PROGRAM_TOPOLOGY",
      `${floorRequirement.label} needs ${(minimumArea / 1_000_000).toFixed(1)} m² of minimum room area but ${(usableArea / 1_000_000).toFixed(1)} m² remains after the stair core.`,
    );
    const generatorOptions = {
      envelope,
      rooms,
      floor: floorRequirement,
      seed: (searchSeed ^ Math.imul(candidateIndex + 1, 0x9e3779b1) ^ Math.imul(floorRequirement.level + 1, 0x85ebca6b)) >>> 0,
      variant: candidateIndex,
      stairCore,
    };
    const requiredConnections = requirements.relationships
      .filter((relationship) => relationship.type === "must_connect")
      .filter((relationship) => rooms.some((room) => room.id === relationship.fromRoomId) && rooms.some((room) => room.id === relationship.toRoomId))
      .map((relationship) => [relationship.fromRoomId, relationship.toRoomId] as [string, string]);
    const candidate = generatorMode === "backbone"
      ? generateBackboneRecoveryCandidate(generatorOptions, requiredConnections)
      : generator(generatorOptions);
    const normalized = normalizeFloorTopology(candidate, envelope, elevations.get(floorRequirement.id) ?? 0);
    return placeFloorOpenings(normalized, {
      isGroundFloor: floorRequirement.level === 0,
      entranceSide: requirements.site.roadEdges.includes(requirements.site.facing) ? requirements.site.facing : requirements.site.roadEdges[0],
      requiredConnections,
    });
  });
  const hash = geometryHash(floors);
  const base: Building = {
    buildingSchemaVersion: 2,
    algorithmVersion: "topology-hybrid-v2.0.0",
    rulePackVersion: RULE_PACK_VERSION,
    rendererVersion: CAD_RENDERER_VERSION,
    seed: requirements.seed,
    candidate: { generatorId, index: candidateOrdinal, score: 0, geometryHash: hash },
    site: {
      widthMm: requirements.site.widthMm,
      depthMm: requirements.site.depthMm,
      facing: requirements.site.facing,
      roadEdges: requirements.site.roadEdges,
      buildableEnvelope: envelope,
    },
    floors,
    verticalConnectors: [],
  };
  base.verticalConnectors = buildVerticalConnectors(requirements, floors);
  return base;
}

export function generateBuilding(input: unknown): GeneratedBuilding {
  const requirements = parseRequirements(input);
  const envelope = buildableEnvelope(requirements);
  const feasible: GeneratedBuilding[] = [];
  const rejectedFindings: ValidationFinding[] = [];
  const seenGeometry = new Set<string>();
  const families = searchFamilies(requirements.seed);

  for (const family of families) {
    for (let candidateIndex = 0; candidateIndex < family.candidateLimit; candidateIndex += 1) {
      let building: Building;
      try {
        building = generateCandidate(
          requirements,
          envelope,
          candidateIndex,
          family.searchSeed,
          family.ordinalOffset + candidateIndex,
          family.generatorMode,
        );
      } catch (error) {
        if (error instanceof BuildingGenerationError) throw error;
        continue;
      }
      if (seenGeometry.has(building.candidate.geometryHash)) continue;
      seenGeometry.add(building.candidate.geometryHash);
      const validation = validateBuilding(building, requirements);
      if (!validation.valid) {
        rejectedFindings.push(...validation.findings.filter((item) => item.severity === "error"));
        continue;
      }
      building.candidate.score = Number(softCandidateScore(building, validation, requirements).toFixed(6));
      const parsed = buildingSchema.safeParse(building);
      if (!parsed.success) continue;
      feasible.push({ building: parsed.data, validation, evaluatedCandidateCount: seenGeometry.size });
    }
    if (feasible.length > 0) break;
  }

  feasible.sort((left, right) =>
    right.building.candidate.score - left.building.candidate.score ||
    left.building.candidate.generatorId.localeCompare(right.building.candidate.generatorId) ||
    left.building.candidate.index - right.building.candidate.index ||
    left.building.candidate.geometryHash.localeCompare(right.building.candidate.geometryHash),
  );
  const selected = feasible[0];
  if (!selected) {
    const conflicts = [...new Map(rejectedFindings.map((item) => [`${item.ruleId}:${item.objectIds.join("|")}`, item])).values()].slice(0, 12);
    throw new BuildingGenerationError(
      "NO_FEASIBLE_LAYOUT",
      conflicts.length > 0
        ? `No feasible plan was found after ${seenGeometry.size} unique candidates across ${families.length} deterministic search families. Required direct connections or hard topology rules remained unsatisfied.`
        : `No deterministic candidate could be constructed after ${families.length} bounded search families.`,
      conflicts,
    );
  }
  return { ...selected, evaluatedCandidateCount: seenGeometry.size };
}
