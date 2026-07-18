import { AiProviderError, callJsonModeCompletion } from "@/lib/ai/client";
import { architecturalConcurrenceSchema, type ArchitecturalConcurrence, type ArchitecturalReviewResult } from "@/lib/ai/schema";
import type { CurrentBuildingRequirements, LegacyBuildingRequirements, ReadableBuildingRequirements } from "@/lib/building/requirements";
import type { CurrentBuilding, LegacyBuilding, ReadableBuilding } from "@/lib/building/schema";
import { orthogonalPolygonAreaMm2 } from "@/lib/building/orthogonal-partition";
import type { ValidationReport, ValidationReportV3 } from "@/lib/validation";

type ReviewBuildingInput =
  | { requirements: LegacyBuildingRequirements; building: LegacyBuilding; validation: ValidationReport }
  | { requirements: CurrentBuildingRequirements; building: CurrentBuilding; validation: ValidationReportV3 };

const SYSTEM_PROMPT = `You are an advisory architectural concurrence reviewer for a concept-stage residential plan that has already passed deterministic geometry, topology, opening, vertical-connectivity, and preliminary column-coordination validation.
Review circulation, adjacency, daylight, orientation, door/window logic, multi-storey stacking, and the supplied conceptual column/grid coordination evidence using only the structured evidence provided. Never change geometry and never claim licensed-architect, permit, structural, MEP, or code approval. Column evidence is a preliminary coordination aid only; never infer loads, member sizing, foundations, seismic safety, or construction readiness.
Every concern must cite exact evidenceIds and objectIds values from the payload. If ruleId is present, cite its matching finding evidence ID and only that finding's object IDs. If floorId is present, it must be an exact floorId from the drawing summary. Prefer zero to three strong concerns; do not manufacture a concern merely to fill the array. If no grounded concern remains after review, concur with an empty concern list.
Return only JSON: { "concurs": boolean, "confidence": "high|medium|low", "citedConcerns": [{ "ruleId"?: string, "floorId"?: string, "objectIds": string[], "evidenceIds": string[], "topic": "circulation|adjacency|daylight|orientation|opening|vertical_stacking|structural_coordination|other", "whyItMatters": string, "recommendation": string, "whatItSaves": string }], "requirementDeltas": [{ "op": "add_room|resize_room|remove_room", "summary": string, "roomId"?: string, "resizeDirection"?: "increase|decrease", "newRoom"?: { "id": string, "name": string, "type": string, "floorId": string, "privacy": string } }] }.
Never emit a coordinate, wall position, raw area, money value, or unsupported room/floor id.`;

function spaceAreaMm2(building: ReadableBuilding, floorId: string, spaceId: string) {
  const floor = building.floors.find((candidate) => candidate.id === floorId);
  if (!floor) return 0;
  if (building.buildingSchemaVersion === 3) {
    const currentFloor = building.floors.find((candidate) => candidate.id === floorId);
    const space = currentFloor?.spaces.find((candidate) => candidate.id === spaceId);
    const region = space ? currentFloor?.regions.find((candidate) => candidate.id === space.regionId) : undefined;
    return region ? orthogonalPolygonAreaMm2(region.polygon) : 0;
  }
  return building.floors.find((candidate) => candidate.id === floorId)?.spaces.find((candidate) => candidate.id === spaceId)?.areaMm2 ?? 0;
}

function spaceOccupied(building: ReadableBuilding, floorId: string, spaceId: string) {
  if (building.buildingSchemaVersion === 3) {
    const floor = building.floors.find((candidate) => candidate.id === floorId);
    const space = floor?.spaces.find((candidate) => candidate.id === spaceId);
    return space ? floor?.regions.find((candidate) => candidate.id === space.regionId)?.kind === "interior" : false;
  }
  return building.floors.find((candidate) => candidate.id === floorId)?.spaces.find((candidate) => candidate.id === spaceId)?.occupied ?? false;
}

function floorTopologySummary(building: ReadableBuilding) {
  return building.floors.map((floor) => ({
    floorId: floor.id,
    label: floor.label,
    rooms: floor.spaces.map((space) => ({
      id: space.id,
      type: space.type,
      areaM2: Number((spaceAreaMm2(building, floor.id, space.id) / 1_000_000).toFixed(1)),
      occupied: spaceOccupied(building, floor.id, space.id),
      accessible: space.accessible,
    })),
    openings: floor.openings.map((opening) => ({ id: opening.id, kind: opening.kind, usage: opening.usage, connects: opening.connects })),
  }));
}

function requirementsSummary(requirements: ReadableBuildingRequirements) {
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
    architecture: requirements.architecture,
  };
}

function drawingSummary(building: ReadableBuilding) {
  return building.floors.map((floor) => ({
    floorId: floor.id,
    label: floor.label,
    rooms: floor.spaces.map((space) => {
      const openings = floor.openings.filter((opening) => opening.connects.includes(space.id));
      return {
        evidenceId: `room:${space.id}`,
        roomId: space.id,
        type: space.type,
        areaM2: Number((spaceAreaMm2(building, floor.id, space.id) / 1_000_000).toFixed(1)),
        openingIds: openings.map((opening) => opening.id),
        exteriorOpeningIds: openings.filter((opening) => opening.connects.includes("EXTERIOR")).map((opening) => opening.id),
        connectedObjectIds: openings.flatMap((opening) => opening.connects.filter((id) => id !== space.id && id !== "EXTERIOR")),
      };
    }),
    openings: floor.openings.map((opening) => ({ evidenceId: `opening:${opening.id}`, id: opening.id, kind: opening.kind, usage: opening.usage, connects: opening.connects })),
  }));
}

function evidenceIdsFor(input: ReviewBuildingInput) {
  const ids = new Set<string>();
  for (const floor of input.building.floors) {
    for (const space of floor.spaces) ids.add(`room:${space.id}`);
    for (const opening of floor.openings) ids.add(`opening:${opening.id}`);
  }
  input.requirements.relationships.forEach((_, index) => ids.add(`relationship:${index}`));
  input.building.verticalConnectors.forEach((connector) => ids.add(`connector:${connector.id}`));
  input.building.structuralConcept?.columns.forEach((column) => ids.add(`column:${column.id}`));
  input.building.structuralConcept?.axes.forEach((axis) => ids.add(`grid:${axis.id}`));
  if (input.building.buildingSchemaVersion === 3) {
    input.building.floors.forEach((floor) => floor.regions.forEach((region) => ids.add(`region:${region.id}`)));
    input.building.roofSystems.forEach((roof) => ids.add(`roof:${roof.id}`));
    input.building.secondaryRoofSupports.forEach((support) => ids.add(`support:${support.id}`));
    input.building.edgeProtections.forEach((guard) => ids.add(`guard:${guard.id}`));
  }
  input.validation.findings.forEach((_, index) => ids.add(`finding:${index}`));
  return ids;
}

function isGroundedReview(
  review: ArchitecturalConcurrence,
  input: ReviewBuildingInput,
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
  for (const column of input.building.structuralConcept?.columns ?? []) objectIds.add(column.id);
  for (const axis of input.building.structuralConcept?.axes ?? []) objectIds.add(axis.id);
  if (input.building.buildingSchemaVersion === 3) {
    for (const floor of input.building.floors) for (const region of floor.regions) { objectIds.add(region.id); objectFloorIds.set(region.id, floor.id); }
    for (const roof of input.building.roofSystems) objectIds.add(roof.id);
    for (const support of input.building.secondaryRoofSupports) { objectIds.add(support.id); objectFloorIds.set(support.id, support.floorId); }
    for (const guard of input.building.edgeProtections) { objectIds.add(guard.id); objectFloorIds.set(guard.id, guard.floorId); }
  }
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
      if (["room", "opening", "connector", "column", "grid", "region", "roof", "support", "guard"].includes(kind) && !concern.objectIds.includes(value)) return false;
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

function retainGroundedReview(
  review: ArchitecturalConcurrence,
  input: ReviewBuildingInput,
) {
  const citedConcerns = review.citedConcerns.filter((concern) => isGroundedReview({
    concurs: true,
    confidence: review.confidence,
    citedConcerns: [concern],
    requirementDeltas: [],
  }, input));
  const requirementDeltas = review.requirementDeltas.filter((delta) => isGroundedReview({
    concurs: true,
    confidence: review.confidence,
    citedConcerns: [],
    requirementDeltas: [delta],
  }, input));
  const grounded = { ...review, citedConcerns, requirementDeltas };
  return isGroundedReview(grounded, input) ? grounded : undefined;
}

export async function reviewBuilding(
  input: ReviewBuildingInput,
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
    structuralConcept: input.building.structuralConcept ? {
      scope: input.building.structuralConcept.scope,
      disclaimer: input.building.structuralConcept.disclaimer,
      baselineMaxBayMm: input.building.structuralConcept.baselineMaxBayMm,
      axes: input.building.structuralConcept.axes.map((axis) => ({ evidenceId: `grid:${axis.id}`, id: axis.id, orientation: axis.direction === "x" ? "horizontal" : "vertical" })),
      bays: (["x", "y"] as const).flatMap((direction) => {
        const axes = input.building.structuralConcept!.axes.filter((axis) => axis.direction === direction).sort((left, right) => left.coordinateMm - right.coordinateMm);
        return axes.slice(1).map((axis, index) => ({ orientation: direction === "x" ? "horizontal" : "vertical", fromAxisId: axes[index].id, toAxisId: axis.id, bayMm: axis.coordinateMm - axes[index].coordinateMm }));
      }),
      columns: input.building.structuralConcept.columns.map((column) => ({ evidenceId: `column:${column.id}`, id: column.id, servedFloorIds: column.servedFloorIds })),
    } : null,
    physicalSystems: input.building.buildingSchemaVersion === 3 ? {
      regions: input.building.floors.flatMap((floor) => floor.regions.map((region) => ({ evidenceId: `region:${region.id}`, id: region.id, floorId: floor.id, kind: region.kind, spaceId: region.spaceId }))),
      roofs: input.building.roofSystems.map((roof) => ({ evidenceId: `roof:${roof.id}`, id: roof.id, kind: roof.kind, servesSpaceIds: roof.kind === "open_pergola" ? [roof.hostSpaceId] : roof.servesSpaceIds })),
      supports: input.building.secondaryRoofSupports.map((support) => ({ evidenceId: `support:${support.id}`, id: support.id, floorId: support.floorId, role: support.role, roofSystemIds: support.roofSystemIds })),
      guards: input.building.edgeProtections.map((guard) => ({ evidenceId: `guard:${guard.id}`, id: guard.id, floorId: guard.floorId, kind: guard.kind })),
      intentRealizations: input.building.intentRealizations,
    } : null,
  };

  let lastOutputError: string | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let raw: unknown;
    try {
      raw = await complete({
        systemPrompt: SYSTEM_PROMPT,
        userPayload: lastOutputError ? { ...userPayload, previousOutputError: lastOutputError } : userPayload,
        maxTokens: 1_800,
        timeoutMs: 20_000,
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
    const grounded = parsed.success ? retainGroundedReview(parsed.data, input) : undefined;
    if (grounded) return { status: "reviewed", review: grounded };
    lastOutputError = parsed.success
      ? "Every concern and requirement delta must cite only exact, supporting IDs from the supplied evidence."
      : parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ");
  }

  return { status: "unavailable", reason: "invalid_output" };
}
