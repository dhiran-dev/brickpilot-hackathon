import { AiProviderError, callJsonModeCompletion } from "@/lib/ai/client";
import { architecturalConcurrenceSchema, type ArchitecturalConcurrence, type ArchitecturalReviewResult } from "@/lib/ai/schema";
import type { BuildingRequirements } from "@/lib/building/requirements";
import type { Building } from "@/lib/building/schema";
import type { ValidationReport } from "@/lib/validation";

const SYSTEM_PROMPT = `You are an advisory architectural concurrence reviewer for a concept-stage residential plan that has already passed deterministic geometry, topology, opening, and vertical-connectivity validation.
Review circulation, adjacency, daylight, orientation, door/window logic, and multi-storey stacking using only the structured evidence provided. Never change geometry and never claim licensed-architect, permit, structural, MEP, or code approval.
Every concern must cite exact evidenceIds and objectIds values from the payload. If ruleId is present, cite its matching finding evidence ID and only that finding's object IDs. If floorId is present, it must be an exact floorId from the drawing summary.
Return only JSON: { "concurs": boolean, "confidence": "high|medium|low", "citedConcerns": [{ "ruleId"?: string, "floorId"?: string, "objectIds": string[], "evidenceIds": string[], "topic": "circulation|adjacency|daylight|orientation|opening|vertical_stacking|other", "whyItMatters": string, "recommendation": string, "whatItSaves": string }], "requirementDeltas": [{ "op": "add_room|resize_room|remove_room", "summary": string, "roomId"?: string, "resizeDirection"?: "increase|decrease", "newRoom"?: { "id": string, "name": string, "type": string, "floorId": string, "privacy": string } }] }.
Never emit a coordinate, wall position, raw area, money value, or unsupported room/floor id.`;

function floorTopologySummary(building: Building) {
  return building.floors.map((floor) => ({
    floorId: floor.id,
    label: floor.label,
    rooms: floor.spaces.map((space) => ({
      id: space.id,
      type: space.type,
      areaM2: Number((space.areaMm2 / 1_000_000).toFixed(1)),
      occupied: space.occupied,
      accessible: space.accessible,
    })),
    openings: floor.openings.map((opening) => ({ id: opening.id, kind: opening.kind, usage: opening.usage, connects: opening.connects })),
  }));
}

function requirementsSummary(requirements: BuildingRequirements) {
  return {
    rooms: requirements.rooms.map((room) => ({
      id: room.id,
      type: room.type,
      floorId: room.floorId,
      privacy: room.privacy,
      preferredZone: room.preferredZone,
      mustBeExterior: room.mustBeExterior,
    })),
    relationships: requirements.relationships,
    household: requirements.household,
    facing: requirements.site.facing,
    roadEdges: requirements.site.roadEdges,
  };
}

function drawingSummary(building: Building) {
  return building.floors.map((floor) => ({
    floorId: floor.id,
    label: floor.label,
    rooms: floor.spaces.map((space) => {
      const openings = floor.openings.filter((opening) => opening.connects.includes(space.id));
      return {
        evidenceId: `room:${space.id}`,
        roomId: space.id,
        type: space.type,
        areaM2: Number((space.areaMm2 / 1_000_000).toFixed(1)),
        openingIds: openings.map((opening) => opening.id),
        exteriorOpeningIds: openings.filter((opening) => opening.connects.includes("EXTERIOR")).map((opening) => opening.id),
        connectedObjectIds: openings.flatMap((opening) => opening.connects.filter((id) => id !== space.id && id !== "EXTERIOR")),
      };
    }),
    openings: floor.openings.map((opening) => ({ evidenceId: `opening:${opening.id}`, id: opening.id, kind: opening.kind, usage: opening.usage, connects: opening.connects })),
  }));
}

function evidenceIdsFor(input: { requirements: BuildingRequirements; building: Building; validation: ValidationReport }) {
  const ids = new Set<string>();
  for (const floor of input.building.floors) {
    for (const space of floor.spaces) ids.add(`room:${space.id}`);
    for (const opening of floor.openings) ids.add(`opening:${opening.id}`);
  }
  input.requirements.relationships.forEach((_, index) => ids.add(`relationship:${index}`));
  input.building.verticalConnectors.forEach((connector) => ids.add(`connector:${connector.id}`));
  input.validation.findings.forEach((_, index) => ids.add(`finding:${index}`));
  return ids;
}

function isGroundedReview(
  review: ArchitecturalConcurrence,
  input: { requirements: BuildingRequirements; building: Building; validation: ValidationReport },
) {
  const floorIds = new Set(input.building.floors.map((floor) => floor.id));
  const objectIds = new Set<string>();
  const objectFloorIds = new Map<string, string>();
  for (const floor of input.building.floors) {
    for (const space of floor.spaces) { objectIds.add(space.id); objectFloorIds.set(space.id, floor.id); }
    for (const wall of floor.walls) { objectIds.add(wall.id); objectFloorIds.set(wall.id, floor.id); }
    for (const opening of floor.openings) { objectIds.add(opening.id); objectFloorIds.set(opening.id, floor.id); }
  }
  for (const connector of input.building.verticalConnectors) objectIds.add(connector.id);
  const ruleIds = new Set(input.validation.findings.map((finding) => finding.ruleId));
  const roomIds = new Set(input.requirements.rooms.map((room) => room.id));
  const validEvidenceIds = evidenceIdsFor(input);

  for (const concern of review.citedConcerns) {
    if (concern.objectIds.length === 0 || concern.objectIds.some((id) => !objectIds.has(id))) return false;
    if (concern.evidenceIds.some((id) => !validEvidenceIds.has(id))) return false;
    if (concern.floorId && !floorIds.has(concern.floorId)) return false;
    if (concern.floorId && concern.objectIds.some((id) => objectFloorIds.has(id) && objectFloorIds.get(id) !== concern.floorId)) return false;
    for (const evidenceId of concern.evidenceIds) {
      const [kind, value] = evidenceId.split(":", 2);
      if (["room", "opening", "connector"].includes(kind) && !concern.objectIds.includes(value)) return false;
      if (kind === "relationship") {
        const relationship = input.requirements.relationships[Number(value)];
        if (!relationship || !concern.objectIds.some((id) => id === relationship.fromRoomId || id === relationship.toRoomId)) return false;
      }
      if (kind === "finding") {
        const finding = input.validation.findings[Number(value)];
        if (!finding || (finding.objectIds.length > 0 && !concern.objectIds.some((id) => finding.objectIds.includes(id)))) return false;
      }
    }
    if (concern.ruleId) {
      if (!ruleIds.has(concern.ruleId)) return false;
      const matchingFindingIndexes = input.validation.findings.flatMap((finding, index) => finding.ruleId === concern.ruleId && (!concern.floorId || finding.floorId === concern.floorId) ? [index] : []);
      const matchingObjectIds = new Set(matchingFindingIndexes.flatMap((index) => input.validation.findings[index].objectIds));
      if (!matchingFindingIndexes.some((index) => concern.evidenceIds.includes(`finding:${index}`))) return false;
      if (concern.objectIds.some((id) => !matchingObjectIds.has(id))) return false;
    }
  }

  if (!review.concurs && review.citedConcerns.length === 0) return false;

  for (const delta of review.requirementDeltas) {
    if (delta.op === "add_room") {
      if (roomIds.has(delta.newRoom.id) || !floorIds.has(delta.newRoom.floorId)) return false;
    } else if (!roomIds.has(delta.roomId)) {
      return false;
    }
  }
  return true;
}

export async function reviewBuilding(
  input: { requirements: BuildingRequirements; building: Building; validation: ValidationReport },
  options: { complete?: typeof callJsonModeCompletion } = {},
): Promise<ArchitecturalReviewResult> {
  const complete = options.complete ?? callJsonModeCompletion;
  const userPayload = {
    requirements: requirementsSummary(input.requirements),
    validationFindings: input.validation.findings.map(({ ruleId, severity, category, floorId, objectIds, message, measured, required }, index) => ({
      evidenceId: `finding:${index}`,
      ruleId,
      severity,
      category,
      floorId,
      objectIds,
      message,
      measured,
      required,
    })),
    topology: floorTopologySummary(input.building),
    drawingSummary: drawingSummary(input.building),
    requirementRelationships: input.requirements.relationships.map((relationship, index) => ({ evidenceId: `relationship:${index}`, ...relationship })),
    verticalConnectors: input.building.verticalConnectors.map((connector) => ({ evidenceId: `connector:${connector.id}`, id: connector.id, kind: connector.kind, servedFloorIds: connector.servedFloorIds })),
  };

  let lastOutputError: string | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let raw: unknown;
    try {
      raw = await complete({
        systemPrompt: SYSTEM_PROMPT,
        userPayload: lastOutputError ? { ...userPayload, previousOutputError: lastOutputError } : userPayload,
        maxTokens: 1_200,
        timeoutMs: 12_000,
      });
    } catch (error) {
      if (error instanceof AiProviderError) {
        if ((error.reason === "invalid_json" || error.reason === "empty_response") && attempt === 0) {
          lastOutputError = "Return one complete JSON object only; the prior response was not valid JSON.";
          continue;
        }
        if (error.reason === "not_configured") return { status: "unavailable", reason: "not_configured" };
        if (error.reason === "timeout") return { status: "unavailable", reason: "timeout" };
        if (error.reason === "invalid_json" || error.reason === "empty_response") return { status: "unavailable", reason: "invalid_output" };
        return { status: "unavailable", reason: "http_error" };
      }
      return { status: "unavailable", reason: "http_error" };
    }

    const parsed = architecturalConcurrenceSchema.safeParse(raw);
    if (parsed.success && isGroundedReview(parsed.data, input)) return { status: "reviewed", review: parsed.data };
    lastOutputError = parsed.success
      ? "Every concern and requirement delta must cite only exact, supporting IDs from the supplied evidence."
      : parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ");
  }

  return { status: "unavailable", reason: "invalid_output" };
}
