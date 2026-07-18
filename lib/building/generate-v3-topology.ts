import { currentBuildingRequirementsSchema, type CurrentBuildingRequirements, type FormStrategy } from "@/lib/building/requirements";
import type { Rectangle } from "@/lib/building/schema";
import { createV3TopologySkeleton, type V3TopologySkeleton } from "@/lib/building/candidates/v3-topology";
import { evaluateV3Partis, V3_PARTI_DEFINITIONS, type V3PartiId } from "@/lib/building/partis";
import {
  compareSchemeTopologyFingerprints,
  fingerprintSchemeTopology,
  type SchemeTopologyFingerprint,
} from "@/lib/building/scheme-fingerprint";
import { PARTI_VARIATION_RETRIES } from "@/lib/building/v3-constants";
import { resolveRegionalPack } from "@/lib/design/regional-packs";

export const MAX_V3_TOPOLOGY_SCHEMES = 3;

export type V3TopologyRelaxation = {
  code: "PARTI_INFEASIBLE" | "SCHEME_NOT_DISTINCT" | "FEWER_DISTINCT_SCHEMES" | "TOPOLOGY_CONSTRUCTION_REJECTED";
  partiId?: V3PartiId;
  variant?: number;
  reason: string;
};

export type V3TopologyScheme = {
  schemeId: string;
  partiId: V3PartiId;
  name: string;
  rationale: string;
  topology: V3TopologySkeleton;
  fingerprint: SchemeTopologyFingerprint;
  evidence: string[];
};

export type SchemeSetMetric = {
  event: "v3_scheme_set_generated";
  schemaVersion: 1;
  formStrategy: FormStrategy;
  generatedCount: number;
  distinctCount: number;
  attemptedCount: number;
  duplicateRejectedCount: number;
  rejectedPartis: Array<{ partiId: V3PartiId; reason: string }>;
  fingerprints: string[];
  canaryGenerationSuccess: boolean;
};

export type V3TopologyDiagnostics = {
  contractVersion: "topology-stage-v3";
  fingerprintVersion: "scheme-topology-v1";
  variationRetriesPerParti: number;
  attemptedCount: number;
  generatedCount: number;
  distinctCount: number;
  duplicateRejectedCount: number;
  relaxations: V3TopologyRelaxation[];
  metric: SchemeSetMetric;
};

export type V3TopologySchemeSet = {
  contractVersion: "topology-stage-v3";
  schemes: V3TopologyScheme[];
  selectedSchemeId: string;
  diagnostics: V3TopologyDiagnostics;
};

export class V3TopologyGenerationError extends Error {
  constructor(
    readonly code: "INVALID_V3_REQUIREMENTS" | "NO_FEASIBLE_V3_TOPOLOGY",
    message: string,
    readonly diagnostics?: Partial<V3TopologyDiagnostics>,
  ) {
    super(message);
    this.name = "V3TopologyGenerationError";
  }
}

function buildableEnvelope(requirements: CurrentBuildingRequirements): Rectangle {
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

export function generateV3TopologySchemes(
  input: unknown,
  options: { maximumSchemes?: number; onMetric?: (metric: SchemeSetMetric) => void } = {},
): V3TopologySchemeSet {
  const parsed = currentBuildingRequirementsSchema.safeParse(input);
  if (!parsed.success) throw new V3TopologyGenerationError("INVALID_V3_REQUIREMENTS", "V3 topology generation requires valid schema-v3 requirements.");
  const requirements = parsed.data;
  const envelope = buildableEnvelope(requirements);
  const eligibility = evaluateV3Partis({
    requirements,
    climateClass: resolveRegionalPack(requirements.region.countryCode, requirements.region.adminArea).climateClass,
    envelope,
  });
  const limit = Math.max(1, Math.min(MAX_V3_TOPOLOGY_SCHEMES, Math.floor(options.maximumSchemes ?? MAX_V3_TOPOLOGY_SCHEMES)));
  const schemes: V3TopologyScheme[] = [];
  const relaxations: V3TopologyRelaxation[] = eligibility.rejected.map((rejection) => ({
    code: "PARTI_INFEASIBLE",
    partiId: rejection.partiId,
    reason: rejection.reason,
  }));
  let attemptedCount = 0;
  let duplicateRejectedCount = 0;

  for (const partiId of eligibility.eligible) {
    let accepted = false;
    for (let variant = 0; variant <= PARTI_VARIATION_RETRIES; variant += 1) {
      attemptedCount += 1;
      let topology: V3TopologySkeleton;
      try {
        topology = createV3TopologySkeleton({ requirements, envelope, partiId, variant });
      } catch (error) {
        relaxations.push({
          code: "TOPOLOGY_CONSTRUCTION_REJECTED",
          partiId,
          variant,
          reason: error instanceof Error ? error.message : "UNKNOWN_TOPOLOGY_CONSTRUCTION_ERROR",
        });
        continue;
      }
      const fingerprint = fingerprintSchemeTopology(topology);
      const duplicate = schemes.find((scheme) => compareSchemeTopologyFingerprints(scheme.fingerprint, fingerprint).nearDuplicate);
      if (duplicate) {
        duplicateRejectedCount += 1;
        relaxations.push({
          code: "SCHEME_NOT_DISTINCT",
          partiId,
          variant,
          reason: `Near-duplicate of ${duplicate.partiId} at adjacency Jaccard >= 0.90 and footprint IoU >= 0.85 with matching signatures.`,
        });
        continue;
      }
      const schemeId = `scheme-v3-${stableHash(`${partiId}:${fingerprint.hash}`)}`;
      schemes.push({
        schemeId,
        partiId,
        name: `${V3_PARTI_DEFINITIONS[partiId].name} · Scheme ${String.fromCharCode(64 + schemes.length + 1)}`,
        rationale: `${V3_PARTI_DEFINITIONS[partiId].name} preserves the ${V3_PARTI_DEFINITIONS[partiId].topology.replaceAll("_", " ")} topology with explicit road-side arrival reservations.`,
        topology,
        fingerprint,
        evidence: [
          `Explicit form ${requirements.architecture.formStrategy} was ranked before climate tie-breaks.`,
          `Main-entry wall run reserved on ${topology.foyerWallRunReservation.side} for ${topology.foyerWallRunReservation.minimumClearWidthMm} mm.`,
          topology.vehicleApertureReservation
            ? `Vehicle aperture reserved on ${topology.vehicleApertureReservation.side} for ${topology.vehicleApertureReservation.minimumClearWidthMm} mm.`
            : "No vehicle aperture was requested.",
        ],
      });
      accepted = true;
      break;
    }
    if (!accepted && !relaxations.some((item) => item.partiId === partiId)) {
      relaxations.push({ code: "TOPOLOGY_CONSTRUCTION_REJECTED", partiId, reason: "All bounded deterministic variants were rejected." });
    }
    if (schemes.length >= limit) break;
  }

  if (schemes.length === 0) throw new V3TopologyGenerationError(
    "NO_FEASIBLE_V3_TOPOLOGY",
    "No feasible, distinct v3 topology survived the bounded parti search.",
    { attemptedCount, relaxations },
  );
  if (schemes.length < limit) relaxations.push({
    code: "FEWER_DISTINCT_SCHEMES",
    reason: `Only ${schemes.length} honest distinct topology option${schemes.length === 1 ? "" : "s"} survived; duplicate padding is prohibited.`,
  });
  const metric: SchemeSetMetric = {
    event: "v3_scheme_set_generated",
    schemaVersion: 1,
    formStrategy: requirements.architecture.formStrategy,
    generatedCount: schemes.length,
    distinctCount: schemes.length,
    attemptedCount,
    duplicateRejectedCount,
    rejectedPartis: relaxations.flatMap((item) => item.partiId ? [{ partiId: item.partiId, reason: item.reason }] : []),
    fingerprints: schemes.map((scheme) => scheme.fingerprint.hash),
    canaryGenerationSuccess: schemes.length > 0,
  };
  options.onMetric?.(metric);
  return {
    contractVersion: "topology-stage-v3",
    schemes,
    selectedSchemeId: schemes[0].schemeId,
    diagnostics: {
      contractVersion: "topology-stage-v3",
      fingerprintVersion: "scheme-topology-v1",
      variationRetriesPerParti: PARTI_VARIATION_RETRIES,
      attemptedCount,
      generatedCount: schemes.length,
      distinctCount: schemes.length,
      duplicateRejectedCount,
      relaxations,
      metric,
    },
  };
}
