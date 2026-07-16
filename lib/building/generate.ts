import { z } from "zod";

import { generateRecursiveSlicingCandidate } from "@/lib/building/candidates/recursive-slicing";
import { generateSpineGrowthCandidate } from "@/lib/building/candidates/spine-growth";
import { candidateRoom, type CandidateGeneratorOptions, type CandidateRoom, type FloorCandidate } from "@/lib/building/candidates/types";
import { buildingRequirementsSchema, type BuildingRequirements } from "@/lib/building/requirements";
import { buildingSchema, type Building, type Floor, type Rectangle } from "@/lib/building/schema";
import { buildStructuralConcept } from "@/lib/building/structure";
import { applyFormStrategy } from "@/lib/building/form";
import { placeFloorOpenings } from "@/lib/building/openings";
import { isOpenToSkySpace, normalizeFloorTopology } from "@/lib/building/topology";
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
const RECOVERY_CANDIDATES_PER_FAMILY = 1;
const RECOVERY_ANCHOR_SEEDS = [31] as const;

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
  const userRelative = SEARCH_SEED_SALTS.map((salt) => ({
    searchSeed: (seed ^ salt) >>> 0,
    candidateLimit: MAX_CANDIDATES_PER_SEARCH_FAMILY,
    generatorMode: "mixed" as const,
  }));
  const recovery = RECOVERY_ANCHOR_SEEDS.map((anchor) => ({
    searchSeed: (anchor ^ 0x9e3779b9) >>> 0,
    candidateLimit: RECOVERY_CANDIDATES_PER_FAMILY,
    generatorMode: "backbone" as const,
  }));
  // Preserve seeded variety first, then recover immediately before spending three more
  // equivalent search banks on a brief the rich family cannot satisfy.
  const raw = [userRelative[0], ...recovery, ...userRelative.slice(1)];
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

function sliceRecoveryBand(
  rooms: BuildingRequirements["rooms"],
  bounds: Rectangle,
  roadSide: Building["site"]["facing"],
): CandidateRoom[] {
  if (rooms.length === 0) return [];
  const minimumWidths = rooms.map((room) => Math.max(
    room.accessible ? 1200 : 900,
    room.type === "parking" && (roadSide === "north" || roadSide === "south") ? 2900 : 0,
    Math.ceil(room.minAreaMm2 / bounds.depth),
  ));
  const minimumTotal = minimumWidths.reduce((sum, width) => sum + width, 0);
  if (bounds.width < minimumTotal) throw new Error("RECOVERY_BAND_TOO_NARROW");
  const remaining = bounds.width - minimumTotal;
  const totalWeight = rooms.reduce((sum, room) => sum + room.targetAreaMm2, 0);
  let x = bounds.x;
  return rooms.map((room, index) => {
    const width = index === rooms.length - 1
      ? bounds.x + bounds.width - x
      : minimumWidths[index] + Math.floor(remaining * room.targetAreaMm2 / Math.max(1, totalWeight));
    const output = candidateRoom(room, { x, y: bounds.y, width, depth: bounds.depth });
    x += width;
    return output;
  });
}

function recoveryGroupWidth(
  group: BuildingRequirements["rooms"],
  bounds: Rectangle,
  roadSide: Building["site"]["facing"],
) {
  const living = group.find((room) => room.type === "living");
  const outerRooms = group.filter((room) => room.id !== living?.id);
  if (living && outerRooms.length > 0) {
    const livingWidth = Math.max(2_100, Math.ceil(living.minAreaMm2 / bounds.depth));
    const outerWidth = Math.max(1_200, Math.ceil(outerRooms.reduce((sum, room) => sum + room.minAreaMm2, 0) / bounds.depth));
    return livingWidth + outerWidth;
  }
  return group.reduce((sum, room) => sum + Math.max(
    room.accessible ? 1200 : 900,
    room.type === "parking" && (roadSide === "north" || roadSide === "south") ? 2900 : 0,
    Math.ceil(room.minAreaMm2 / bounds.depth),
  ), 0);
}

function splitRecoveryCluster(
  group: BuildingRequirements["rooms"],
  bounds: Rectangle,
  roadSide: Building["site"]["facing"],
  accessEdge: "north" | "south",
): CandidateRoom[] {
  const living = group.find((room) => room.type === "living");
  const outerRooms = group.filter((room) => room.id !== living?.id);
  if (living && outerRooms.length > 0) {
    const minimumLivingWidth = Math.max(2_100, Math.ceil(living.minAreaMm2 / bounds.depth));
    const minimumOuterWidth = Math.max(1_200, Math.ceil(outerRooms.reduce((sum, room) => sum + room.minAreaMm2, 0) / bounds.depth));
    if (minimumLivingWidth + minimumOuterWidth <= bounds.width) {
      const livingWidth = Math.max(
        minimumLivingWidth,
        Math.min(bounds.width - minimumOuterWidth, Math.round(living.targetAreaMm2 / bounds.depth)),
      );
      const outerWidth = bounds.width - livingWidth;
      const minimumDepths = outerRooms.map((room) => Math.max(room.accessible ? 1_200 : 900, Math.ceil(room.minAreaMm2 / outerWidth)));
      const minimumTotalDepth = minimumDepths.reduce((sum, depth) => sum + depth, 0);
      if (minimumTotalDepth <= bounds.depth) {
        const remainingDepth = bounds.depth - minimumTotalDepth;
        const totalWeight = outerRooms.reduce((sum, room) => sum + room.targetAreaMm2, 0);
        const livingOnRight = roadSide === "west";
        const livingX = livingOnRight ? bounds.x + outerWidth : bounds.x;
        const outerX = livingOnRight ? bounds.x : bounds.x + livingWidth;
        let y = bounds.y;
        const outerCells = outerRooms.map((room, index) => {
          const depth = index === outerRooms.length - 1
            ? bounds.y + bounds.depth - y
            : minimumDepths[index] + Math.floor(remainingDepth * room.targetAreaMm2 / Math.max(1, totalWeight));
          const output = candidateRoom(room, { x: outerX, y, width: outerWidth, depth });
          y += depth;
          return output;
        });
        return [candidateRoom(living, { x: livingX, y: bounds.y, width: livingWidth, depth: bounds.depth }), ...outerCells];
      }
    }
  }
  return sliceRecoveryBand(group, bounds, roadSide);
}

function sliceRecoveryGroups(
  groups: BuildingRequirements["rooms"][],
  bounds: Rectangle,
  roadSide: Building["site"]["facing"],
  accessEdge: "north" | "south",
) {
  if (groups.length === 0) return [];
  const minimumWidths = groups.map((group) => recoveryGroupWidth(group, bounds, roadSide));
  const minimumTotal = minimumWidths.reduce((sum, width) => sum + width, 0);
  if (minimumTotal > bounds.width) throw new Error("RECOVERY_GROUP_BAND_TOO_NARROW");
  const remaining = bounds.width - minimumTotal;
  const weights = groups.map((group) => group.reduce((sum, room) => sum + room.targetAreaMm2, 0));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let x = bounds.x;
  return groups.flatMap((group, index) => {
    const width = index === groups.length - 1
      ? bounds.x + bounds.width - x
      : minimumWidths[index] + Math.floor(remaining * weights[index] / Math.max(1, totalWeight));
    const clusterBounds = { x, y: bounds.y, width, depth: bounds.depth };
    x += width;
    return splitRecoveryCluster(group, clusterBounds, roadSide, accessEdge);
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
  roadSide: Building["site"]["facing"],
): FloorCandidate {
  const circulation = options.rooms.find((room) => room.type === "circulation");
  const living = options.rooms.find((room) => room.type === "living");
  // A real circulation spine keeps the living room proportioned as a room. Using living as the
  // strip creates the exact full-width band + parallel-room anti-pattern this recovery path must
  // avoid. Only briefs without a circulation program fall back to living as shared access.
  const accessSpine = circulation ? {
    ...circulation,
    id: `${circulation.id}-gallery`,
    name: "Central gallery",
  } : living;
  if (!accessSpine) return generateRecursiveSlicingCandidate(options);
  const stairPocketCirculation = circulation && options.stairCore ? circulation : undefined;
  const ordinaryRooms = options.rooms.filter((room) => room.id !== circulation?.id && room.id !== accessSpine.id);
  const stripDepth = accessSpine.type === "living"
    ? Math.max(1000, Math.ceil(accessSpine.minAreaMm2 / options.envelope.width))
    : Math.max(900, Math.min(1400, Math.round(accessSpine.targetAreaMm2 / options.envelope.width)));
  const pocketDepth = stairPocketCirculation && options.stairCore
    ? Math.max(1_000, Math.ceil(stairPocketCirculation.targetAreaMm2 / options.stairCore.bounds.width) + 300)
    : 0;
  const topDepth = options.stairCore
    ? options.stairCore.bounds.depth + pocketDepth
    : Math.floor((options.envelope.depth - stripDepth) * 0.36);
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
  const groupWidth = (group: BuildingRequirements["rooms"], bounds: Rectangle) => recoveryGroupWidth(group, bounds, roadSide);
  let selected: { topGroups: typeof groups; bottomGroups: typeof groups; score: number } | undefined;
  for (let mask = 0; mask < 2 ** orderedGroups.length; mask += 1) {
    const topGroups: typeof groups = [];
    const bottomGroups: typeof groups = [];
    let topWidth = 0;
    let bottomWidth = 0;
    for (const [index, group] of orderedGroups.entries()) {
      const roadAnchored = group.some((room) => room.type === "parking" || room.type === "foyer");
      const forceTop = roadAnchored && roadSide === "north";
      const forceBottom = roadAnchored && (roadSide === "south" || (roadSide === "west" && Boolean(options.stairCore)));
      const top = forceTop || (!forceBottom && Boolean(mask & (1 << index)));
      if (top) {
        topGroups.push(group);
        topWidth += groupWidth(group, topBounds);
      } else {
        bottomGroups.push(group);
        bottomWidth += groupWidth(group, bottomBounds);
      }
    }
    if (topWidth > topBounds.width || bottomWidth > bottomBounds.width) continue;
    const topWeight = topGroups.flat().reduce((sum, room) => sum + room.targetAreaMm2, 0);
    const bottomWeight = bottomGroups.flat().reduce((sum, room) => sum + room.targetAreaMm2, 0);
    const score = Math.abs(
      topWeight / Math.max(1, topBounds.width * topBounds.depth) -
      bottomWeight / Math.max(1, bottomBounds.width * bottomBounds.depth),
    );
    if (!selected || score < selected.score) selected = { topGroups, bottomGroups, score };
  }
  if (!selected) throw new Error("RECOVERY_BAND_CAPACITY");
  const { topGroups, bottomGroups } = selected;
  const orderBand = (bandGroups: typeof groups) => [...bandGroups]
    .sort((left, right) => {
      const leftParking = left.some((room) => room.type === "parking") ? 1 : 0;
      const rightParking = right.some((room) => room.type === "parking") ? 1 : 0;
      if (leftParking !== rightParking) return roadSide === "west" ? rightParking - leftParking : leftParking - rightParking;
      return left[0].id.localeCompare(right[0].id);
    });
  const cells: CandidateRoom[] = [
    ...(options.stairCore ? [options.stairCore] : []),
    ...(stairPocketCirculation && options.stairCore ? [candidateRoom(stairPocketCirculation, {
        x: options.stairCore.bounds.x,
        y: options.stairCore.bounds.y + options.stairCore.bounds.depth,
        width: options.stairCore.bounds.width,
        depth: pocketDepth,
      })] : []),
    candidateRoom(accessSpine, { x: options.envelope.x, y: stripY, width: options.envelope.width, depth: stripDepth }),
    ...sliceRecoveryGroups(orderBand(topGroups), topBounds, roadSide, "south"),
    ...sliceRecoveryGroups(orderBand(bottomGroups), bottomBounds, roadSide, "north"),
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
    openings: floor.openings.map((opening) => ({ wallId: opening.wallId, kind: opening.kind, usage: opening.usage, connects: opening.connects, offset: opening.offsetMm, width: opening.widthMm })),
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
  const repeatedBandPenalty = building.floors.reduce((total, floor) => {
    const constructed = floor.spaces.filter((space) => !isOpenToSkySpace(space));
    const bands = new Map<string, number>();
    for (const space of constructed) {
      const key = `${space.bounds.x}:${space.bounds.width}`;
      bands.set(key, (bands.get(key) ?? 0) + 1);
    }
    const largestRepeatedBand = Math.max(1, ...bands.values());
    return total + Math.max(0, largestRepeatedBand - 2) / Math.max(1, constructed.length);
  }, 0);
  const openToSkyRatio = building.floors.reduce((total, floor) => total + floor.spaces
    .filter(isOpenToSkySpace)
    .reduce((sum, space) => sum + space.areaMm2, 0), 0) / Math.max(1, totalArea);
  const formReward = requirements.architecture.formStrategy === "compact" ? 0 : Math.min(0.15, openToSkyRatio) * 24;
  return validation.score
    - areaPenalty * 1.5
    - circulationArea / Math.max(1, totalArea) * 8
    - repeatedBandPenalty * 6
    + formReward;
}

function parseRequirements(input: unknown) {
  const parsed = buildingRequirementsSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map((issue) => issue.message);
  const special = issues.find((message) => message === "BUILDING_TYPE_COMING_SOON" || message === "IRREGULAR_SITE_NOT_SUPPORTED");
  if (special) throw new BuildingGenerationError(special as BuildingGenerationErrorCode, special, [], parsed.error);
  throw new BuildingGenerationError("INVALID_REQUIREMENTS", z.prettifyError(parsed.error), [], parsed.error);
}

function constructionRejectionKey(error: unknown) {
  if (!(error instanceof Error)) return "UNKNOWN_CONSTRUCTION_ERROR";
  const code = error.message.split(":", 1)[0];
  return /^[A-Z][A-Z0-9_]*$/.test(code) ? code : "UNEXPECTED_CONSTRUCTION_ERROR";
}

function rejectionSummary(rejections: Map<string, number>) {
  if (rejections.size === 0) return "";
  const details = [...rejections.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, count]) => `${reason}=${count}`)
    .join(", ");
  return ` Construction rejections: ${details}.`;
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
      formStrategy: requirements.architecture.formStrategy,
    };
    const requiredConnections = requirements.relationships
      .filter((relationship) => relationship.type === "must_connect")
      .filter((relationship) => rooms.some((room) => room.id === relationship.fromRoomId) && rooms.some((room) => room.id === relationship.toRoomId))
      .map((relationship) => [relationship.fromRoomId, relationship.toRoomId] as [string, string]);
    const entranceSide = requirements.site.roadEdges.includes(requirements.site.facing) ? requirements.site.facing : requirements.site.roadEdges[0];
    const rawCandidate = generatorMode === "backbone"
      ? generateBackboneRecoveryCandidate(generatorOptions, requiredConnections, entranceSide)
      : generator(generatorOptions);
    const candidate = applyFormStrategy(
      rawCandidate,
      envelope,
      requirements.architecture.formStrategy,
      entranceSide,
      generatorOptions.seed,
      true,
    );
    const normalized = normalizeFloorTopology(candidate, envelope, elevations.get(floorRequirement.id) ?? 0);
    return placeFloorOpenings(normalized, {
      isGroundFloor: floorRequirement.level === 0,
      entranceSide,
      roadEdges: requirements.site.roadEdges,
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
  base.structuralConcept = buildStructuralConcept(floors);
  return base;
}

export function generateBuilding(input: unknown): GeneratedBuilding {
  const requirements = parseRequirements(input);
  const envelope = buildableEnvelope(requirements);
  const feasible: GeneratedBuilding[] = [];
  const rejectedFindings: ValidationFinding[] = [];
  const constructionRejections = new Map<string, number>();
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
        const reason = constructionRejectionKey(error);
        constructionRejections.set(reason, (constructionRejections.get(reason) ?? 0) + 1);
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
      if (!parsed.success) {
        constructionRejections.set("BUILDING_SCHEMA_REJECTED", (constructionRejections.get("BUILDING_SCHEMA_REJECTED") ?? 0) + 1);
        continue;
      }
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
        ? `No feasible plan was found after ${seenGeometry.size} unique candidates across ${families.length} deterministic search families. Required direct connections or hard topology rules remained unsatisfied.${rejectionSummary(constructionRejections)}`
        : `No deterministic candidate could be constructed after ${families.length} bounded search families.${rejectionSummary(constructionRejections)}`,
      conflicts,
    );
  }
  return { ...selected, evaluatedCandidateCount: seenGeometry.size };
}
