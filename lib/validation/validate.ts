import type { BuildingRequirements } from "@/lib/building/requirements";
import type { Building, Floor, Opening, Rectangle, WallSegment } from "@/lib/building/schema";
import { circulationPassageConflicts, openingUsage, spacesWithNoPassableOpening, unreachableOccupiedSpaces } from "@/lib/building/circulation";
import { analyzeCoverage, rectangleIntersectionArea, wallLength } from "@/lib/building/topology";
import { finding, MIN_CONCEPT_PASSAGE_WIDTH_MM, MIN_VEHICLE_ACCESS_WIDTH_MM, RULE_PACK_VERSION, RULES } from "@/lib/validation/rules";
import type { ValidationFinding, ValidationReport, ValidationSeverity } from "@/lib/validation/types";

function boundsRight(bounds: Rectangle) { return bounds.x + bounds.width; }
function boundsBottom(bounds: Rectangle) { return bounds.y + bounds.depth; }

function wallKey(wall: WallSegment) {
  const points = [wall.start, wall.end].sort((left, right) => left.x - right.x || left.y - right.y);
  return `${wall.floorId}:${points[0].x},${points[0].y}:${points[1].x},${points[1].y}`;
}

function geometryFindings(floor: Floor) {
  const findings: ValidationFinding[] = [];
  const audit = analyzeCoverage(floor.envelope, floor.spaces);
  if (audit.overlapAreaMm2 > 0) findings.push(finding(
    RULES.geometryOverlap, "error", "geometry", "Planning cells overlap.",
    { floorId: floor.id, objectIds: floor.spaces.map((space) => space.id), measured: { value: audit.overlapAreaMm2, unit: "mm2" }, required: { max: 0, unit: "mm2" } },
  ));
  if (audit.gapAreaMm2 > 0) findings.push(finding(
    RULES.geometryGap, "error", "geometry", "Planning cells leave an uncovered gap in the floor envelope.",
    { floorId: floor.id, objectIds: floor.spaces.map((space) => space.id), measured: { value: audit.gapAreaMm2, unit: "mm2" }, required: { max: 0, unit: "mm2" } },
  ));
  if (audit.outsideAreaMm2 > 0) findings.push(finding(
    RULES.geometryEnvelope, "error", "geometry", "Planning cells extend outside the floor envelope.",
    { floorId: floor.id, objectIds: floor.spaces.map((space) => space.id), measured: { value: audit.outsideAreaMm2, unit: "mm2" }, required: { max: 0, unit: "mm2" } },
  ));

  const keys = new Map<string, string>();
  for (const wall of floor.walls) {
    const key = wallKey(wall);
    const duplicate = keys.get(key);
    if (duplicate || wall.adjacentSpaceIds.length === 0 || wall.adjacentSpaceIds.length > 2) findings.push(finding(
      RULES.wallCanonical, "error", "topology", "A wall interval is duplicated or has invalid adjacency.",
      { floorId: floor.id, objectIds: duplicate ? [duplicate, wall.id] : [wall.id] },
    ));
    keys.set(key, wall.id);
  }
  return findings;
}

function openingInterval(opening: Opening) {
  return { start: opening.offsetMm, end: opening.offsetMm + opening.widthMm };
}

function exteriorSide(wall: WallSegment, floor: Floor) {
  if (wall.start.y === floor.envelope.y && wall.end.y === floor.envelope.y) return "north";
  if (wall.start.x === boundsRight(floor.envelope) && wall.end.x === boundsRight(floor.envelope)) return "east";
  if (wall.start.y === boundsBottom(floor.envelope) && wall.end.y === boundsBottom(floor.envelope)) return "south";
  if (wall.start.x === floor.envelope.x && wall.end.x === floor.envelope.x) return "west";
  return undefined;
}

function openingFindings(floor: Floor, roadEdges: Building["site"]["roadEdges"]) {
  const findings: ValidationFinding[] = [];
  const walls = new Map(floor.walls.map((wall) => [wall.id, wall]));
  for (const space of spacesWithNoPassableOpening(floor)) findings.push(finding(
    RULES.passableOpening, "error", "opening", `${space.name} has no passable door or open connection.`,
    { floorId: floor.id, objectIds: [space.id], suggestedAction: "Add a door to an adjacent reachable space.", repairType: "add_opening" },
  ));
  for (const opening of floor.openings) {
    const wall = walls.get(opening.wallId);
    if (!wall || opening.offsetMm < 0 || opening.offsetMm + opening.widthMm > (wall ? wallLength(wall) : 0)) {
      findings.push(finding(RULES.openingOnWall, "error", "opening", "Opening does not fit on its referenced wall.", {
        floorId: floor.id, objectIds: [opening.id, opening.wallId],
      }));
      continue;
    }
    const connectedSpaces = opening.connects.filter((id) => id !== "EXTERIOR").sort();
    const wallSpaces = [...wall.adjacentSpaceIds].sort();
    if (connectedSpaces.some((id) => !wallSpaces.includes(id))) findings.push(finding(
      RULES.openingOnWall, "error", "opening", "Opening connectivity does not match the wall adjacency.",
      { floorId: floor.id, objectIds: [opening.id, wall.id, ...connectedSpaces] },
    ));
    if (opening.kind === "window" && wall.type !== "exterior") findings.push(finding(
      RULES.windowExterior, "error", "opening", "A window may only be placed on an exterior or courtyard wall.",
      { floorId: floor.id, objectIds: [opening.id, wall.id] },
    ));
    if (openingUsage(opening) === "pedestrian" && opening.widthMm < MIN_CONCEPT_PASSAGE_WIDTH_MM) findings.push(finding(
      RULES.openingPassageWidth,
      "error",
      "opening",
      `The passage between ${opening.connects.join(" and ")} is only ${opening.widthMm} mm wide and cannot be treated as valid circulation.`,
      {
        floorId: floor.id,
        objectIds: [opening.id, wall.id, ...opening.connects],
        measured: { value: opening.widthMm, unit: "mm" },
        required: { min: MIN_CONCEPT_PASSAGE_WIDTH_MM, unit: "mm" },
        suggestedAction: "Regenerate so these rooms share a longer wall interval that can hold a proper door or passage.",
        repairType: "widen_passage",
      },
      "baseline_heuristic",
    ));
    if (openingUsage(opening) === "vehicle") {
      const parkingId = opening.connects.find((id) => floor.spaces.find((space) => space.id === id)?.type === "parking");
      const side = exteriorSide(wall, floor);
      if (
        opening.kind !== "open_connection" ||
        !opening.connects.includes("EXTERIOR") ||
        !parkingId ||
        wall.type !== "exterior" ||
        !side ||
        !roadEdges.includes(side) ||
        opening.widthMm < MIN_VEHICLE_ACCESS_WIDTH_MM
      ) findings.push(finding(
        RULES.vehicleOpening,
        "error",
        "opening",
        "A vehicle opening must connect covered parking directly to an exterior wall on a configured road edge.",
        {
          floorId: floor.id,
          objectIds: [opening.id, opening.wallId, ...opening.connects],
          measured: { value: opening.widthMm, unit: "mm" },
          required: { min: MIN_VEHICLE_ACCESS_WIDTH_MM, unit: "mm" },
          suggestedAction: "Place covered parking on a road-facing edge and provide a vehicle-width opening.",
          repairType: "add_vehicle_road_access",
        },
        "baseline_heuristic",
      ));
    }
    const edgeClearance = Math.min(opening.offsetMm, wallLength(wall) - opening.offsetMm - opening.widthMm);
    if (edgeClearance < 50) findings.push(finding(
      RULES.openingClearance, "error", "opening", "Opening is too close to a wall junction.",
      { floorId: floor.id, objectIds: [opening.id, wall.id], measured: { value: edgeClearance, unit: "mm" }, required: { min: 50, unit: "mm" } },
    ));
  }
  for (const parking of floor.spaces.filter((space) => space.type === "parking")) {
    const hasRoadAccess = floor.openings.some((opening) => {
      if (openingUsage(opening) !== "vehicle" || !opening.connects.includes(parking.id)) return false;
      const wall = walls.get(opening.wallId);
      const side = wall ? exteriorSide(wall, floor) : undefined;
      return opening.kind === "open_connection" &&
        opening.connects.includes("EXTERIOR") &&
        opening.widthMm >= MIN_VEHICLE_ACCESS_WIDTH_MM &&
        wall?.type === "exterior" &&
        Boolean(side && roadEdges.includes(side));
    });
    if (!hasRoadAccess) findings.push(finding(
      RULES.parkingRoadAccess,
      "error",
      "opening",
      `${parking.name} has no modeled vehicle access to a configured road edge.`,
      {
        floorId: floor.id,
        objectIds: [parking.id],
        required: { min: MIN_VEHICLE_ACCESS_WIDTH_MM, unit: "mm" },
        suggestedAction: "Move covered parking to a road-facing edge or add a vehicle-width exterior opening.",
        repairType: "add_vehicle_road_access",
      },
      "baseline_heuristic",
    ));
  }
  const byWall = new Map<string, Opening[]>();
  for (const opening of floor.openings) byWall.set(opening.wallId, [...(byWall.get(opening.wallId) ?? []), opening]);
  for (const [wallId, openings] of byWall) {
    for (let left = 0; left < openings.length; left += 1) {
      for (let right = left + 1; right < openings.length; right += 1) {
        const a = openingInterval(openings[left]);
        const b = openingInterval(openings[right]);
        if (Math.min(a.end, b.end) > Math.max(a.start, b.start)) findings.push(finding(
          RULES.openingClearance, "error", "opening", "Openings overlap on the same wall.",
          { floorId: floor.id, objectIds: [wallId, openings[left].id, openings[right].id] },
        ));
      }
    }
  }
  return findings;
}

function verticalFindings(building: Building) {
  const findings: ValidationFinding[] = [];
  if (building.floors.length <= 1) return findings;
  if (building.verticalConnectors.length === 0) return [finding(
    RULES.stairRequired, "error", "vertical", "Upper floors require a continuous stair connector.",
    { objectIds: building.floors.slice(1).map((floor) => floor.id), suggestedAction: "Add an aligned stair core from ground to top floor." },
  )];
  const allFloorIds = [...building.floors].sort((left, right) => left.level - right.level).map((floor) => floor.id);
  for (const connector of building.verticalConnectors) {
    if (allFloorIds.some((floorId) => !connector.servedFloorIds.includes(floorId) || !connector.boundsByFloor[floorId])) findings.push(finding(
      RULES.stairContinuous, "error", "vertical", "Stair connector does not continuously serve every floor.",
      { objectIds: [connector.id, ...allFloorIds] },
    ));
    const bounds = Object.values(connector.boundsByFloor);
    if (bounds.some((candidate) => candidate.x !== bounds[0].x || candidate.y !== bounds[0].y || candidate.width !== bounds[0].width || candidate.depth !== bounds[0].depth)) findings.push(finding(
      RULES.stairContinuous, "error", "vertical", "Stair cores are not vertically aligned.",
      { objectIds: [connector.id, ...connector.servedFloorIds] },
    ));
    if (connector.widthMm < 900 || connector.riseMm < 140 || connector.riseMm > 220 || connector.runMm < 240) findings.push(finding(
      RULES.stairGeometry, "error", "vertical", "Stair baseline width, rise, or run is internally invalid.",
      { objectIds: [connector.id], measured: { value: connector.widthMm, unit: "mm" }, required: { min: 900, unit: "mm" } },
      "baseline_heuristic",
    ));
  }
  return findings;
}

function planningFindings(building: Building, requirements?: BuildingRequirements) {
  const findings: ValidationFinding[] = [];
  const requirementById = new Map(requirements?.rooms.map((room) => [room.id, room]) ?? []);
  for (const floor of building.floors) {
    for (const opening of floor.openings.filter((candidate) => candidate.kind === "door")) {
      const accessibleRoute = opening.connects.some((id) => floor.spaces.find((space) => space.id === id)?.accessible);
      if (accessibleRoute && opening.widthMm < 900) findings.push(finding(
        RULES.accessibilityClearance, "error", "opening", "A requested accessible route has a door narrower than the 900 mm concept baseline.",
        { floorId: floor.id, objectIds: [opening.id, ...opening.connects], measured: { value: opening.widthMm, unit: "mm" }, required: { min: 900, unit: "mm" } },
        "baseline_heuristic",
      ));
    }
    for (const space of floor.spaces) {
      const requirement = requirementById.get(space.id);
      if (requirement && space.areaMm2 < requirement.minAreaMm2) findings.push(finding(
        RULES.roomMinimumArea, "error", "planning", `${space.name} is below the requested minimum area.`,
        { floorId: floor.id, objectIds: [space.id], measured: { value: space.areaMm2, unit: "mm2" }, required: { min: requirement.minAreaMm2, unit: "mm2" }, suggestedAction: "Relax the room program or enlarge the buildable envelope." },
        "baseline_heuristic",
      ));
      const aspect = Math.max(space.bounds.width / space.bounds.depth, space.bounds.depth / space.bounds.width);
      if (aspect > 4) findings.push(finding(
        RULES.roomAspect, "warning", "planning", `${space.name} has an inefficient aspect ratio.`,
        { floorId: floor.id, objectIds: [space.id], measured: { value: Number(aspect.toFixed(2)), unit: "ratio" }, required: { max: 4, unit: "ratio" } },
        "baseline_heuristic",
      ));
      const exteriorWalls = floor.walls.filter((wall) => wall.type === "exterior" && wall.adjacentSpaceIds.includes(space.id));
      const intrinsicallyExterior = ["balcony", "courtyard", "terrace"].includes(space.type);
      if (requirement?.mustBeExterior && !intrinsicallyExterior && exteriorWalls.length === 0) findings.push(finding(
        RULES.exteriorPreference, "error", "planning", `${space.name} requires an exterior wall but has none.`,
        { floorId: floor.id, objectIds: [space.id] }, "baseline_heuristic",
      ));
      if (space.occupied && !["bathroom", "store", "circulation", "stair"].includes(space.type) && !floor.openings.some((opening) => opening.kind === "window" && opening.connects.includes(space.id))) findings.push(finding(
        RULES.daylight, "warning", "planning", `${space.name} has no direct exterior window in this concept plan.`,
        { floorId: floor.id, objectIds: [space.id], suggestedAction: "Move the room to an exterior edge or add a courtyard strategy." }, "baseline_heuristic",
      ));
    }
  }

  for (const relation of requirements?.relationships ?? []) {
    const fromFloor = building.floors.find((floor) => floor.spaces.some((space) => space.id === relation.fromRoomId));
    const toFloor = building.floors.find((floor) => floor.spaces.some((space) => space.id === relation.toRoomId));
    if (relation.type === "must_connect") {
      const directlyConnected = fromFloor?.id === toFloor?.id && fromFloor?.openings.some((opening) =>
        opening.kind !== "window" && opening.connects.includes(relation.fromRoomId) && opening.connects.includes(relation.toRoomId),
      );
      if (!directlyConnected) findings.push(finding(
        RULES.relationshipConnect, "error", "planning", "A required direct room connection is missing.",
        { floorId: fromFloor?.id, objectIds: [relation.fromRoomId, relation.toRoomId], suggestedAction: "Place the rooms on a shared wall with a passable opening." },
      ));
    }
    if (relation.type === "stack_with" && fromFloor && toFloor && fromFloor.id !== toFloor.id) {
      const from = fromFloor.spaces.find((space) => space.id === relation.fromRoomId);
      const to = toFloor.spaces.find((space) => space.id === relation.toRoomId);
      if (from && to && rectangleIntersectionArea(from.bounds, to.bounds) === 0) findings.push(finding(
        RULES.stackAlignment, "warning", "planning", "Requested stacked rooms do not overlap vertically.",
        { objectIds: [from.id, to.id] }, "baseline_heuristic",
      ));
    }
  }
  return findings;
}

function circulationQualityFindings(building: Building, requirements?: BuildingRequirements) {
  return circulationPassageConflicts(building, requirements).map(({ target, passageSpaces }) => finding(
      RULES.circulationPrivacy,
      "error",
      "topology",
      `${target.name} is only reachable through ${passageSpaces.map((space) => space.name).join(", ")}, using a private or service room as a passage.`,
      {
        floorId: target.floorId,
        objectIds: [target.id, ...passageSpaces.map((space) => space.id)],
        suggestedAction: "Connect this room to a foyer, circulation space, living area or dining area without passing through a bedroom, bathroom, kitchen, utility, store or pooja room.",
        repairType: "improve_circulation_route",
      },
      "baseline_heuristic",
    ));
}

export function validateBuilding(building: Building, requirements?: BuildingRequirements): ValidationReport {
  const findings = [
    ...building.floors.flatMap(geometryFindings),
    ...building.floors.flatMap((floor) => openingFindings(floor, building.site.roadEdges)),
    ...verticalFindings(building),
    ...planningFindings(building, requirements),
    ...circulationQualityFindings(building, requirements),
  ];
  for (const space of unreachableOccupiedSpaces(building)) findings.push(finding(
    RULES.reachable, "error", "topology", `${space.name} is not reachable from the exterior entrance.`,
    { floorId: space.floorId, objectIds: [space.id], suggestedAction: "Add a passable route to the entrance or stair core.", repairType: "connect_space" },
  ));
  findings.sort((left, right) => {
    const severity = { error: 0, warning: 1, info: 2 };
    return severity[left.severity] - severity[right.severity] || left.ruleId.localeCompare(right.ruleId) || (left.floorId ?? "").localeCompare(right.floorId ?? "") || left.objectIds.join("|").localeCompare(right.objectIds.join("|"));
  });
  const counts = { error: 0, warning: 0, info: 0 } satisfies Record<ValidationSeverity, number>;
  for (const item of findings) counts[item.severity] += 1;
  return {
    rulePackVersion: RULE_PACK_VERSION,
    valid: counts.error === 0,
    score: Math.max(0, 100 - counts.error * 25 - counts.warning * 3 - counts.info),
    counts,
    findings,
  };
}
