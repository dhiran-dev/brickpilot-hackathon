import { currentBuildingRequirementsSchema, type CurrentBuildingRequirements } from "@/lib/building/requirements";
import { roomAreaDefaultsMm2 } from "@/lib/building/room-defaults";
import { allocateV3TopologyScheme, ProgramAreaInfeasibleError, type V3AllocatedScheme } from "@/lib/building/candidates/v3-allocation";
import type { ZonedAllocationRejection } from "@/lib/building/candidates/v3-zoned-allocation";
import { generateV3TopologySchemes, type V3TopologyDiagnostics } from "@/lib/building/generate-v3-topology";

export type V3AllocationDiagnostics = {
  contractVersion: "allocation-stage-v3";
  topology: V3TopologyDiagnostics;
  attemptedSchemeCount: number;
  allocatedSchemeCount: number;
  rejectedSchemes: Array<{
    topologySchemeId: string;
    code: "PROGRAM_AREA_INFEASIBLE";
    requirementIds: string[];
    planningDiagnostics?: {
      evaluatedCandidateCount: number;
      rejections: ZonedAllocationRejection[];
    };
  }>;
};

export type V3AllocationStageResult = {
  contractVersion: "allocation-stage-v3";
  schemes: V3AllocatedScheme[];
  selectedSchemeId: string;
  diagnostics: V3AllocationDiagnostics;
};

export class V3AllocationGenerationError extends Error {
  constructor(
    readonly code: "INVALID_V3_REQUIREMENTS" | "PROGRAM_AREA_INFEASIBLE",
    message: string,
    readonly requirementIds: string[] = [],
    readonly diagnostics?: Partial<V3AllocationDiagnostics>,
  ) {
    super(message);
    this.name = "V3AllocationGenerationError";
  }
}

/**
 * Schema-v3 accepts upgraded historical briefs that predate explicit stair rooms. A multi-floor
 * generator cannot treat the vertical preference as decorative metadata, so materialize one
 * inferred stair requirement on every served floor before topology and allocation.
 */
export function withRequiredV3VerticalCirculation(requirements: CurrentBuildingRequirements): CurrentBuildingRequirements {
  if (requirements.floors.length < 2) return requirements;
  const rooms = [...requirements.rooms];
  const relationships = [...requirements.relationships];
  for (const floor of [...requirements.floors].sort((left, right) => left.level - right.level)) {
    const existing = rooms.find((room) => room.floorId === floor.id && room.type === "stair");
    const stairId = existing?.id ?? `stair-f${floor.level}`;
    if (!existing) rooms.push({
      id: stairId,
      name: floor.level === 0 ? "Main stair" : `Main stair landing L${floor.level}`,
      type: "stair",
      floorId: floor.id,
      ...roomAreaDefaultsMm2("stair"),
      privacy: "semi_private",
      preferredZone: "center",
      mustBeExterior: false,
      accessible: false,
    });
    const circulation = rooms.find((room) => room.floorId === floor.id && room.type === "circulation");
    if (circulation && !relationships.some((relationship) => relationship.type === "must_connect"
      && new Set([relationship.fromRoomId, relationship.toRoomId]).has(stairId)
      && new Set([relationship.fromRoomId, relationship.toRoomId]).has(circulation.id))) {
      relationships.push({ type: "must_connect", fromRoomId: stairId, toRoomId: circulation.id });
    }
  }
  return currentBuildingRequirementsSchema.parse({ ...requirements, rooms, relationships });
}

export function generateV3AllocationStage(input: unknown): V3AllocationStageResult {
  const parsed = currentBuildingRequirementsSchema.safeParse(input);
  if (!parsed.success) throw new V3AllocationGenerationError("INVALID_V3_REQUIREMENTS", "V3 allocation requires valid schema-v3 requirements.");
  const requirements = withRequiredV3VerticalCirculation(parsed.data);
  const topology = generateV3TopologySchemes(requirements);
  const schemes: V3AllocatedScheme[] = [];
  const rejectedSchemes: V3AllocationDiagnostics["rejectedSchemes"] = [];
  for (const topologyScheme of topology.schemes) {
    try {
      schemes.push(allocateV3TopologyScheme(requirements, topologyScheme));
    } catch (error) {
      if (!(error instanceof ProgramAreaInfeasibleError)) throw error;
      rejectedSchemes.push({
        topologySchemeId: topologyScheme.schemeId,
        code: "PROGRAM_AREA_INFEASIBLE",
        requirementIds: error.requirementIds,
        ...(error.planningDiagnostics ? { planningDiagnostics: error.planningDiagnostics } : {}),
      });
    }
  }
  const diagnostics: V3AllocationDiagnostics = {
    contractVersion: "allocation-stage-v3",
    topology: topology.diagnostics,
    attemptedSchemeCount: topology.schemes.length,
    allocatedSchemeCount: schemes.length,
    rejectedSchemes,
  };
  if (schemes.length === 0) {
    const requirementIds = [...new Set(rejectedSchemes.flatMap((rejection) => rejection.requirementIds))];
    throw new V3AllocationGenerationError(
      "PROGRAM_AREA_INFEASIBLE",
      `No topology can fit the requested program within hard room-area bounds: ${requirementIds.join(", ")}.`,
      requirementIds,
      diagnostics,
    );
  }
  return {
    contractVersion: "allocation-stage-v3",
    schemes,
    selectedSchemeId: schemes[0].schemeId,
    diagnostics,
  };
}
