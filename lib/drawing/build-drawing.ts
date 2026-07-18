import type { RoomType } from "@/lib/building/requirements";
import type { Building, CurrentBuilding, CurrentFloor, Floor, Opening, Point, ReadableBuilding, Rectangle, Segment2, Space, WallSegment } from "@/lib/building/schema";
import { orthogonalPolygonAreaMm2, orthogonalPolygonBounds } from "@/lib/building/orthogonal-partition";
import { isVerandahSpace } from "@/lib/building/space-semantics";
import { EXTERIOR, isPerimeterOpenSpace, isVerandahOpenEdgeWall } from "@/lib/building/topology";

import {
  RENDERER_VERSION,
  type BuildingDrawing,
  type DrawingDimension,
  type DrawingFinding,
  type DrawingFindingInput,
  type DrawingFloorArtifact,
  type DrawingFurniture,
  type DrawingOpening,
  type DrawingAnnotationLayout,
  type DrawingRoadCorridor,
  type DrawingRoom,
  type DrawingRoute,
  type FurnitureKind,
  type RoomZone,
} from "@/lib/drawing/schema";

const ROAD_WIDTH_MM = 650;
const ROAD_INNER_CLEARANCE_MM = 1650;
const ROAD_OUTER_EXTENT_MM = ROAD_INNER_CLEARANCE_MM + ROAD_WIDTH_MM;
const ROAD_VIEW_PADDING_MM = 500;

const ROOM_ZONE: Record<RoomType, RoomZone> = {
  living: "social",
  dining: "social",
  kitchen: "kitchen",
  bedroom: "private",
  bathroom: "wet",
  pooja: "sacred",
  utility: "utility",
  foyer: "circulation",
  parking: "utility",
  study: "work",
  balcony: "outdoor",
  circulation: "circulation",
  stair: "circulation",
  store: "utility",
  courtyard: "outdoor",
  terrace: "outdoor",
  verandah: "outdoor",
};

const FURNITURE_KIND: Record<RoomType, FurnitureKind> = {
  living: "sofa",
  dining: "table",
  kitchen: "counter",
  bedroom: "bed",
  bathroom: "bath",
  pooja: "altar",
  utility: "counter",
  foyer: "table",
  parking: "car",
  study: "desk",
  balcony: "landscape",
  circulation: "table",
  stair: "stair",
  store: "storage",
  courtyard: "landscape",
  terrace: "landscape",
  verandah: "landscape",
};

function formatMetres(mm: number) {
  return `${(mm / 1000).toFixed(mm % 1000 === 0 ? 1 : 2)} m`;
}

function areaLabel(areaMm2: number) {
  return `${(areaMm2 / 1_000_000).toFixed(1)} m²`;
}

function insetBounds(bounds: Rectangle, ratio = 0.18): Rectangle {
  const insetX = Math.min(Math.round(bounds.width * ratio), 900);
  const insetY = Math.min(Math.round(bounds.depth * ratio), 900);
  return {
    x: bounds.x + insetX,
    y: bounds.y + insetY,
    width: Math.max(300, bounds.width - insetX * 2),
    depth: Math.max(300, bounds.depth - insetY * 2),
  };
}

function labelForSpace(space: Space, scheduleIndex: number): DrawingRoom["label"] {
  const nameWidth = space.name.toUpperCase().length;
  const baseSize = 330;
  const compactSize = 250;
  const roomWidth = space.bounds.width * 0.84;
  const roomDepth = space.bounds.depth * 0.72;
  const estimatedBaseWidth = nameWidth * baseSize * 0.57;
  const estimatedCompactWidth = nameWidth * compactSize * 0.55;
  const center = { x: space.bounds.x + space.bounds.width / 2, y: space.bounds.y + space.bounds.depth / 2 };

  if (estimatedBaseWidth <= roomWidth && roomDepth >= 900) return { mode: "center", ...center, fontSizeMm: baseSize };
  if (estimatedCompactWidth <= roomWidth && roomDepth >= 700) return { mode: "compact", ...center, fontSizeMm: compactSize };
  return { mode: "schedule", ...center, fontSizeMm: 260, scheduleRef: `R${String(scheduleIndex + 1).padStart(2, "0")}` };
}

function openingGeometry(opening: Opening, wall: WallSegment, floor?: Floor): DrawingOpening {
  const horizontal = wall.start.y === wall.end.y;
  const increasing = horizontal ? wall.end.x >= wall.start.x : wall.end.y >= wall.start.y;
  const direction = increasing ? 1 : -1;
  const start: Point = horizontal
    ? { x: wall.start.x + direction * opening.offsetMm, y: wall.start.y }
    : { x: wall.start.x, y: wall.start.y + direction * opening.offsetMm };
  const end: Point = horizontal
    ? { x: start.x + direction * opening.widthMm, y: start.y }
    : { x: start.x, y: start.y + direction * opening.widthMm };
  const hingePoint = opening.hinge === "end" ? end : start;
  const closedPoint = opening.hinge === "end" ? start : end;
  const closedVector = { x: closedPoint.x - hingePoint.x, y: closedPoint.y - hingePoint.y };
  const clockwiseLeaf = { x: hingePoint.x - closedVector.y, y: hingePoint.y + closedVector.x };
  const counterclockwiseLeaf = { x: hingePoint.x + closedVector.y, y: hingePoint.y - closedVector.x };
  let swing = opening.swing;
  let interiorPoint: Point | undefined;
  if (opening.kind === "door" && floor) {
    const targetSpaceId = opening.connects.includes(EXTERIOR)
      ? opening.connects.find((spaceId) => spaceId !== EXTERIOR)
      : opening.connects[1];
    const targetSpace = floor.spaces.find((space) => space.id === targetSpaceId);
    if (targetSpace) {
      const targetCenter = { x: targetSpace.bounds.x + targetSpace.bounds.width / 2, y: targetSpace.bounds.y + targetSpace.bounds.depth / 2 };
      interiorPoint = targetCenter;
      const distanceSquared = (point: Point) => (point.x - targetCenter.x) ** 2 + (point.y - targetCenter.y) ** 2;
      swing = distanceSquared(clockwiseLeaf) <= distanceSquared(counterclockwiseLeaf) ? "clockwise" : "counterclockwise";
    }
  }
  const leafPoint: Point = swing === "counterclockwise" ? counterclockwiseLeaf : clockwiseLeaf;

  return {
    id: opening.id,
    wallId: opening.wallId,
    kind: opening.kind,
    start,
    end,
    hingePoint,
    leafPoint,
    swing,
    widthMm: opening.widthMm,
    wallThicknessMm: wall.thicknessMm,
    isEntrance: opening.kind !== "window" && opening.connects.includes(EXTERIOR),
    interiorPoint,
  };
}

function overallDimensions(siteBounds: Rectangle, envelope: Rectangle): DrawingDimension[] {
  return [
    { id: "site-width", orientation: "horizontal", start: { x: siteBounds.x, y: siteBounds.y }, end: { x: siteBounds.x + siteBounds.width, y: siteBounds.y }, offsetMm: -1100, label: formatMetres(siteBounds.width) },
    { id: "site-depth", orientation: "vertical", start: { x: siteBounds.x, y: siteBounds.y }, end: { x: siteBounds.x, y: siteBounds.y + siteBounds.depth }, offsetMm: -1100, label: formatMetres(siteBounds.depth) },
    { id: "envelope-width", orientation: "horizontal", start: { x: envelope.x, y: envelope.y + envelope.depth }, end: { x: envelope.x + envelope.width, y: envelope.y + envelope.depth }, offsetMm: 900, label: formatMetres(envelope.width) },
    { id: "envelope-depth", orientation: "vertical", start: { x: envelope.x + envelope.width, y: envelope.y }, end: { x: envelope.x + envelope.width, y: envelope.y + envelope.depth }, offsetMm: 900, label: formatMetres(envelope.depth) },
  ];
}

function internalDimensions(spaces: Space[]): DrawingDimension[] {
  return spaces.flatMap((space) => [
    { id: `${space.id}-width`, orientation: "horizontal" as const, start: { x: space.bounds.x, y: space.bounds.y }, end: { x: space.bounds.x + space.bounds.width, y: space.bounds.y }, offsetMm: 430, label: formatMetres(space.bounds.width) },
    { id: `${space.id}-depth`, orientation: "vertical" as const, start: { x: space.bounds.x, y: space.bounds.y }, end: { x: space.bounds.x, y: space.bounds.y + space.bounds.depth }, offsetMm: 430, label: formatMetres(space.bounds.depth) },
  ]);
}

function furnitureForSpace(space: Space): DrawingFurniture {
  return { id: `furniture-${space.id}`, roomId: space.id, kind: FURNITURE_KIND[space.type], bounds: insetBounds(space.bounds) };
}

function routesForFloor(floor: Floor): DrawingRoute[] {
  const wallById = new Map(floor.walls.map((wall) => [wall.id, wall]));
  const roomById = new Map(floor.spaces.map((space) => [space.id, space]));
  const entrance = floor.openings.find((opening) => opening.kind !== "window" && opening.connects.includes(EXTERIOR));
  const entranceRoomId = entrance?.connects.find((roomId) => roomId !== EXTERIOR);
  const origin = roomById.get(entranceRoomId ?? "")
    ?? floor.spaces.find((space) => space.type === "stair")
    ?? floor.spaces.find((space) => ["foyer", "circulation"].includes(space.type))
    ?? floor.spaces[0];
  if (!origin) return [];

  type RouteEdge = { nextRoomId: string; openingPoint: Point };
  const graph = new Map<string, RouteEdge[]>();
  for (const opening of floor.openings.filter((candidate) => candidate.kind !== "window" && !candidate.connects.includes(EXTERIOR))) {
    const wall = wallById.get(opening.wallId);
    if (!wall) continue;
    const geometry = openingGeometry(opening, wall, floor);
    const openingPoint = { x: (geometry.start.x + geometry.end.x) / 2, y: (geometry.start.y + geometry.end.y) / 2 };
    const [leftId, rightId] = opening.connects;
    graph.set(leftId, [...(graph.get(leftId) ?? []), { nextRoomId: rightId, openingPoint }]);
    graph.set(rightId, [...(graph.get(rightId) ?? []), { nextRoomId: leftId, openingPoint }]);
  }

  const centerOf = (roomId: string) => {
    const room = roomById.get(roomId);
    return room ? { x: room.bounds.x + room.bounds.width / 2, y: room.bounds.y + room.bounds.depth / 2 } : undefined;
  };

  const entrancePoint = entrance
    ? (() => {
        const wall = wallById.get(entrance.wallId);
        if (!wall) return undefined;
        const geometry = openingGeometry(entrance, wall, floor);
        return { x: (geometry.start.x + geometry.end.x) / 2, y: (geometry.start.y + geometry.end.y) / 2 };
      })()
    : undefined;
  const targets = floor.spaces.filter((space) => space.id !== origin.id && ["foyer", "circulation", "stair"].includes(space.type));
  const segments = new Map<string, DrawingRoute>();

  for (const target of targets) {
      const queue = [origin.id];
      const previous = new Map<string, { roomId: string; openingPoint: Point }>();
      const visited = new Set(queue);
      while (queue.length && !visited.has(target.id)) {
        const roomId = queue.shift() as string;
        for (const edge of graph.get(roomId) ?? []) {
          if (visited.has(edge.nextRoomId)) continue;
          visited.add(edge.nextRoomId);
          previous.set(edge.nextRoomId, { roomId, openingPoint: edge.openingPoint });
          queue.push(edge.nextRoomId);
        }
      }
      if (!visited.has(target.id)) continue;
      const steps: Array<{ roomId: string; openingPoint: Point }> = [];
      for (let roomId = target.id; roomId !== origin.id;) {
        const step = previous.get(roomId);
        if (!step) break;
        steps.unshift({ roomId, openingPoint: step.openingPoint });
        roomId = step.roomId;
      }
      const points = [entrancePoint ?? centerOf(origin.id), ...steps.map((step) => step.openingPoint)].filter((point): point is Point => Boolean(point));
      for (let index = 1; index < points.length; index += 1) {
        const start = points[index - 1];
        const end = points[index];
        const forward = `${start.x},${start.y}:${end.x},${end.y}`;
        const reverse = `${end.x},${end.y}:${start.x},${start.y}`;
        const key = forward < reverse ? forward : reverse;
        if (!segments.has(key)) {
          segments.set(key, {
            id: `route-primary-${segments.size + 1}`,
            roomId: target.id,
            points: [start, end],
            accessible: origin.accessible && target.accessible,
          });
        }
      }
  }

  return [...segments.values()];
}

function findingPoint(objectIds: string[], floor: Floor): Point {
  const space = floor.spaces.find((candidate) => objectIds.includes(candidate.id));
  if (space) return { x: space.bounds.x + space.bounds.width / 2, y: space.bounds.y + space.bounds.depth / 2 };
  const wall = floor.walls.find((candidate) => objectIds.includes(candidate.id));
  if (wall) return { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 };
  return { x: floor.envelope.x + floor.envelope.width / 2, y: floor.envelope.y + floor.envelope.depth / 2 };
}

function findingsForFloor(inputs: DrawingFindingInput[], floor: Floor): DrawingFinding[] {
  return inputs
    .filter((finding) => !finding.floorId || finding.floorId === floor.id)
    .map((finding, index) => ({ id: `${finding.ruleId}-${index}`, severity: finding.severity, message: finding.message, objectIds: finding.objectIds, point: findingPoint(finding.objectIds, floor) }));
}

function roadCorridors(siteBounds: Rectangle, edges: Building["site"]["roadEdges"]): DrawingRoadCorridor[] {
  const right = siteBounds.x + siteBounds.width;
  const bottom = siteBounds.y + siteBounds.depth;
  return edges.map((edge) => {
    if (edge === "north") {
      const bounds = { x: siteBounds.x, y: siteBounds.y - ROAD_OUTER_EXTENT_MM, width: siteBounds.width, depth: ROAD_WIDTH_MM };
      return { edge, bounds, labelPoint: { x: siteBounds.x + siteBounds.width / 2, y: bounds.y + bounds.depth / 2 }, labelRotation: 0 };
    }
    if (edge === "south") {
      const bounds = { x: siteBounds.x, y: bottom + ROAD_INNER_CLEARANCE_MM, width: siteBounds.width, depth: ROAD_WIDTH_MM };
      return { edge, bounds, labelPoint: { x: siteBounds.x + siteBounds.width / 2, y: bounds.y + bounds.depth / 2 }, labelRotation: 0 };
    }
    if (edge === "west") {
      const bounds = { x: siteBounds.x - ROAD_OUTER_EXTENT_MM, y: siteBounds.y, width: ROAD_WIDTH_MM, depth: siteBounds.depth };
      return { edge, bounds, labelPoint: { x: bounds.x + bounds.width / 2, y: siteBounds.y + siteBounds.depth / 2 }, labelRotation: -90 };
    }
    const bounds = { x: right + ROAD_INNER_CLEARANCE_MM, y: siteBounds.y, width: ROAD_WIDTH_MM, depth: siteBounds.depth };
    return { edge, bounds, labelPoint: { x: bounds.x + bounds.width / 2, y: siteBounds.y + siteBounds.depth / 2 }, labelRotation: -90 };
  });
}

type DrawingBuildOptions = {
  findings?: DrawingFindingInput[];
  scheme?: { name: string; partiId: string; style: string };
  targetAreaByRoomId?: Readonly<Record<string, number>>;
};

function floorArtifact(building: Building, floor: Floor, options: DrawingBuildOptions): DrawingFloorArtifact {
  const siteBounds = { x: 0, y: 0, width: building.site.widthMm, depth: building.site.depthMm };
  const baseMargin = Math.max(1600, Math.round(Math.min(siteBounds.width, siteBounds.depth) * 0.11));
  const rooms = floor.spaces.map((space, index): DrawingRoom => ({
    id: space.id,
    name: space.name,
    type: space.type,
    zone: ROOM_ZONE[space.type],
    bounds: space.bounds,
    polygon: space.planningCellPolygon.points,
    areaMm2: space.areaMm2,
    accessible: space.accessible,
    edgeTreatment: isVerandahSpace(space) && isPerimeterOpenSpace(space) ? "open" : undefined,
    label: labelForSpace(space, index),
  }));
  const schedule = rooms
    .filter((room) => room.label.mode === "schedule")
    .map((room) => ({ ref: room.label.scheduleRef!, roomId: room.id, name: room.name, areaMm2: room.areaMm2 }));
  const areaSchedule = rooms
    .filter((room) => !["circulation", "stair"].includes(room.type))
    .map((room, index) => {
      const targetAreaMm2 = options.targetAreaByRoomId?.[room.id];
      return {
        ref: `R${String(index + 1).padStart(2, "0")}`,
        roomId: room.id,
        name: room.name,
        achievedAreaMm2: room.areaMm2,
        targetAreaMm2,
        underTarget: Boolean(targetAreaMm2 && room.areaMm2 < targetAreaMm2 * 0.85),
      };
    });
  const roads = roadCorridors(siteBounds, building.site.roadEdges);
  const hasRoad = (edge: Building["site"]["roadEdges"][number]) => building.site.roadEdges.includes(edge);
  const annotationTop = siteBounds.y + siteBounds.depth + (hasRoad("south") ? ROAD_OUTER_EXTENT_MM + 700 : 900);
  const titleY = annotationTop + 2200;
  const titleHeight = 2800;
  const annotationLayout: DrawingAnnotationLayout = {
    scaleOrigin: { x: siteBounds.x + 500, y: annotationTop },
    legendOrigin: { x: siteBounds.x + 500, y: annotationTop + 800 },
    titleY,
    titleHeight,
    scheduleOrigin: { x: siteBounds.x + 500, y: titleY + titleHeight + 520 },
  };
  const scheduleRows = Math.ceil(areaSchedule.length / 2);
  const scheduleBottom = areaSchedule.length
    ? annotationLayout.scheduleOrigin.y + 430 + (scheduleRows - 1) * 350 + 300
    : annotationLayout.titleY + annotationLayout.titleHeight;
  const drawingBottom = Math.max(annotationLayout.titleY + annotationLayout.titleHeight, scheduleBottom) + 700;
  const edgeMargin = ROAD_OUTER_EXTENT_MM + ROAD_VIEW_PADDING_MM;
  const leftMargin = hasRoad("west") ? Math.max(baseMargin, edgeMargin) : baseMargin;
  const topMargin = hasRoad("north") ? Math.max(baseMargin, edgeMargin) : baseMargin;
  const legendRight = annotationLayout.legendOrigin.x + 7000;
  const contentRightMargin = Math.max(0, legendRight - (siteBounds.x + siteBounds.width)) + 500;
  const rightMargin = Math.max(hasRoad("east") ? edgeMargin : baseMargin, contentRightMargin);
  const wallById = new Map(floor.walls.map((wall) => [wall.id, wall]));

  return {
    artifactSchemaVersion: 2,
    id: `${building.candidate.geometryHash}-${floor.id}-${RENDERER_VERSION}`,
    rendererVersion: RENDERER_VERSION,
    buildingId: building.candidate.geometryHash,
    floorId: floor.id,
    floorLabel: floor.label,
    floorLevel: floor.level,
    facing: building.site.facing,
    roadEdges: building.site.roadEdges,
    roadCorridors: roads,
    annotationLayout,
    viewBox: {
      x: siteBounds.x - leftMargin,
      y: siteBounds.y - topMargin,
      width: siteBounds.width + leftMargin + rightMargin,
      depth: topMargin + drawingBottom - siteBounds.y,
    },
    siteBounds,
    envelope: floor.envelope,
    rooms,
    walls: floor.walls
      .filter((wall) => !isVerandahOpenEdgeWall(wall, floor.spaces))
      .map(({ id, start, end, thicknessMm, type }) => ({ id, start, end, thicknessMm, type })),
    columns: (building.structuralConcept?.columns ?? [])
      .filter((column) => column.servedFloorIds.includes(floor.id))
      .map(({ id, center, widthMm, depthMm }) => ({ id, center, widthMm, depthMm })),
    openings: floor.openings.flatMap((opening) => {
      const wall = wallById.get(opening.wallId);
      return wall ? [openingGeometry(opening, wall, floor)] : [];
    }),
    furniture: floor.spaces.map(furnitureForSpace),
    dimensions: { overall: overallDimensions(siteBounds, floor.envelope), internal: internalDimensions(floor.spaces) },
    routes: routesForFloor(floor),
    findings: findingsForFloor(options.findings ?? [], floor),
    schedule,
    areaSchedule,
    scaleBarMm: siteBounds.width >= 10_000 ? 5000 : 2000,
    metadata: {
      algorithmVersion: building.algorithmVersion,
      rulePackVersion: building.rulePackVersion,
      seed: building.seed,
      candidate: `${building.candidate.generatorId} / ${building.candidate.index}`,
      schemeName: options.scheme?.name,
      partiId: options.scheme?.partiId,
      style: options.scheme?.style,
    },
  };
}

function projectedRidges(planes: Array<{ vertices: Array<{ x: number; y: number; z: number }> }>): Segment2[] {
  const vertices = planes.flatMap((plane) => plane.vertices);
  const maximum = Math.max(...vertices.map((point) => point.z));
  const high = [...new Map(vertices.filter((point) => point.z === maximum).map((point) => [`${point.x}:${point.y}`, point])).values()];
  return high.length === 2 ? [{ start: { x: high[0].x, y: high[0].y }, end: { x: high[1].x, y: high[1].y } }] : [];
}

function legacyDrawingAdapter(building: CurrentBuilding, floor: CurrentFloor): { building: Building; floor: Floor } {
  const spaces: Space[] = floor.spaces.map((space) => {
    const region = floor.regions.find((candidate) => candidate.id === space.regionId);
    if (!region) throw new Error(`DRAWING_REGION_MISSING:${space.id}`);
    const bounds = orthogonalPolygonBounds(region.polygon);
    return {
      id: space.id,
      floorId: floor.id,
      name: space.name,
      type: space.type,
      planningCellPolygon: region.polygon,
      bounds,
      areaMm2: orthogonalPolygonAreaMm2(region.polygon),
      occupied: region.kind === "interior",
      accessible: space.accessible,
      perimeterOpen: space.perimeterOpen,
    };
  });
  const legacyFloor: Floor = {
    id: floor.id,
    label: floor.label,
    level: floor.level,
    elevationMm: floor.elevationMm,
    floorHeightMm: floor.floorHeightMm,
    envelope: orthogonalPolygonBounds(floor.envelope),
    spaces,
    walls: floor.walls,
    openings: floor.openings,
  };
  return {
    floor: legacyFloor,
    building: {
      buildingSchemaVersion: 2,
      algorithmVersion: building.algorithmVersion,
      rulePackVersion: building.rulePackVersion,
      rendererVersion: building.rendererVersion,
      seed: building.seed,
      candidate: building.candidate as Building["candidate"],
      site: building.site,
      floors: [legacyFloor],
      verticalConnectors: building.verticalConnectors,
      structuralConcept: building.structuralConcept,
    },
  };
}

function currentFloorArtifact(building: CurrentBuilding, floor: CurrentFloor, options: DrawingBuildOptions): DrawingFloorArtifact {
  const adapter = legacyDrawingAdapter(building, floor);
  const artifact = floorArtifact(adapter.building, adapter.floor, options);
  const openingById = new Map(floor.openings.map((opening) => [opening.id, opening]));
  const floorSpaceIds = new Set(floor.spaces.map((space) => space.id));
  const roofOverlay = building.roofSystems.flatMap((roof) => {
    const onFloor = roof.kind === "open_pergola" ? roof.hostFloorId === floor.id : roof.servesSpaceIds.some((id) => floorSpaceIds.has(id));
    if (!onFloor) return [];
    return [{
      id: roof.id,
      kind: roof.kind,
      footprint: roof.footprint.points,
      planes: roof.kind === "open_pergola" ? [] : roof.planes.map((plane) => ({ id: plane.id, vertices: plane.vertices })),
      ridges: roof.kind === "open_pergola" ? [] : projectedRidges(roof.planes),
    }];
  });
  return {
    ...artifact,
    artifactSchemaVersion: 3,
    envelope: orthogonalPolygonBounds(floor.envelope),
    openings: artifact.openings.map((opening) => {
      const source = openingById.get(opening.id);
      return { ...opening, role: source?.role, isMainEntry: source?.role === "main_entry", isEntrance: source?.role === "main_entry" || source?.role === "secondary_entry" || source?.role === "service_entry" };
    }),
    floorRegions: floor.regions.map((region) => ({ id: region.id, kind: region.kind, polygon: region.polygon.points, spaceId: region.spaceId })),
    // V3 schedules use every canonical space region. Circulation and stair are
    // constructed floor area; only explicit non-space regions such as
    // intentional_unbuilt are absent. Keep the historical v2 filter frozen.
    areaSchedule: artifact.rooms.map((room, index) => {
      const targetAreaMm2 = options.targetAreaByRoomId?.[room.id];
      return {
        ref: `R${String(index + 1).padStart(2, "0")}`,
        roomId: room.id,
        name: room.name,
        achievedAreaMm2: room.areaMm2,
        targetAreaMm2,
        underTarget: Boolean(targetAreaMm2 && room.areaMm2 < targetAreaMm2 * 0.85),
      };
    }),
    constructedFootprints: floor.regions.filter((region) => region.kind === "interior" || region.kind === "covered_outdoor").map((region) => region.polygon.points),
    intentionalUnbuiltRegions: floor.regions.filter((region) => region.kind === "intentional_unbuilt").map((region) => ({ id: region.id, polygon: region.polygon.points })),
    roofOverlay,
    supports: [
      ...building.structuralConcept.columns.filter((column) => column.servedFloorIds.includes(floor.id)).map((column) => ({ id: column.id, role: "primary_column" as const, geometry: column.center })),
      ...building.secondaryRoofSupports.filter((support) => support.floorId === floor.id).map((support) => ({ id: support.id, role: support.role, geometry: support.geometry })),
    ],
    guards: building.edgeProtections.filter((guard) => guard.floorId === floor.id).map((guard) => ({ id: guard.id, edge: guard.edge, kind: guard.kind, heightMm: guard.heightMm })),
    mainEntryId: floor.openings.find((opening) => opening.role === "main_entry")?.id,
  };
}

export function buildDrawing(building: ReadableBuilding, options: DrawingBuildOptions = {}): BuildingDrawing {
  if (building.buildingSchemaVersion === 3) return {
    artifactSchemaVersion: 3,
    rendererVersion: RENDERER_VERSION,
    buildingId: building.candidate.geometryHash,
    floors: building.floors.map((floor) => currentFloorArtifact(building, floor, options)),
  };
  return {
    artifactSchemaVersion: 2,
    rendererVersion: RENDERER_VERSION,
    buildingId: building.candidate.geometryHash,
    floors: building.floors.map((floor) => floorArtifact(building, floor, options)),
  };
}

export { areaLabel };
