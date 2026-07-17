import { z } from "zod";

import { generatePartiCandidate } from "@/lib/building/candidates/parti-tiler";
import type { ReservedRegion } from "@/lib/building/candidates/types";
import { buildingRequirementsSchema, type BuildingRequirements } from "@/lib/building/requirements";
import { buildingSchema, type Building, type Floor, type Rectangle } from "@/lib/building/schema";
import { buildStructuralConcept } from "@/lib/building/structure";
import { placeFloorOpenings } from "@/lib/building/openings";
import { climateOrientationEvidence, softCandidateScore } from "@/lib/building/scoring";
import { defaultPartiName, PARTI_DEFINITIONS, partiStairAnchor, selectEligiblePartis, type PartiId } from "@/lib/building/partis";
import { resolveRegionalPack } from "@/lib/design/regional-packs";
import { buildRelaxationLadder, type RelaxationAttempt, type RelaxationRungId } from "@/lib/building/relaxation";
import { entranceRoadSide, normalizeFloorTopology } from "@/lib/building/topology";
import { buildVerticalConnectors, floorElevations, stairCandidateRoom } from "@/lib/building/vertical";
import { validateBuilding, type ValidationFinding, type ValidationReport } from "@/lib/validation";
import { RULE_PACK_VERSION } from "@/lib/validation/rules";
import { CAD_RENDERER_VERSION } from "@/lib/renderer-version";

export type BuildingGenerationErrorCode =
  | "INVALID_REQUIREMENTS"
  | "BUILDING_TYPE_COMING_SOON"
  | "IRREGULAR_SITE_NOT_SUPPORTED"
  | "UNSUPPORTED_PROGRAM_TOPOLOGY"
  | "GENERATION_TIMEOUT"
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

export const MAX_GENERATED_SCHEMES = 3;
export const MAX_CONSTRUCTED_CANDIDATES = 3_000;
// The shared tiler is deterministic for a parti/rung pair. One construction is therefore the
// complete fixed quota today; increasing this is valid only when a variant actually changes
// geometry, otherwise it burns the watchdog on exact duplicates.
export const CANDIDATES_PER_PARTI_RUNG = 1;
export const SCHEME_WATCHDOG_MS = 8_000;

export type DeterministicQuota = {
  partiId: PartiId;
  rung: RelaxationAttempt["rung"];
  relaxationId: RelaxationRungId;
  simplifiedCourt: boolean;
  quota: number;
};

export type GenerationQuotaUsage = DeterministicQuota & { attempted: number };

export type GenerationDiagnostics = {
  watchdogMs: number;
  candidateCeiling: number;
  plannedCandidateCount: number;
  constructedCandidateCount: number;
  evaluatedCandidateCount: number;
  quotaUsage: GenerationQuotaUsage[];
};

export type GeneratedScheme = {
  schemeId: string;
  partiId: PartiId;
  name: string;
  rationale: string;
  building: Building;
  validation: ValidationReport;
  evidence: string[];
  ladderRung: RelaxationAttempt["rung"];
};

export type GeneratedSchemeSet = {
  schemes: GeneratedScheme[];
  evaluatedCandidateCount: number;
  diagnostics: GenerationDiagnostics;
};

export type GenerateBuildingSchemesOptions = {
  now?: () => number;
  watchdogMs?: number;
  candidatesPerPartiRung?: number;
};

export function buildDeterministicQuotaPlan(
  ladder: readonly RelaxationAttempt[],
  candidatesPerPartiRung = CANDIDATES_PER_PARTI_RUNG,
): DeterministicQuota[] {
  const requested = Number.isFinite(candidatesPerPartiRung)
    ? Math.max(1, Math.floor(candidatesPerPartiRung))
    : CANDIDATES_PER_PARTI_RUNG;
  const boundedLadder = ladder.slice(0, MAX_CONSTRUCTED_CANDIDATES);
  const quota = Math.min(requested, Math.max(1, Math.floor(MAX_CONSTRUCTED_CANDIDATES / Math.max(1, boundedLadder.length))));
  return boundedLadder.map((relaxation) => ({
      partiId: relaxation.partiId,
      rung: relaxation.rung,
      relaxationId: relaxation.id,
      simplifiedCourt: relaxation.simplifiedCourt,
      quota,
  }));
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

export function geometryHash(floors: Floor[]) {
  return stableHash(JSON.stringify(floors.map((floor) => ({
    id: floor.id,
    spaces: floor.spaces.map((space) => ({
      id: space.id,
      type: space.type,
      bounds: space.bounds,
      perimeterOpen: space.type === "verandah" ? (space.perimeterOpen ?? true) : undefined,
    })),
    walls: floor.walls.map((wall) => ({ start: wall.start, end: wall.end, adjacent: wall.adjacentSpaceIds })),
    openings: floor.openings.map((opening) => ({ wallId: opening.wallId, kind: opening.kind, usage: opening.usage, connects: opening.connects, offset: opening.offsetMm, width: opening.widthMm })),
  }))));
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
  if (error.message.startsWith("PARTI_WING_CAPACITY:") || error.message.startsWith("PARTI_CIRCULATION_BUDGET:")) return error.message;
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
  relaxation: RelaxationAttempt,
  candidateOrdinal: number,
): Building {
  const { partiId } = relaxation;
  const hasUpperFloors = requirements.floors.length > 1;
  const coreBounds = hasUpperFloors ? partiStairAnchor(partiId, requirements, envelope) : undefined;
  const elevations = floorElevations(requirements.floors);
  const orderedFloors = [...requirements.floors].sort((left, right) => left.level - right.level);
  const floorProgramSignatures = orderedFloors.map((floor) => requirements.rooms
    .filter((room) => room.floorId === floor.id && room.type !== "circulation")
    .map((room) => room.type)
    .sort()
    .join("|"));
  const uniformFloorProgram = floorProgramSignatures.every((signature) => signature === floorProgramSignatures[0]);
  const floors: Floor[] = [];
  const projectedRegions: ReservedRegion[] = coreBounds ? [{
    id: "main-stair-reservation",
    bounds: coreBounds,
    sourceFloorId: orderedFloors[0].id,
    kind: "stair_core",
    buildability: "blocked",
  }] : [];
  for (const floorRequirement of orderedFloors) {
    const rooms = requirements.rooms.filter((room) => room.floorId === floorRequirement.id);
    const stairCore = coreBounds ? stairCandidateRoom(floorRequirement, coreBounds) : undefined;
    const usableArea = envelope.width * envelope.depth - (stairCore ? stairCore.bounds.width * stairCore.bounds.depth : 0);
    const minimumArea = rooms.reduce((sum, room) => sum + room.minAreaMm2, 0);
    if (minimumArea > usableArea) throw new BuildingGenerationError(
      "UNSUPPORTED_PROGRAM_TOPOLOGY",
      `${floorRequirement.label} needs ${(minimumArea / 1_000_000).toFixed(1)} m² of minimum room area but ${(usableArea / 1_000_000).toFixed(1)} m² remains after the stair core.`,
    );
    const requiredConnections = requirements.relationships
      .filter((relationship) => relationship.type === "must_connect")
      .filter((relationship) => rooms.some((room) => room.id === relationship.fromRoomId) && rooms.some((room) => room.id === relationship.toRoomId))
      .map((relationship) => [relationship.fromRoomId, relationship.toRoomId] as [string, string]);
    const entranceSide = entranceRoadSide(requirements.site);
    const generatorOptions = {
      envelope,
      rooms,
      floor: floorRequirement,
      seed: (requirements.seed ^ Math.imul(candidateOrdinal + 1, 0x9e3779b1) ^ Math.imul(floorRequirement.level + 1, 0x85ebca6b)) >>> 0,
      variant: candidateOrdinal,
      partiId,
      stairCore,
      reservedRegions: projectedRegions,
      formStrategy: requirements.architecture.formStrategy,
      requiredConnections,
      isTopFloor: floorRequirement.level === orderedFloors.at(-1)?.level,
      allowOpenSetback: uniformFloorProgram || floorRequirement.level === orderedFloors.at(-1)?.level,
      projectCourtVoid: requirements.rooms.some((room) => room.type === "courtyard")
        || projectedRegions.some((region) => region.kind === "court_void"),
      simplifiedCourt: relaxation.simplifiedCourt,
      entranceSide,
      roadEdges: requirements.site.roadEdges,
    };
    const candidate = generatePartiCandidate(generatorOptions);
    if (floorRequirement.level === 0 && !projectedRegions.some((region) => region.kind === "court_void")) {
      const court = candidate.cells.find((cell) => cell.type === "courtyard");
      if (court) projectedRegions.push({
        id: "ground-court-reservation",
        bounds: court.bounds,
        sourceFloorId: floorRequirement.id,
        kind: "court_void",
        buildability: "open_to_sky",
      });
    }
    const normalized = normalizeFloorTopology(candidate, envelope, elevations.get(floorRequirement.id) ?? 0);
    floors.push(placeFloorOpenings(normalized, {
      isGroundFloor: floorRequirement.level === 0,
      entranceSide,
      roadEdges: requirements.site.roadEdges,
      requiredConnections,
      accessSpineSpaceIds: candidate.accessSpineSpaceIds,
    }));
  }
  const hash = geometryHash(floors);
  const base: Building = {
    buildingSchemaVersion: 2,
    algorithmVersion: "topology-hybrid-v2.0.0",
    rulePackVersion: RULE_PACK_VERSION,
    rendererVersion: CAD_RENDERER_VERSION,
    seed: requirements.seed,
    candidate: {
      generatorId: partiId,
      index: candidateOrdinal,
      score: 0,
      geometryHash: hash,
      evidence: [],
      relaxation: { rung: relaxation.rung, id: relaxation.id, simplifiedCourt: relaxation.simplifiedCourt },
    },
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

type CandidateSearchOptions = {
  now: () => number;
  watchdogMs: number;
  candidatesPerPartiRung: number;
  stopAfterFirstFeasible: boolean;
};

type CandidateSearchResult = {
  feasible: GeneratedBuilding[];
  diagnostics: GenerationDiagnostics;
};

function isPartiId(value: string): value is PartiId {
  return value in PARTI_DEFINITIONS;
}

function timeoutError(diagnostics: GenerationDiagnostics) {
  return new BuildingGenerationError(
    "GENERATION_TIMEOUT",
    `Deterministic scheme generation exceeded its ${diagnostics.watchdogMs} ms watchdog; no partial schemes were returned.`,
    [],
    diagnostics,
  );
}

function searchCandidates(input: unknown, options: CandidateSearchOptions): CandidateSearchResult {
  const requirements = parseRequirements(input);
  const envelope = buildableEnvelope(requirements);
  const feasible: GeneratedBuilding[] = [];
  const rejectedFindings: ValidationFinding[] = [];
  const constructionRejections = new Map<string, number>();
  const seenGeometry = new Set<string>();
  const partis = selectEligiblePartis({
    formStrategy: requirements.architecture.formStrategy,
    climateClass: resolveRegionalPack(requirements.region.countryCode, requirements.region.adminArea).climateClass,
    envelope,
    floorCount: requirements.floors.length,
    rooms: requirements.rooms,
    seed: requirements.seed,
  });
  const ladder = buildRelaxationLadder(partis);
  const quotaPlan = buildDeterministicQuotaPlan(ladder, options.candidatesPerPartiRung);
  const quotaUsage: GenerationQuotaUsage[] = quotaPlan.map((quota) => ({ ...quota, attempted: 0 }));
  const plannedCandidateCount = quotaPlan.reduce((sum, quota) => sum + quota.quota, 0);
  const startedAt = options.now();
  let constructedCandidateCount = 0;
  let candidateIndex = 0;

  const diagnostics = (): GenerationDiagnostics => ({
    watchdogMs: options.watchdogMs,
    candidateCeiling: MAX_CONSTRUCTED_CANDIDATES,
    plannedCandidateCount,
    constructedCandidateCount,
    evaluatedCandidateCount: seenGeometry.size,
    quotaUsage: quotaUsage.map((usage) => ({ ...usage })),
  });
  const assertWithinWatchdog = () => {
    if (options.now() - startedAt >= options.watchdogMs) throw timeoutError(diagnostics());
  };

  search: for (const [quotaIndex, quota] of quotaPlan.entries()) {
    const relaxation = ladder.find((attempt) =>
      attempt.partiId === quota.partiId &&
      attempt.rung === quota.rung &&
      attempt.id === quota.relaxationId,
    );
    if (!relaxation) continue;
    for (let quotaOrdinal = 0; quotaOrdinal < quota.quota; quotaOrdinal += 1) {
      assertWithinWatchdog();
      quotaUsage[quotaIndex].attempted += 1;
      constructedCandidateCount += 1;
      let building: Building;
      try {
        building = generateCandidate(
          requirements,
          envelope,
          relaxation,
          candidateIndex,
        );
      } catch (error) {
        if (error instanceof BuildingGenerationError) throw error;
        const reason = constructionRejectionKey(error);
        constructionRejections.set(reason, (constructionRejections.get(reason) ?? 0) + 1);
        candidateIndex += 1;
        assertWithinWatchdog();
        continue;
      }
      candidateIndex += 1;
      assertWithinWatchdog();
      if (seenGeometry.has(building.candidate.geometryHash)) continue;
      seenGeometry.add(building.candidate.geometryHash);
      const validation = validateBuilding(building, requirements);
      assertWithinWatchdog();
      if (!validation.valid) {
        rejectedFindings.push(...validation.findings.filter((item) => item.severity === "error"));
        continue;
      }
      building.candidate.score = Number(softCandidateScore(building, validation, requirements).toFixed(6));
      building.candidate.evidence = climateOrientationEvidence(building, requirements).evidence;
      const parsed = buildingSchema.safeParse(building);
      if (!parsed.success) {
        constructionRejections.set("BUILDING_SCHEMA_REJECTED", (constructionRejections.get("BUILDING_SCHEMA_REJECTED") ?? 0) + 1);
        continue;
      }
      feasible.push({ building: parsed.data, validation, evaluatedCandidateCount: seenGeometry.size });
      if (options.stopAfterFirstFeasible) break search;
    }
  }

  const selected = feasible[0];
  if (!selected) {
    const conflicts = [...new Map(rejectedFindings.map((item) => [`${item.ruleId}:${item.objectIds.join("|")}`, item])).values()].slice(0, 12);
    const validationSummary = conflicts.length > 0
      ? ` Validation conflicts: ${conflicts.map((item) => `${item.ruleId}[${item.objectIds.join("|")}]${item.measured ? `=${item.measured.value}${item.measured.unit}` : ""}`).join(", ")}.`
      : "";
    throw new BuildingGenerationError(
      "NO_FEASIBLE_LAYOUT",
      conflicts.length > 0
        ? `No feasible plan was found after ${seenGeometry.size} unique candidates across ${ladder.length} bounded relaxation attempts. Required direct connections or hard topology rules remained unsatisfied.${validationSummary}${rejectionSummary(constructionRejections)}`
        : `No deterministic candidate could be constructed from ${ladder.length} bounded relaxation attempts.${rejectionSummary(constructionRejections)}`,
      conflicts,
    );
  }
  const finalDiagnostics = diagnostics();
  return {
    feasible: feasible.map((candidate) => ({ ...candidate, evaluatedCandidateCount: seenGeometry.size })),
    diagnostics: finalDiagnostics,
  };
}

/**
 * Stable, diversity-first selection. Exact geometry duplicates are removed before one candidate
 * per parti is selected; only then can a second candidate from an already represented parti fill
 * an unused slot.
 */
export function selectDistinctGeneratedSchemes(
  candidates: readonly GeneratedBuilding[],
  maximumSchemes = MAX_GENERATED_SCHEMES,
): GeneratedScheme[] {
  const limit = Math.max(0, Math.min(MAX_GENERATED_SCHEMES, Math.floor(maximumSchemes)));
  const geometryHashes = new Set<string>();
  const unique = [...candidates].sort((left, right) =>
    right.building.candidate.score - left.building.candidate.score ||
    left.building.candidate.generatorId.localeCompare(right.building.candidate.generatorId) ||
    left.building.candidate.index - right.building.candidate.index ||
    left.building.candidate.geometryHash.localeCompare(right.building.candidate.geometryHash),
  ).filter((candidate) => {
    const hash = candidate.building.candidate.geometryHash;
    if (geometryHashes.has(hash)) return false;
    geometryHashes.add(hash);
    return true;
  });
  const representedPartis = new Set<PartiId>();
  const admittedByParti = new Map<PartiId, GeneratedBuilding[]>();
  const diverse: GeneratedBuilding[] = [];
  const samePartiAlternatives: GeneratedBuilding[] = [];
  for (const candidate of unique) {
    const rawPartiId = candidate.building.candidate.generatorId;
    const partiId = isPartiId(rawPartiId) ? rawPartiId : "compact";
    if (representedPartis.has(partiId)) {
      const admitted = admittedByParti.get(partiId) ?? [];
      if (admitted.length > 0 && admitted.every((prior) => changedRoomQuadrantRatio(prior.building, candidate.building) >= 0.25)) {
        admitted.push(candidate);
        samePartiAlternatives.push(candidate);
      }
    }
    else {
      representedPartis.add(partiId);
      admittedByParti.set(partiId, [candidate]);
      diverse.push(candidate);
    }
  }
  return [...diverse, ...samePartiAlternatives].slice(0, limit).map((candidate, ordinal) => {
    const rawPartiId = candidate.building.candidate.generatorId;
    const partiId = isPartiId(rawPartiId) ? rawPartiId : "compact";
    const rawRung = candidate.building.candidate.relaxation?.rung;
    const rung: RelaxationAttempt["rung"] = rawRung === 1 || rawRung === 2 || rawRung === 3 ? rawRung : 0;
    const relaxationId = candidate.building.candidate.relaxation?.id ?? "preferred_parti";
    return {
      schemeId: `scheme-${stableHash(`${partiId}:${candidate.building.candidate.geometryHash}`)}`,
      partiId,
      name: defaultPartiName(partiId, ordinal),
      rationale: `${PARTI_DEFINITIONS[partiId].name} is the deterministic ${relaxationId.replaceAll("_", " ")} option at relaxation rung ${rung}.`,
      building: candidate.building,
      validation: candidate.validation,
      evidence: candidate.building.candidate.evidence ?? [],
      ladderRung: rung,
    };
  });
}

function roomQuadrants(building: Building) {
  const assignments = new Map<string, string>();
  for (const floor of building.floors) {
    const centerX = floor.envelope.x + floor.envelope.width / 2;
    const centerY = floor.envelope.y + floor.envelope.depth / 2;
    for (const space of floor.spaces) {
      if (!space.occupied || space.type === "circulation" || space.type === "courtyard" || space.type === "terrace") continue;
      const x = space.bounds.x + space.bounds.width / 2;
      const y = space.bounds.y + space.bounds.depth / 2;
      assignments.set(`${floor.id}:${space.id}`, `${y < centerY ? "N" : "S"}${x < centerX ? "W" : "E"}`);
    }
  }
  return assignments;
}

export function changedRoomQuadrantRatio(left: Building, right: Building) {
  const leftQuadrants = roomQuadrants(left);
  const rightQuadrants = roomQuadrants(right);
  const roomIds = new Set([...leftQuadrants.keys(), ...rightQuadrants.keys()]);
  if (roomIds.size === 0) return 0;
  let changed = 0;
  for (const roomId of roomIds) if (leftQuadrants.get(roomId) !== rightQuadrants.get(roomId)) changed += 1;
  return changed / roomIds.size;
}

export function generateBuildingSchemes(
  input: unknown,
  options: GenerateBuildingSchemesOptions = {},
): GeneratedSchemeSet {
  const result = searchCandidates(input, {
    now: options.now ?? Date.now,
    watchdogMs: options.watchdogMs ?? SCHEME_WATCHDOG_MS,
    candidatesPerPartiRung: options.candidatesPerPartiRung ?? CANDIDATES_PER_PARTI_RUNG,
    stopAfterFirstFeasible: false,
  });
  return {
    schemes: selectDistinctGeneratedSchemes(result.feasible),
    evaluatedCandidateCount: result.diagnostics.evaluatedCandidateCount,
    diagnostics: result.diagnostics,
  };
}

/** Compatibility facade for existing callers that expect one highest-priority feasible building. */
export function generateBuilding(input: unknown): GeneratedBuilding {
  const result = searchCandidates(input, {
    now: Date.now,
    watchdogMs: SCHEME_WATCHDOG_MS,
    candidatesPerPartiRung: 1,
    stopAfterFirstFeasible: true,
  });
  return result.feasible[0];
}
