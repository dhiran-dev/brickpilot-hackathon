import { resolveRoomAreaPolicy } from "@/lib/building/area-policy-v3";
import { v3PhysicalGeometryFingerprint } from "@/lib/building/generate-v3-physical";
import type { CardinalDirection, CurrentBuildingRequirements } from "@/lib/building/requirements";
import {
  compareSchemeTopologyFingerprints,
  fingerprintSchemeTopology,
  type SchemeTopologyFingerprint,
  type SchemeTopologyInput,
} from "@/lib/building/scheme-fingerprint";
import type {
  CurrentBuilding,
  CurrentFloor,
  CurrentOpening,
  FloorRegion,
  OrthogonalPolygon,
  Point,
  Rectangle,
  RoofPlane,
  Segment2,
  WallSegment,
} from "@/lib/building/schema";
import {
  auditOrthogonalPartition,
  orthogonalPolygonAreaMm2,
  orthogonalPolygonBounds,
  residualRectangles,
} from "@/lib/building/orthogonal-partition";
import { evaluateRoofSupportCompleteness } from "@/lib/building/roofs";
import { v3WindowPolicy } from "@/lib/building/opening-policy-v3";
import {
  AREA_TOLERANCE_MM2,
  DEFAULT_GUARD_HEIGHT_MM,
  GUARD_TRIGGER_DROP_MM,
  MAIN_ENTRY_MIN_CLEAR_WIDTH_MM,
  VEHICLE_APERTURE_MIN_CLEAR_WIDTH_MM,
} from "@/lib/building/v3-constants";
import { findingV3, RULES } from "@/lib/validation/rules";
import type { ValidationFindingV3, ValidationReportV3, ValidationSeverity } from "@/lib/validation/types";

export const V3_RULE_PACK_VERSION = "residential-v3-2026.7";

export type ValidationCodeMetric = {
  event: "v3_validation_completed";
  schemaVersion: 1;
  rulePackVersion: typeof V3_RULE_PACK_VERSION;
  cohortId: string;
  valid: boolean;
  score: number;
  countsBySeverity: Record<ValidationSeverity, number>;
  countsByRuleCode: Record<string, Record<ValidationSeverity, number>>;
};

export type V3ValidationOptions = {
  cohortId?: string;
  onMetric?: (metric: ValidationCodeMetric) => void;
};

export type V3SchemeSetMember = { schemeId: string; building: CurrentBuilding };
export type V3ValidatedScheme = V3SchemeSetMember & {
  partiId: string;
  name: string;
  rationale: string;
  validation: ValidationReportV3;
  evidence: string[];
  ladderRung: number;
};
export type V3ValidationStageResult = {
  contractVersion: "validation-stage-v3";
  schemes: V3ValidatedScheme[];
  selectedSchemeId: string;
  building: CurrentBuilding;
  validation: ValidationReportV3;
  rejectedSchemes: Array<{ schemeId: string; findings: ValidationFindingV3[] }>;
  schemeSet: V3SchemeSetValidation;
};
export type V3SchemeSetValidation = {
  valid: boolean;
  findings: ValidationFindingV3[];
  fingerprints: Record<string, SchemeTopologyFingerprint>;
};

const EXTERIOR = "EXTERIOR";
const PRIVATE_ROOM_TYPES = new Set(["bedroom", "bathroom"]);
const OUTDOOR_ROOM_TYPES = new Set(["parking", "verandah"]);
const STACKED_SUPPORT_SPACE_TOKEN = "-stacked-support-space-";

function isStackedSupportSpace(spaceId: string) {
  return spaceId.includes(STACKED_SUPPORT_SPACE_TOKEN);
}

function segmentKey(segment: Segment2) {
  const points = [segment.start, segment.end].sort((left, right) => left.x - right.x || left.y - right.y);
  return `${points[0].x}:${points[0].y}:${points[1].x}:${points[1].y}`;
}

function wallSegment(wall: WallSegment): Segment2 {
  return { start: wall.start, end: wall.end };
}

function wallLength(wall: WallSegment) {
  return Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
}

function sideOfWall(wall: WallSegment, envelope: ReturnType<typeof orthogonalPolygonBounds>): CardinalDirection | undefined {
  if (wall.start.y === envelope.y && wall.end.y === envelope.y) return "north";
  if (wall.start.x === envelope.x + envelope.width && wall.end.x === envelope.x + envelope.width) return "east";
  if (wall.start.y === envelope.y + envelope.depth && wall.end.y === envelope.y + envelope.depth) return "south";
  if (wall.start.x === envelope.x && wall.end.x === envelope.x) return "west";
  return undefined;
}

function regionForSpace(floor: CurrentFloor, spaceId: string) {
  const space = floor.spaces.find((candidate) => candidate.id === spaceId);
  return space ? floor.regions.find((region) => region.id === space.regionId) : undefined;
}

function regionCentroid(region: FloorRegion): Point {
  const bounds = orthogonalPolygonBounds(region.polygon);
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.depth / 2 };
}

function pointOnSegment(point: Point, segment: Segment2, toleranceMm = 1) {
  const cross = (segment.end.x - segment.start.x) * (point.y - segment.start.y)
    - (segment.end.y - segment.start.y) * (point.x - segment.start.x);
  if (Math.abs(cross) > toleranceMm) return false;
  return point.x >= Math.min(segment.start.x, segment.end.x) - toleranceMm
    && point.x <= Math.max(segment.start.x, segment.end.x) + toleranceMm
    && point.y >= Math.min(segment.start.y, segment.end.y) - toleranceMm
    && point.y <= Math.max(segment.start.y, segment.end.y) + toleranceMm;
}

function pointInPolygon(point: Point, polygon: { points: Point[] }) {
  if (polygon.points.some((start, index) => pointOnSegment(point, { start, end: polygon.points[(index + 1) % polygon.points.length] }))) return true;
  let inside = false;
  for (let current = 0, previous = polygon.points.length - 1; current < polygon.points.length; previous = current, current += 1) {
    const a = polygon.points[current];
    const b = polygon.points[previous];
    if (((a.y > point.y) !== (b.y > point.y)) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function pointStrictlyInPolygon(point: Point, polygon: { points: Point[] }) {
  if (polygon.points.some((start, index) => pointOnSegment(point, { start, end: polygon.points[(index + 1) % polygon.points.length] }))) return false;
  let inside = false;
  for (let current = 0, previous = polygon.points.length - 1; current < polygon.points.length; previous = current, current += 1) {
    const a = polygon.points[current];
    const b = polygon.points[previous];
    if (((a.y > point.y) !== (b.y > point.y)) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function polygonArea(points: Point[]) {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
}

function signedDoubleArea(points: Point[]) {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
}

function report(findings: ValidationFindingV3[]): ValidationReportV3 {
  const ordered = [...findings].sort((left, right) => {
    const severity = { error: 0, warning: 1, info: 2 } as const;
    return severity[left.severity] - severity[right.severity]
      || left.ruleId.localeCompare(right.ruleId)
      || (left.floorId ?? "").localeCompare(right.floorId ?? "")
      || left.objectIds.join("|").localeCompare(right.objectIds.join("|"));
  });
  const counts = { error: 0, warning: 0, info: 0 } satisfies Record<ValidationSeverity, number>;
  for (const item of ordered) counts[item.severity] += 1;
  return {
    schemaVersion: "validation-report-v3",
    rulePackVersion: V3_RULE_PACK_VERSION,
    valid: counts.error === 0,
    score: Math.max(0, 100 - counts.error * 25 - counts.warning * 3 - counts.info),
    counts,
    findings: ordered,
  };
}

function coverageFindings(building: CurrentBuilding) {
  const findings: ValidationFindingV3[] = [];
  for (const floor of building.floors) {
    const audit = auditOrthogonalPartition(floor.envelope, floor.regions);
    if (audit.overlapAreaMm2 > AREA_TOLERANCE_MM2) findings.push(findingV3(
      RULES.geometryOverlap, "error", "geometry", "Canonical floor regions overlap.",
      { floorId: floor.id, objectIds: floor.regions.map((region) => region.id), measured: { value: audit.overlapAreaMm2, unit: "mm2" }, required: { max: AREA_TOLERANCE_MM2, unit: "mm2" } },
    ));
    if (audit.gapAreaMm2 > AREA_TOLERANCE_MM2) findings.push(findingV3(
      RULES.geometryGap, "error", "geometry", "Canonical floor regions do not partition the complete floor envelope.",
      { floorId: floor.id, objectIds: floor.regions.map((region) => region.id), measured: { value: audit.gapAreaMm2, unit: "mm2" }, required: { max: AREA_TOLERANCE_MM2, unit: "mm2" } },
    ));
    if (audit.outsideAreaMm2 > AREA_TOLERANCE_MM2) findings.push(findingV3(
      RULES.geometryEnvelope, "error", "geometry", "A canonical floor region falls outside its floor envelope.",
      { floorId: floor.id, objectIds: floor.regions.map((region) => region.id), measured: { value: audit.outsideAreaMm2, unit: "mm2" }, required: { max: AREA_TOLERANCE_MM2, unit: "mm2" } },
    ));
  }
  return findings;
}

function areaFindings(building: CurrentBuilding, requirements: CurrentBuildingRequirements) {
  const findings: ValidationFindingV3[] = [];
  for (const requirement of requirements.rooms) {
    const floor = building.floors.find((candidate) => candidate.id === requirement.floorId);
    const regions = floor?.regions.filter((region) => region.spaceId === requirement.id) ?? [];
    if (!floor || regions.length === 0) {
      findings.push(findingV3(
        RULES.roomMinimumArea, "error", "planning", `Requested room ${requirement.name} is missing from canonical geometry.`,
        { floorId: requirement.floorId, objectIds: [requirement.id] }, "requirement_and_geometry",
      ));
      continue;
    }
    const policy = resolveRoomAreaPolicy({
      requirements,
      room: requirement,
      usableFloorAreaMm2: orthogonalPolygonAreaMm2(floor.envelope),
    });
    const area = regions.reduce((sum, region) => sum + orthogonalPolygonAreaMm2(region.polygon), 0);
    if (area < policy.minimumAreaMm2) findings.push(findingV3(
      RULES.roomMinimumArea, "error", "planning", `${requirement.name} is below its minimum area.`,
      { floorId: floor.id, objectIds: [requirement.id, ...regions.map((region) => region.id)], measured: { value: area, unit: "mm2" }, required: { min: policy.minimumAreaMm2, unit: "mm2" } }, "requirement_and_geometry",
    ));
    if (area > policy.warningMaximumAreaMm2) {
      const hard = area > policy.hardMaximumAreaMm2;
      findings.push(findingV3(
        RULES.areaTargetExceeded,
        hard ? "error" : "warning",
        "planning",
        `${requirement.name} exceeds its ${hard ? "hard" : "warning"} area maximum.`,
        { floorId: floor.id, objectIds: [requirement.id, ...regions.map((region) => region.id)], measured: { value: area, unit: "mm2" }, required: { max: hard ? policy.hardMaximumAreaMm2 : policy.warningMaximumAreaMm2, unit: "mm2" } },
        "requirement_and_geometry",
      ));
    }
  }
  return findings;
}

function openingAndAccessFindings(building: CurrentBuilding, requirements: CurrentBuildingRequirements) {
  const findings: ValidationFindingV3[] = [];
  const floorsById = new Map(building.floors.map((floor) => [floor.id, floor]));
  const allSpaces = new Map(building.floors.flatMap((floor) => floor.spaces.map((space) => [space.id, space] as const)));
  const allOpenings = building.floors.flatMap((floor) => floor.openings);
  for (const floor of building.floors) {
    const spaces = new Set(floor.spaces.map((space) => space.id));
    for (const opening of floor.openings) {
      const wall = floor.walls.find((candidate) => candidate.id === opening.wallId);
      const connected = opening.connects.filter((id) => id !== EXTERIOR);
      if (!wall || opening.offsetMm < 0 || opening.offsetMm + opening.widthMm > (wall ? wallLength(wall) : 0)
        || connected.some((id) => !spaces.has(id) || !wall.adjacentSpaceIds.includes(id))) findings.push(findingV3(
        RULES.openingOnWall, "error", "opening", "Opening geometry or connectivity does not match its authoritative wall.",
        { floorId: floor.id, objectIds: [opening.id, opening.wallId, ...connected] },
      ));
    }
  }
  for (const window of allOpenings.filter((opening) => opening.kind === "window")) {
    const floor = floorsById.get(window.floorId);
    const wall = floor?.walls.find((candidate) => candidate.id === window.wallId);
    const connectedSpaceId = window.connects.find((id) => id !== EXTERIOR);
    if (!floor || !wall || wall.type !== "exterior" || window.usage !== "daylight"
      || !window.connects.includes(EXTERIOR) || !connectedSpaceId || !wall.adjacentSpaceIds.includes(connectedSpaceId)) {
      findings.push(findingV3(
        RULES.windowExterior, "error", "opening", "A daylight window must bind an enclosed space to an authoritative exterior wall.",
        { floorId: window.floorId, objectIds: [window.id, window.wallId, ...(connectedSpaceId ? [connectedSpaceId] : [])] },
      ));
    }
  }
  for (const requirement of requirements.rooms.filter((room) => room.mustBeExterior && v3WindowPolicy(room.type))) {
    const daylight = allOpenings.find((opening) => opening.kind === "window"
      && opening.usage === "daylight"
      && opening.floorId === requirement.floorId
      && opening.connects.includes(EXTERIOR)
      && opening.connects.includes(requirement.id));
    if (!daylight) findings.push(findingV3(
      RULES.daylight, "error", "planning", `${requirement.name} requires a canonical exterior daylight window.`,
      { floorId: requirement.floorId, objectIds: [requirement.id] }, "requirement_and_geometry",
    ));
  }
  const mainEntries = allOpenings.filter((opening) => opening.role === "main_entry");
  if (mainEntries.length !== 1) findings.push(findingV3(
    RULES.mainEntryMissing, "error", "circulation", "A building must contain exactly one canonical main entry.",
    { objectIds: mainEntries.map((opening) => opening.id), measured: { value: mainEntries.length, unit: "count" }, required: { min: 1, max: 1, unit: "count" } },
  ));
  const main = mainEntries[0];
  if (main && main.widthMm < MAIN_ENTRY_MIN_CLEAR_WIDTH_MM) findings.push(findingV3(
    RULES.mainEntryTooNarrow, "error", "accessibility", "The main-entry clear width is below the concept minimum.",
    { floorId: main.floorId, objectIds: [main.id], measured: { value: main.widthMm, unit: "mm" }, required: { min: MAIN_ENTRY_MIN_CLEAR_WIDTH_MM, unit: "mm" } },
  ));
  if (main) {
    const floor = floorsById.get(main.floorId);
    const wall = floor?.walls.find((candidate) => candidate.id === main.wallId);
    const side = wall && sideOfWall(wall, orthogonalPolygonBounds(floor!.envelope));
    if (!side || !building.site.roadEdges.includes(side)) findings.push(findingV3(
      RULES.mainEntryNotRoadSide, "error", "planning", "The actual main-entry opening is not on a feasible configured road side.",
      { floorId: main.floorId, objectIds: [main.id, main.wallId], suggestedAction: "Move the main entry and primary facade to a road-facing exterior wall." }, "requirement_and_geometry",
    ));
  }
  const pedestrianEntries = allOpenings.filter((opening) => opening.usage === "pedestrian" && opening.connects.includes(EXTERIOR));
  if (pedestrianEntries.length > requirements.maxExteriorPedestrianEntryCount) findings.push(findingV3(
    RULES.exteriorEntryCountExceeded, "error", "circulation", "Exterior pedestrian entry count exceeds the explicit maximum.",
    { objectIds: pedestrianEntries.map((opening) => opening.id), measured: { value: pedestrianEntries.length, unit: "count" }, required: { max: requirements.maxExteriorPedestrianEntryCount, unit: "count" } }, "requirement_and_geometry",
  ));
  for (const opening of allOpenings.filter((candidate) => candidate.usage === "pedestrian")) {
    const connectedSpaces = opening.connects.map((id) => allSpaces.get(id)).filter(Boolean);
    if (connectedSpaces.some((space) => PRIVATE_ROOM_TYPES.has(space!.type))
      && (opening.connects.includes(EXTERIOR) || connectedSpaces.some((space) => OUTDOOR_ROOM_TYPES.has(space!.type)))) {
      findings.push(findingV3(
        RULES.privateRoomExteriorExposure, "error", "circulation", "A private room has direct exterior, parking, or verandah access.",
        { floorId: opening.floorId, objectIds: [opening.id, ...opening.connects.filter((id) => id !== EXTERIOR)] },
      ));
    }
  }
  const parkingSpaces = [...allSpaces.values()].filter((space) => space.type === "parking");
  for (const parking of parkingSpaces) {
    const vehicle = allOpenings.find((opening) => opening.role === "vehicle_entry"
      && opening.usage === "vehicle"
      && opening.connects.includes(EXTERIOR)
      && opening.connects.includes(parking.id)
      && opening.widthMm >= VEHICLE_APERTURE_MIN_CLEAR_WIDTH_MM);
    if (!vehicle) findings.push(findingV3(
      RULES.parkingVehicleAccessMissing, "error", "circulation", "Covered parking lacks an explicit vehicle-width road aperture.",
      { floorId: parking.floorId, objectIds: [parking.id], required: { min: VEHICLE_APERTURE_MIN_CLEAR_WIDTH_MM, unit: "mm" } },
    ));
  }
  for (const opening of allOpenings.filter((candidate) => candidate.usage === "pedestrian")) {
    const spaces = opening.connects.map((id) => allSpaces.get(id)).filter(Boolean);
    if (spaces.some((space) => space!.accessible) && opening.widthMm < 900) findings.push(findingV3(
      RULES.accessibilityClearance, "error", "accessibility", "An accessible route opening is narrower than 900 mm.",
      { floorId: opening.floorId, objectIds: [opening.id], measured: { value: opening.widthMm, unit: "mm" }, required: { min: 900, unit: "mm" } }, "baseline_heuristic",
    ));
  }
  const connectorFloorIds = new Set(building.verticalConnectors.flatMap((connector) => connector.servedFloorIds));
  for (const floor of building.floors) {
    const adjacency = new Map<string, Set<string>>();
    const connect = (left: string, right: string) => {
      adjacency.set(left, new Set([...(adjacency.get(left) ?? []), right]));
      adjacency.set(right, new Set([...(adjacency.get(right) ?? []), left]));
    };
    for (const opening of floor.openings.filter((candidate) => candidate.usage === "pedestrian" && candidate.kind !== "window")) {
      connect(opening.connects[0], opening.connects[1]);
    }
    const starts = floor.level === 0
      ? [EXTERIOR]
      : connectorFloorIds.has(floor.id)
        ? floor.spaces.filter((space) => space.type === "stair").map((space) => space.id)
        : [];
    const reached = new Set<string>();
    const queue = [...starts];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      if (reached.has(current)) continue;
      reached.add(current);
      queue.push(...[...(adjacency.get(current) ?? [])].filter((id) => !reached.has(id)));
    }
    for (const space of floor.spaces.filter((candidate) =>
      !isStackedSupportSpace(candidate.id)
      && !["parking", "courtyard", "terrace"].includes(candidate.type))) {
      if (!reached.has(space.id)) findings.push(findingV3(
        RULES.reachable, "error", "circulation", `${space.name} is not reachable through canonical pedestrian openings.`,
        { floorId: floor.id, objectIds: [space.id] },
      ));
    }
  }
  return findings;
}

function stackedSupportFindings(building: CurrentBuilding) {
  const ordered = [...building.floors].sort((left, right) => left.level - right.level || left.id.localeCompare(right.id));
  const findings: ValidationFindingV3[] = [];
  for (let upperIndex = 1; upperIndex < ordered.length; upperIndex += 1) {
    const lower = ordered[upperIndex - 1];
    const upper = ordered[upperIndex];
    const lowerVoids = lower.regions.filter((region) =>
      region.kind === "open_to_sky" || region.kind === "intentional_unbuilt");
    const upperConstructed = upper.regions.filter((region) =>
      region.kind === "interior" || region.kind === "covered_outdoor");
    for (const upperRegion of upperConstructed) for (const lowerVoid of lowerVoids) {
      const upperBounds = orthogonalPolygonBounds(upperRegion.polygon);
      const lowerBounds = orthogonalPolygonBounds(lowerVoid.polygon);
      const x = Math.max(upperBounds.x, lowerBounds.x);
      const y = Math.max(upperBounds.y, lowerBounds.y);
      const right = Math.min(upperBounds.x + upperBounds.width, lowerBounds.x + lowerBounds.width);
      const bottom = Math.min(upperBounds.y + upperBounds.depth, lowerBounds.y + lowerBounds.depth);
      const overlapWidthMm = Math.max(0, right - x);
      const overlapDepthMm = Math.max(0, bottom - y);
      const overlapAreaMm2 = overlapWidthMm * overlapDepthMm;
      if (overlapAreaMm2 <= AREA_TOLERANCE_MM2) continue;
      findings.push(findingV3(
        RULES.floatingVolume,
        "error",
        "vertical",
        "An upper-floor region projects over an open cell on the floor immediately below.",
        {
          floorId: upper.id,
          objectIds: [upperRegion.id, lowerVoid.id],
          measured: { value: overlapAreaMm2, unit: "mm2" },
          required: { max: AREA_TOLERANCE_MM2, unit: "mm2" },
          suggestedAction: "Keep the upper region over constructed volume and preserve the lower open area as a continuous vertical void.",
        },
        "requirement_and_geometry",
      ));
    }
  }
  return findings;
}

function planeIsValid(plane: RoofPlane) {
  if (plane.vertices.length < 3) return false;
  const [a, b, c] = plane.vertices;
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const normal = {
    x: ab.y * ac.z - ab.z * ac.y,
    y: ab.z * ac.x - ab.x * ac.z,
    z: ab.x * ac.y - ab.y * ac.x,
  };
  const magnitude = Math.hypot(normal.x, normal.y, normal.z);
  if (magnitude === 0) return false;
  return plane.vertices.every((point) => Math.abs(
    normal.x * (point.x - a.x) + normal.y * (point.y - a.y) + normal.z * (point.z - a.z),
  ) / magnitude <= 1);
}

function roofFindings(building: CurrentBuilding, requirements: CurrentBuildingRequirements) {
  const findings: ValidationFindingV3[] = [];
  const enclosureRoofs = building.roofSystems.filter((roof) => roof.kind !== "open_pergola");
  const requestedRoof = requirements.roof.value;
  const realizesRoof = requestedRoof === "mixed"
    || (requestedRoof === "sloped" && enclosureRoofs.some((roof) => roof.kind === "gable" || roof.kind === "hip" || roof.kind === "shed"))
    || (requestedRoof === "flat_parapet" && enclosureRoofs.every((roof) => roof.kind === "flat_slab" || roof.kind === "solid_canopy"));
  if (!realizesRoof) findings.push(findingV3(
    RULES.roofIntentNotRealized, "error", "architecture", "The requested roof character is not present in canonical roof geometry.",
    { objectIds: enclosureRoofs.map((roof) => roof.id) }, "requirement_and_geometry",
  ));
  for (const roof of enclosureRoofs) {
    const projected = roof.planes.map((plane) => ({ points: plane.vertices.map(({ x, y }) => ({ x, y })) }));
    const projectionArea = projected.reduce((sum, polygon) => sum + polygonArea(polygon.points), 0);
    const footprintArea = orthogonalPolygonAreaMm2(roof.footprint);
    const geometryValid = roof.planes.every(planeIsValid)
      && projected.every((polygon) => signedDoubleArea(polygon.points) < 0)
      && projected.every((polygon) => polygon.points.every((point) => pointInPolygon(point, roof.footprint)))
      && Math.abs(projectionArea - footprintArea) <= AREA_TOLERANCE_MM2;
    if (!geometryValid) findings.push(findingV3(
      RULES.roofGeometryInvalid, "error", "geometry", "Roof planes are non-planar, outside the footprint, overlapping, or incomplete in projection.",
      { objectIds: [roof.id, ...roof.planes.map((plane) => plane.id)], measured: { value: projectionArea, unit: "mm2" }, required: { min: footprintArea - AREA_TOLERANCE_MM2, max: footprintArea + AREA_TOLERANCE_MM2, unit: "mm2" } },
    ));
    const bounds = orthogonalPolygonBounds(roof.footprint);
    if (bounds.x - roof.overhangMm < 0 || bounds.y - roof.overhangMm < 0
      || bounds.x + bounds.width + roof.overhangMm > building.site.widthMm
      || bounds.y + bounds.depth + roof.overhangMm > building.site.depthMm) findings.push(findingV3(
      RULES.roofSiteBoundaryConflict, "error", "site", "Roof footprint and overhang extend outside the modeled site boundary.",
      { objectIds: [roof.id] },
    ));
  }
  const orderedFloors = [...building.floors].sort((left, right) => left.level - right.level || left.id.localeCompare(right.id));
  for (const floor of orderedFloors) {
    const immediateUpper = orderedFloors.find((candidate) => candidate.level === floor.level + 1);
    const upperBounds = immediateUpper?.regions
      .filter((region) => region.kind === "interior" || region.kind === "covered_outdoor")
      .map((region) => orthogonalPolygonBounds(region.polygon)) ?? [];
    for (const region of floor.regions.filter((candidate) =>
      candidate.kind === "interior" || candidate.kind === "covered_outdoor")) {
      const spaceId = region.spaceId;
      if (!spaceId) continue;
      const regionBounds = orthogonalPolygonBounds(region.polygon);
      const clipToRegion = (bounds: ReturnType<typeof orthogonalPolygonBounds>) => {
        const x = Math.max(regionBounds.x, bounds.x);
        const y = Math.max(regionBounds.y, bounds.y);
        const right = Math.min(regionBounds.x + regionBounds.width, bounds.x + bounds.width);
        const bottom = Math.min(regionBounds.y + regionBounds.depth, bounds.y + bounds.depth);
        return right > x && bottom > y ? { x, y, width: right - x, depth: bottom - y } : undefined;
      };
      const exposedFragments = residualRectangles(
        regionBounds,
        upperBounds.map(clipToRegion).filter((bounds): bounds is Rectangle => Boolean(bounds)),
      );
      const coveringRoofs = building.roofSystems.filter((roof) =>
        roof.kind === "open_pergola"
          ? region.kind === "covered_outdoor" && roof.hostSpaceId === spaceId
          : roof.servesSpaceIds.includes(spaceId));
      const uncoveredAreaMm2 = exposedFragments.reduce((sum, fragment) => {
        const clippedRoofs = coveringRoofs
          .map((roof) => {
            const roofBounds = orthogonalPolygonBounds(roof.footprint);
            const x = Math.max(fragment.x, roofBounds.x);
            const y = Math.max(fragment.y, roofBounds.y);
            const right = Math.min(fragment.x + fragment.width, roofBounds.x + roofBounds.width);
            const bottom = Math.min(fragment.y + fragment.depth, roofBounds.y + roofBounds.depth);
            return right > x && bottom > y ? { x, y, width: right - x, depth: bottom - y } : undefined;
          })
          .filter((bounds): bounds is Rectangle => Boolean(bounds));
        return sum + residualRectangles(fragment, clippedRoofs)
          .reduce((fragmentSum, rectangle) => fragmentSum + rectangle.width * rectangle.depth, 0);
      }, 0);
      if (uncoveredAreaMm2 <= AREA_TOLERANCE_MM2) continue;
      findings.push(findingV3(
        RULES.roofGeometryInvalid,
        "error",
        "geometry",
        "An exposed constructed floor region is missing complete roof coverage.",
        {
          floorId: floor.id,
          objectIds: [region.id, ...coveringRoofs.map((roof) => roof.id)],
          measured: { value: uncoveredAreaMm2, unit: "mm2" },
          required: { max: AREA_TOLERANCE_MM2, unit: "mm2" },
        },
        "requirement_and_geometry",
      ));
    }
  }
  const supportIssues = evaluateRoofSupportCompleteness({
    roofSystems: building.roofSystems,
    roofSupportReferences: building.roofSupportReferences,
    secondaryRoofSupports: building.secondaryRoofSupports,
    structuralConcept: building.structuralConcept,
    walls: building.floors.flatMap((floor) => floor.walls),
  });
  for (const issue of supportIssues) findings.push(findingV3(
    RULES.roofSupportIncomplete, "error", "structure", `Roof support is incomplete: ${issue.code}.`,
    { objectIds: [issue.roofSystemId], measured: { value: issue.measuredMm, unit: "mm" }, required: { max: issue.requiredMm, unit: "mm" } },
  ));
  return findings;
}

function supportClearanceFindings(building: CurrentBuilding) {
  const findings: ValidationFindingV3[] = [];
  for (const support of building.secondaryRoofSupports.filter((candidate) => candidate.role !== "ledger")) {
    const floor = building.floors.find((candidate) => candidate.id === support.floorId);
    if (!floor) continue;
    const circulationConflict = floor.spaces.find((space) => {
      if (space.type !== "circulation" && space.type !== "parking") return false;
      const region = regionForSpace(floor, space.id);
      return region ? pointStrictlyInPolygon(support.geometry, region.polygon) : false;
    });
    if (circulationConflict) findings.push(findingV3(
      RULES.supportClearanceConflict, "error", "structure", "A roof post obstructs a parking or circulation clear zone.",
      { floorId: floor.id, objectIds: [support.id, circulationConflict.id] },
    ));
    for (const opening of floor.openings) {
      const wall = floor.walls.find((candidate) => candidate.id === opening.wallId);
      if (!wall || !pointOnSegment(support.geometry, wallSegment(wall))) continue;
      const wallSpan = wallLength(wall);
      const supportOffset = wallSpan === 0 ? 0 : Math.hypot(support.geometry.x - wall.start.x, support.geometry.y - wall.start.y);
      if (supportOffset + support.sectionMm.x / 2 >= opening.offsetMm
        && supportOffset - support.sectionMm.x / 2 <= opening.offsetMm + opening.widthMm) findings.push(findingV3(
        RULES.supportClearanceConflict, "error", "structure", "A roof post obstructs a door or vehicle aperture.",
        { floorId: floor.id, objectIds: [support.id, opening.id, wall.id] },
      ));
    }
  }
  for (const column of building.structuralConcept.columns) for (const floor of building.floors.filter((candidate) => column.servedFloorIds.includes(candidate.id))) {
    for (const opening of floor.openings) {
      const wall = floor.walls.find((candidate) => candidate.id === opening.wallId);
      if (!wall || !pointOnSegment(column.center, wallSegment(wall))) continue;
      const offset = Math.hypot(column.center.x - wall.start.x, column.center.y - wall.start.y);
      if (offset + column.widthMm / 2 >= opening.offsetMm && offset - column.widthMm / 2 <= opening.offsetMm + opening.widthMm) findings.push(findingV3(
        RULES.structuralColumnClearance, "error", "structure", "A primary conceptual column obstructs an opening.",
        { floorId: floor.id, objectIds: [column.id, opening.id] },
      ));
    }
  }
  return findings;
}

function edgeProtectionFindings(building: CurrentBuilding) {
  const findings: ValidationFindingV3[] = [];
  const protectionKeys = new Set(building.edgeProtections.map((protection) => `${protection.floorId}:${segmentKey(protection.edge)}`));
  for (const floor of building.floors.filter((candidate) => candidate.elevationMm >= GUARD_TRIGGER_DROP_MM)) {
    const exposedSpaceIds = new Set(floor.spaces.filter((space) => ["balcony", "verandah", "terrace"].includes(space.type)).map((space) => space.id));
    const openingWallIds = new Set(floor.openings.filter((opening) => opening.usage === "pedestrian").map((opening) => opening.wallId));
    for (const wall of floor.walls.filter((candidate) => candidate.type === "exterior"
      && candidate.adjacentSpaceIds.some((id) => exposedSpaceIds.has(id))
      && !openingWallIds.has(candidate.id))) {
      const protection = building.edgeProtections.find((candidate) => candidate.floorId === floor.id && segmentKey(candidate.edge) === segmentKey(wallSegment(wall)));
      if (!protection || protection.heightMm < DEFAULT_GUARD_HEIGHT_MM || protection.dropHeightMm < GUARD_TRIGGER_DROP_MM) findings.push(findingV3(
        RULES.edgeProtectionMissing, "error", "safety", "An elevated balcony, terrace, or verandah edge lacks compliant concept-stage protection.",
        { floorId: floor.id, objectIds: [wall.id, ...(protection ? [protection.id] : [])], required: { min: DEFAULT_GUARD_HEIGHT_MM, unit: "mm" } },
      ));
    }
  }
  for (const protection of building.edgeProtections) {
    if (!protectionKeys.has(`${protection.floorId}:${segmentKey(protection.edge)}`)) continue;
    if (protection.dropHeightMm >= GUARD_TRIGGER_DROP_MM && protection.heightMm < DEFAULT_GUARD_HEIGHT_MM) findings.push(findingV3(
      RULES.edgeProtectionMissing, "error", "safety", "Modeled edge protection is below the minimum guard height.",
      { floorId: protection.floorId, objectIds: [protection.id], measured: { value: protection.heightMm, unit: "mm" }, required: { min: DEFAULT_GUARD_HEIGHT_MM, unit: "mm" } },
    ));
  }
  return findings;
}

function shadeAndFacadeFindings(building: CurrentBuilding, requirements: CurrentBuildingRequirements) {
  const findings: ValidationFindingV3[] = [];
  for (const requirement of requirements.shadeStructures) {
    const expectedTypes = requirement.location === "parking"
      ? new Set(["parking"])
      : requirement.location === "verandah"
        ? new Set(["verandah"])
        : requirement.location === "terrace"
          ? new Set(["terrace", "balcony"])
          : new Set(["foyer", "living"]);
    const spaceType = new Map(building.floors.flatMap((floor) => floor.spaces.map((space) => [space.id, space.type] as const)));
    const realized = building.roofSystems.find((roof) => {
      if (roof.id !== requirement.id || roof.kind !== requirement.type) return false;
      const hosts = roof.kind === "open_pergola" ? [roof.hostSpaceId].filter(Boolean) : roof.servesSpaceIds;
      return hosts.some((id) => expectedTypes.has(spaceType.get(id as string) ?? ""));
    });
    if (!realized) findings.push(findingV3(
      RULES.shadeStructureNotRealized,
      requirement.source === "user" ? "error" : "warning",
      "architecture",
      `Requested ${requirement.type.replaceAll("_", " ")} is absent from canonical geometry.`,
      { objectIds: [requirement.id] }, "requirement_and_geometry",
    ));
  }
  const allOpenings = building.floors.flatMap((floor) => floor.openings);
  const main = allOpenings.find((opening) => opening.role === "main_entry");
  const primary = building.facadeZones.filter((zone) => zone.role === "primary_road_elevation");
  if (!main || primary.length !== 1 || !primary[0].containsMainEntry
    || !primary[0].exteriorWallIds.includes(main.wallId)
    || !building.site.roadEdges.includes(primary[0].side)) findings.push(findingV3(
      RULES.facadeEntryConflict, "error", "architecture", "The primary designer facade is not the actual road-side main-entry facade.",
      { objectIds: [...(main ? [main.id, main.wallId] : []), ...primary.flatMap((zone) => zone.exteriorWallIds)] },
    ));
  return findings;
}

function intentTraceabilityFindings(building: CurrentBuilding, requirements: CurrentBuildingRequirements) {
  const findings: ValidationFindingV3[] = [];
  const canonicalIds = new Set([
    ...building.floors.flatMap((floor) => [floor.id, ...floor.spaces.map((space) => space.id), ...floor.regions.map((region) => region.id), ...floor.walls.map((wall) => wall.id), ...floor.openings.map((opening) => opening.id)]),
    ...building.roofSystems.map((roof) => roof.id),
    ...building.secondaryRoofSupports.map((support) => support.id),
    ...building.edgeProtections.map((protection) => protection.id),
  ]);
  const expected: Array<{ path: string; id?: string; requested: unknown; code: string }> = [
    { path: "entry.primarySide", requested: requirements.entry.primarySide.value, code: RULES.mainEntryNotRoadSide },
    { path: "roof", requested: requirements.roof.value, code: RULES.roofIntentNotRealized },
    { path: "courtyard", requested: requirements.courtyard.value, code: RULES.intentRealizationMissing },
    { path: "aboveParkingUse", requested: requirements.aboveParkingUse.value, code: RULES.intentRealizationMissing },
    { path: "parking.preferredSide", requested: requirements.parking.preferredSide.value, code: RULES.intentRealizationMissing },
    ...requirements.outdoorAreas.map((outdoor) => ({ path: "outdoorAreas", id: outdoor.id, requested: outdoor.type, code: RULES.intentRealizationMissing })),
    ...requirements.shadeStructures.map((shade) => ({ path: "shadeStructures", id: shade.id, requested: shade.type, code: RULES.shadeStructureNotRealized })),
  ];
  for (const item of expected) {
    const record = building.intentRealizations.find((candidate) => candidate.requirementPath === item.path && candidate.requirementId === item.id);
    const evidenceValid = record
      && JSON.stringify(record.requestedValue) === JSON.stringify(item.requested)
      && (record.status === "realized"
        ? record.realizedObjectIds.length > 0 && record.realizedObjectIds.every((id) => canonicalIds.has(id))
        : Boolean(record.relaxationCode));
    if (!evidenceValid) findings.push(findingV3(
      item.code,
      "error",
      "architecture",
      `Intent realization evidence is missing or invalid for ${item.path}${item.id ? `:${item.id}` : ""}.`,
      { objectIds: record?.realizedObjectIds ?? [item.id ?? item.path] },
      "requirement_and_geometry",
    ));
  }
  const entryRecord = building.intentRealizations.find((candidate) => candidate.requirementPath === "entry.primarySide");
  const mainEntry = building.floors.flatMap((floor) => floor.openings).find((opening) => opening.role === "main_entry");
  const entryFloor = mainEntry ? building.floors.find((floor) => floor.id === mainEntry.floorId) : undefined;
  const entryWall = entryFloor?.walls.find((wall) => wall.id === mainEntry?.wallId);
  const actualEntrySide = entryWall && entryFloor ? sideOfWall(entryWall, orthogonalPolygonBounds(entryFloor.envelope)) : undefined;
  if (requirements.entry.primarySide.value !== "auto_road_side"
    && actualEntrySide !== requirements.entry.primarySide.value
    && entryRecord?.status === "realized") findings.push(findingV3(
    RULES.mainEntryNotRoadSide,
    "error",
    "planning",
    "Main-entry evidence claims an explicit side was realized, but actual opening geometry is on another side; record an explicit relaxation.",
    { objectIds: [mainEntry?.id ?? "main-entry", entryWall?.id ?? "main-entry-wall"] },
    "requirement_and_geometry",
  ));
  return findings;
}

function verticalAndStructuralFindings(building: CurrentBuilding) {
  const findings: ValidationFindingV3[] = [];
  const floorIds = [...building.floors].sort((left, right) => left.level - right.level).map((floor) => floor.id);
  if (floorIds.length > 1 && building.verticalConnectors.length === 0) findings.push(findingV3(
    RULES.stairRequired, "error", "vertical", "Multiple floors require a continuous canonical stair connector.",
    { objectIds: floorIds.slice(1) },
  ));
  for (const connector of building.verticalConnectors) {
    if (floorIds.some((floorId) => !connector.servedFloorIds.includes(floorId) || !connector.boundsByFloor[floorId])) findings.push(findingV3(
      RULES.stairContinuous, "error", "vertical", "The canonical stair connector does not continuously serve every floor.",
      { objectIds: [connector.id, ...floorIds] },
    ));
    const realizedBounds = floorIds.flatMap((floorId) => {
      const floor = building.floors.find((candidate) => candidate.id === floorId);
      const stairs = floor?.spaces.filter((space) => space.type === "stair") ?? [];
      const stair = stairs[0];
      const region = floor && stair ? regionForSpace(floor, stair.id) : undefined;
      const actual = region ? orthogonalPolygonBounds(region.polygon) : undefined;
      const recorded = connector.boundsByFloor[floorId];
      if (stairs.length !== 1 || !actual || !recorded
        || actual.x !== recorded.x || actual.y !== recorded.y
        || actual.width !== recorded.width || actual.depth !== recorded.depth
        || Math.min(actual.width, actual.depth) < connector.widthMm) findings.push(findingV3(
        RULES.stairGeometry, "error", "vertical", "A served floor lacks one aligned stair region matching the canonical connector width and bounds.",
        { floorId, objectIds: [connector.id, ...stairs.map((space) => space.id)], required: { min: connector.widthMm, unit: "mm" } },
      ));
      return actual ? [actual] : [];
    });
    if (realizedBounds.length === floorIds.length
      && new Set(realizedBounds.map((bounds) => JSON.stringify(bounds))).size !== 1) findings.push(findingV3(
      RULES.stairContinuous, "error", "vertical", "Stair regions are not vertically aligned across all served floors.",
      { objectIds: [connector.id, ...floorIds] },
    ));
  }
  const floorSet = new Set(floorIds);
  for (const column of building.structuralConcept.columns) {
    if (column.servedFloorIds.some((id) => !floorSet.has(id))) findings.push(findingV3(
      RULES.structuralColumnContinuous, "error", "structure", "A conceptual column references a floor outside the canonical building.",
      { objectIds: [column.id, ...column.servedFloorIds] },
    ));
  }
  return findings;
}

function topologyFingerprint(building: CurrentBuilding): SchemeTopologyFingerprint {
  const spaces = building.floors.flatMap((floor) => floor.spaces
    .filter((space) => !isStackedSupportSpace(space.id))
    .map((space) => {
    const region = regionForSpace(floor, space.id);
    if (!region) throw new Error(`SCHEME_FINGERPRINT_REGION_MISSING:${space.id}`);
    return { id: space.id, floorId: floor.id, roomType: space.type, centroid: regionCentroid(region) };
    }));
  const known = new Set(spaces.map((space) => space.id));
  const adjacencyEdges = building.floors.flatMap((floor) => floor.openings
    .filter((opening) => opening.usage === "pedestrian")
    .flatMap((opening) => {
      const ids = opening.connects.filter((id) => known.has(id));
      return ids.length === 2 ? [[ids[0], ids[1]] as const] : [];
    }));
  const main = building.floors.flatMap((floor) => floor.openings).find((opening) => opening.role === "main_entry");
  if (!main) throw new Error("SCHEME_FINGERPRINT_MAIN_ENTRY_MISSING");
  const mainTarget = main.connects.find((id) => known.has(id));
  if (!mainTarget) throw new Error("SCHEME_FINGERPRINT_MAIN_TARGET_MISSING");
  const primary = building.facadeZones.find((zone) => zone.role === "primary_road_elevation");
  if (!primary) throw new Error("SCHEME_FINGERPRINT_PRIMARY_FACADE_MISSING");
  const secondaryOpening = building.floors.flatMap((floor) => floor.openings).find((opening) => opening.role === "secondary_entry" || opening.role === "service_entry");
  const secondaryTarget = secondaryOpening?.connects.find((id) => known.has(id));
  const secondaryFloor = secondaryOpening ? building.floors.find((floor) => floor.id === secondaryOpening.floorId) : undefined;
  const secondaryWall = secondaryFloor?.walls.find((wall) => wall.id === secondaryOpening?.wallId);
  const secondarySide = secondaryFloor && secondaryWall ? sideOfWall(secondaryWall, orthogonalPolygonBounds(secondaryFloor.envelope)) : undefined;
  const wingMap: Record<string, SchemeTopologyInput["wings"]> = {
    compact_bar: { count: 1, orientations: [primary.side === "north" || primary.side === "south" ? "east" : "north"] },
    courtyard_ring: { count: 4, orientations: ["north", "east", "south", "west"] },
    articulated_l: { count: 2, orientations: [primary.side, primary.side === "north" || primary.side === "south" ? "west" : "south"] },
    t_hub: { count: 3, orientations: [primary.side, primary.side === "north" || primary.side === "south" ? "east" : "north", primary.side === "north" || primary.side === "south" ? "west" : "south"] },
  };
  return fingerprintSchemeTopology({
    envelope: building.site.buildableEnvelope,
    primaryRoadSide: primary.side,
    rooms: spaces,
    adjacencyEdges,
    mainEntry: { side: primary.side, targetRoomId: mainTarget },
    secondaryEntry: secondaryOpening && secondaryTarget && secondarySide ? { side: secondarySide, targetRoomId: secondaryTarget } : undefined,
    voids: building.floors.flatMap((floor) => floor.regions.filter((region) => region.kind === "open_to_sky").map((region) => ({ floorId: floor.id, centroid: regionCentroid(region) }))),
    wings: wingMap[building.candidate.generatorId] ?? { count: 1, orientations: [primary.side] },
    occupiedFootprintsByFloor: building.floors.map((floor) => ({
      floorId: floor.id,
      polygons: floor.regions.filter((region) => region.kind === "interior" || region.kind === "covered_outdoor").map((region) => region.polygon),
    })),
  });
}

export function validateSchemeSet(schemes: readonly V3SchemeSetMember[]): V3SchemeSetValidation {
  const findings: ValidationFindingV3[] = [];
  const fingerprints = Object.fromEntries(schemes.map((scheme) => [scheme.schemeId, topologyFingerprint(scheme.building)]));
  const physicalFingerprints = Object.fromEntries(schemes.map((scheme) => [scheme.schemeId, v3PhysicalGeometryFingerprint(scheme.building)]));
  for (let left = 0; left < schemes.length; left += 1) for (let right = left + 1; right < schemes.length; right += 1) {
    const comparison = compareSchemeTopologyFingerprints(fingerprints[schemes[left].schemeId], fingerprints[schemes[right].schemeId]);
    const physicallyIdentical = physicalFingerprints[schemes[left].schemeId] === physicalFingerprints[schemes[right].schemeId];
    if (!physicallyIdentical && !comparison.nearDuplicate) continue;
    findings.push(findingV3(
      RULES.schemeNotDistinct,
      "error",
      "scheme_set",
      physicallyIdentical
        ? `Schemes ${schemes[left].schemeId} and ${schemes[right].schemeId} have identical physical geometry.`
        : `Schemes ${schemes[left].schemeId} and ${schemes[right].schemeId} are near-duplicates.`,
      {
        objectIds: [schemes[left].schemeId, schemes[right].schemeId],
        measured: { value: physicallyIdentical ? 1 : Math.min(comparison.adjacencyJaccard, comparison.footprintIoU), unit: "similarity" },
        required: { max: 0.849999, unit: "similarity" },
      },
      "scheme_set",
    ));
  }
  return { valid: findings.length === 0, findings, fingerprints };
}

function emitMetric(validation: ValidationReportV3, options: V3ValidationOptions) {
  const countsByRuleCode: ValidationCodeMetric["countsByRuleCode"] = {};
  for (const item of validation.findings) {
    countsByRuleCode[item.ruleId] ??= { error: 0, warning: 0, info: 0 };
    countsByRuleCode[item.ruleId][item.severity] += 1;
  }
  options.onMetric?.({
    event: "v3_validation_completed",
    schemaVersion: 1,
    rulePackVersion: V3_RULE_PACK_VERSION,
    cohortId: options.cohortId ?? "unspecified",
    valid: validation.valid,
    score: validation.score,
    countsBySeverity: validation.counts,
    countsByRuleCode,
  });
}

/** Authoritative schema-v3 validator. It intentionally does not adapt or mutate legacy reports. */
export function validateBuildingV3(
  building: CurrentBuilding,
  requirements: CurrentBuildingRequirements,
  options: V3ValidationOptions = {},
): ValidationReportV3 {
  const validation = report([
    ...coverageFindings(building),
    ...areaFindings(building, requirements),
    ...openingAndAccessFindings(building, requirements),
    ...verticalAndStructuralFindings(building),
    ...stackedSupportFindings(building),
    ...roofFindings(building, requirements),
    ...supportClearanceFindings(building),
    ...edgeProtectionFindings(building),
    ...shadeAndFacadeFindings(building, requirements),
    ...intentTraceabilityFindings(building, requirements),
  ]);
  emitMetric(validation, options);
  return validation;
}

/**
 * Converts physical-stage candidates into canonical, validation-bearing candidates. Invalid
 * geometry never crosses this boundary. Near-duplicate later candidates are rejected rather than
 * padded into the direction rack.
 */
export function validateV3SchemeStage(
  schemes: readonly V3SchemeSetMember[],
  requirements: CurrentBuildingRequirements,
  options: V3ValidationOptions = {},
): V3ValidationStageResult {
  const validated = schemes.map((scheme) => ({
    ...scheme,
    validation: validateBuildingV3(scheme.building, requirements, options),
  }));
  const rejectedSchemes: V3ValidationStageResult["rejectedSchemes"] = validated
    .filter((scheme) => !scheme.validation.valid)
    .map((scheme) => ({ schemeId: scheme.schemeId, findings: scheme.validation.findings }));
  const individuallyValid = validated.filter((scheme) => scheme.validation.valid);
  const schemeSet = validateSchemeSet(individuallyValid);
  const duplicateIds = new Set(schemeSet.findings.flatMap((finding) => finding.objectIds.slice(1)));
  for (const schemeId of duplicateIds) {
    const finding = schemeSet.findings.find((candidate) => candidate.objectIds.includes(schemeId));
    rejectedSchemes.push({ schemeId, findings: finding ? [finding] : [] });
  }
  const accepted = individuallyValid.filter((scheme) => !duplicateIds.has(scheme.schemeId)).map((scheme): V3ValidatedScheme => ({
    schemeId: scheme.schemeId,
    partiId: scheme.building.candidate.generatorId,
    name: `${scheme.building.candidate.generatorId.replaceAll("_", " ")} · Validated direction`,
    rationale: "Canonical v3 geometry passed the complete deterministic physical and circulation rule pack.",
    building: scheme.building,
    validation: scheme.validation,
    evidence: scheme.building.candidate.evidence ?? scheme.building.intentRealizations.map((item) => `${item.requirementPath}:${item.status}`),
    ladderRung: scheme.building.candidate.relaxation?.rung ?? 0,
  }));
  if (accepted.length === 0) {
    throw new V3ValidationStageError(
      "NO_VALID_V3_SCHEME",
      "No physical candidate passed authoritative v3 validation.",
      rejectedSchemes,
    );
  }
  return {
    contractVersion: "validation-stage-v3",
    schemes: accepted,
    selectedSchemeId: accepted[0].schemeId,
    building: accepted[0].building,
    validation: accepted[0].validation,
    rejectedSchemes,
    schemeSet,
  };
}

export class V3ValidationStageError extends Error {
  constructor(
    readonly code: "NO_VALID_V3_SCHEME",
    message: string,
    readonly rejectedSchemes: V3ValidationStageResult["rejectedSchemes"],
  ) {
    super(message);
    this.name = "V3ValidationStageError";
  }
}
