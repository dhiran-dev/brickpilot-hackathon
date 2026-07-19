import type { CurrentBuildingRequirements } from "@/lib/building/requirements";
import type {
  EnclosureRoofSystem,
  LinearMember,
  OpenPergolaSystem,
  OrthogonalPolygon,
  Point,
  Point3,
  Rectangle,
  RoofBearingLine,
  RoofPlane,
  RoofSupportReference,
  RoofSystem,
  SecondaryRoofSupport,
  Segment2,
  StructuralConcept,
  WallSegment,
} from "@/lib/building/schema";
import type { V3CirculatedScheme, V3CirculatedFloor } from "@/lib/building/candidates/v3-circulation";
import {
  normalizeOrthogonalPolygon,
  orthogonalPolygonBounds,
  rectangleToOrthogonalPolygon,
} from "@/lib/building/orthogonal-partition";
import {
  CANOPY_MAX_UNSUPPORTED_SPAN_MM,
  ENCLOSURE_ROOF_MAX_SUPPORT_REACH_MM,
  PERGOLA_MAX_POST_SPACING_MM,
  PERGOLA_MIN_OPEN_AREA_RATIO,
} from "@/lib/building/v3-constants";

const DEFAULT_ROOF_RISE_PER_RUN = 0.3;
const ROOF_OVERHANG_MM = 450;
const CANOPY_POST_SECTION_MM = 230;
const PERGOLA_POST_SECTION_MM = 180;
const PERGOLA_FRAME_SECTION_MM = { width: 180, depth: 240 } as const;
const PERGOLA_SLAT_SECTION_MM = { width: 90, depth: 140 } as const;
const PERGOLA_SLAT_SPACING_MM = 300;

export type V3PhysicalRoofResult = {
  roofSystems: RoofSystem[];
  secondaryRoofSupports: SecondaryRoofSupport[];
  roofSupportReferences: RoofSupportReference[];
};

export type RoofSupportIssue = {
  roofSystemId: string;
  code: "UNBACKED_BEARING_LINE" | "SUPPORT_REACH_EXCEEDED" | "MEMBER_SPAN_EXCEEDED";
  measuredMm: number;
  requiredMm: number;
};

function rectangleRight(rectangle: Rectangle) {
  return rectangle.x + rectangle.width;
}

function rectangleBottom(rectangle: Rectangle) {
  return rectangle.y + rectangle.depth;
}

function subtractRectangle(subject: Rectangle, cutter: Rectangle): Rectangle[] {
  const left = Math.max(subject.x, cutter.x);
  const top = Math.max(subject.y, cutter.y);
  const right = Math.min(rectangleRight(subject), rectangleRight(cutter));
  const bottom = Math.min(rectangleBottom(subject), rectangleBottom(cutter));
  if (right <= left || bottom <= top) return [subject];
  return [
    { x: subject.x, y: subject.y, width: subject.width, depth: top - subject.y },
    { x: subject.x, y: bottom, width: subject.width, depth: rectangleBottom(subject) - bottom },
    { x: subject.x, y: top, width: left - subject.x, depth: bottom - top },
    { x: right, y: top, width: rectangleRight(subject) - right, depth: bottom - top },
  ].filter((fragment) => fragment.width > 0 && fragment.depth > 0);
}

function subtractRectangles(subject: Rectangle, cutters: Rectangle[]) {
  return cutters.reduce<Rectangle[]>((fragments, cutter) => fragments.flatMap((fragment) => subtractRectangle(fragment, cutter)), [subject]);
}

function roofPoint(x: number, y: number, z: number): Point3 {
  return { x: Math.round(x), y: Math.round(y), z: Math.round(z) };
}

/** Canonical roof planes for a rectangular footprint. Plane vertices are the single pitch/ridge authority. */
export function roofPlanesForRectangle(
  id: string,
  kind: EnclosureRoofSystem["kind"],
  rectangle: Rectangle,
  eaveHeightMm: number,
  risePerRun = DEFAULT_ROOF_RISE_PER_RUN,
): RoofPlane[] {
  const x0 = rectangle.x;
  const x1 = rectangleRight(rectangle);
  const y0 = rectangle.y;
  const y1 = rectangleBottom(rectangle);
  if (kind === "flat_slab" || kind === "solid_canopy") return [{
    id: `${id}-plane-1`,
    vertices: [roofPoint(x0, y0, eaveHeightMm), roofPoint(x0, y1, eaveHeightMm), roofPoint(x1, y1, eaveHeightMm), roofPoint(x1, y0, eaveHeightMm)],
    drainageDirection: kind === "solid_canopy" ? { x: 0, y: 1 } : undefined,
  }];
  if (kind === "shed") {
    const rise = Math.max(300, Math.round(rectangle.depth * risePerRun));
    return [{
      id: `${id}-plane-1`,
      vertices: [roofPoint(x0, y0, eaveHeightMm + rise), roofPoint(x0, y1, eaveHeightMm), roofPoint(x1, y1, eaveHeightMm), roofPoint(x1, y0, eaveHeightMm + rise)],
      drainageDirection: { x: 0, y: 1 },
    }];
  }
  if (kind === "hip") {
    const centreX = Math.round((x0 + x1) / 2);
    const centreY = Math.round((y0 + y1) / 2);
    const apex = roofPoint(centreX, centreY, eaveHeightMm + Math.max(450, Math.round(Math.min(rectangle.width, rectangle.depth) * risePerRun / 2)));
    return [
      { id: `${id}-plane-north`, vertices: [roofPoint(x0, y0, eaveHeightMm), apex, roofPoint(x1, y0, eaveHeightMm)], drainageDirection: { x: 0, y: -1 } },
      { id: `${id}-plane-east`, vertices: [roofPoint(x1, y0, eaveHeightMm), apex, roofPoint(x1, y1, eaveHeightMm)], drainageDirection: { x: 1, y: 0 } },
      { id: `${id}-plane-south`, vertices: [roofPoint(x1, y1, eaveHeightMm), apex, roofPoint(x0, y1, eaveHeightMm)], drainageDirection: { x: 0, y: 1 } },
      { id: `${id}-plane-west`, vertices: [roofPoint(x0, y1, eaveHeightMm), apex, roofPoint(x0, y0, eaveHeightMm)], drainageDirection: { x: -1, y: 0 } },
    ];
  }
  const ridgeAlongX = rectangle.width >= rectangle.depth;
  const halfRun = (ridgeAlongX ? rectangle.depth : rectangle.width) / 2;
  const ridgeHeight = eaveHeightMm + Math.max(450, Math.round(halfRun * risePerRun));
  if (ridgeAlongX) {
    const ridgeY = Math.round((y0 + y1) / 2);
    return [
      { id: `${id}-plane-north`, vertices: [roofPoint(x0, y0, eaveHeightMm), roofPoint(x0, ridgeY, ridgeHeight), roofPoint(x1, ridgeY, ridgeHeight), roofPoint(x1, y0, eaveHeightMm)], drainageDirection: { x: 0, y: -1 } },
      { id: `${id}-plane-south`, vertices: [roofPoint(x1, y1, eaveHeightMm), roofPoint(x1, ridgeY, ridgeHeight), roofPoint(x0, ridgeY, ridgeHeight), roofPoint(x0, y1, eaveHeightMm)], drainageDirection: { x: 0, y: 1 } },
    ];
  }
  const ridgeX = Math.round((x0 + x1) / 2);
  return [
    { id: `${id}-plane-west`, vertices: [roofPoint(x0, y1, eaveHeightMm), roofPoint(ridgeX, y1, ridgeHeight), roofPoint(ridgeX, y0, ridgeHeight), roofPoint(x0, y0, eaveHeightMm)], drainageDirection: { x: -1, y: 0 } },
    { id: `${id}-plane-east`, vertices: [roofPoint(x1, y0, eaveHeightMm), roofPoint(ridgeX, y0, ridgeHeight), roofPoint(ridgeX, y1, ridgeHeight), roofPoint(x1, y1, eaveHeightMm)], drainageDirection: { x: 1, y: 0 } },
  ];
}

function pointKey(point: Point) {
  return `${point.x}:${point.y}`;
}

function polygonSegments(polygon: OrthogonalPolygon): Segment2[] {
  return polygon.points.map((start, index) => ({ start, end: polygon.points[(index + 1) % polygon.points.length] }));
}

function sameSegment(left: Segment2, right: Segment2) {
  return (pointKey(left.start) === pointKey(right.start) && pointKey(left.end) === pointKey(right.end))
    || (pointKey(left.start) === pointKey(right.end) && pointKey(left.end) === pointKey(right.start));
}

function collinearOverlap(left: Segment2, right: Segment2, toleranceMm = 1) {
  const leftHorizontal = Math.abs(left.start.y - left.end.y) <= toleranceMm;
  const rightHorizontal = Math.abs(right.start.y - right.end.y) <= toleranceMm;
  if (leftHorizontal !== rightHorizontal) return false;
  if (leftHorizontal) {
    if (Math.abs(left.start.y - right.start.y) > toleranceMm) return false;
    return Math.min(Math.max(left.start.x, left.end.x), Math.max(right.start.x, right.end.x))
      - Math.max(Math.min(left.start.x, left.end.x), Math.min(right.start.x, right.end.x)) > toleranceMm;
  }
  if (Math.abs(left.start.x - right.start.x) > toleranceMm) return false;
  return Math.min(Math.max(left.start.y, left.end.y), Math.max(right.start.y, right.end.y))
    - Math.max(Math.min(left.start.y, left.end.y), Math.min(right.start.y, right.end.y)) > toleranceMm;
}

function wallSegment(wall: WallSegment): Segment2 {
  return { start: wall.start, end: wall.end };
}

function pointOnSegment(point: Point, segment: Segment2, toleranceMm = 1) {
  const cross = (segment.end.x - segment.start.x) * (point.y - segment.start.y) - (segment.end.y - segment.start.y) * (point.x - segment.start.x);
  if (Math.abs(cross) > toleranceMm) return false;
  return point.x >= Math.min(segment.start.x, segment.end.x) - toleranceMm
    && point.x <= Math.max(segment.start.x, segment.end.x) + toleranceMm
    && point.y >= Math.min(segment.start.y, segment.end.y) - toleranceMm
    && point.y <= Math.max(segment.start.y, segment.end.y) + toleranceMm;
}

function segmentLength(segment: Segment2) {
  return Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y);
}

function evenlySpacedPoints(segment: Segment2, maximumSpacingMm: number) {
  const length = segmentLength(segment);
  const divisions = Math.max(1, Math.ceil(length / maximumSpacingMm));
  return Array.from({ length: divisions + 1 }, (_, index) => ({
    x: Math.round(segment.start.x + (segment.end.x - segment.start.x) * index / divisions),
    y: Math.round(segment.start.y + (segment.end.y - segment.start.y) * index / divisions),
  }));
}

function bearingWallForEdge(edge: Segment2, floor: V3CirculatedFloor, servedSpaceIds: string[]) {
  return floor.walls.find((wall) => servedSpaceIds.some((spaceId) => wall.adjacentSpaceIds.includes(spaceId)) && collinearOverlap(edge, wallSegment(wall)));
}

function enclosureSupportReference(
  roof: EnclosureRoofSystem,
  floor: V3CirculatedFloor,
  floors: readonly V3CirculatedFloor[],
  structuralConcept: StructuralConcept,
): RoofSupportReference {
  const lines = polygonSegments(roof.footprint).flatMap<RoofBearingLine>((segment, index) => {
    const wall = bearingWallForEdge(segment, floor, roof.servesSpaceIds);
    if (wall) return [{ id: `${roof.id}-bearing-${index + 1}`, segment, role: "perimeter" as const, bearingWallIds: [wall.id], structuralColumnIds: [], secondarySupportIds: [] }];
    // A setback exposes part of a lower floor as roof. The newly exposed edge is
    // commonly tied into the exterior wall of the upper storey, whose base is at
    // this roof's eave elevation. That wall is a real bearing/ledger condition even
    // though it serves a different space, so preserve it explicitly in the support
    // reference instead of treating the setback fragment as an unsupported island.
    const upperWall = floors
      .filter((candidate) => candidate.elevationMm === roof.eaveHeightMm)
      .flatMap((candidate) => candidate.walls)
      .find((candidate) => candidate.type === "exterior" && collinearOverlap(segment, wallSegment(candidate)));
    if (upperWall) return [{ id: `${roof.id}-bearing-${index + 1}`, segment, role: "perimeter" as const, bearingWallIds: [upperWall.id], structuralColumnIds: [], secondarySupportIds: [] }];
    const columns = structuralConcept.columns.filter((column) => column.servedFloorIds.includes(floor.floorId) && (pointOnSegment(column.center, segment)));
    return columns.length >= 2 ? [{ id: `${roof.id}-bearing-${index + 1}`, segment, role: "perimeter" as const, bearingWallIds: [], structuralColumnIds: columns.map((column) => column.id), secondarySupportIds: [] }] : [];
  });
  // A small setback fragment can sit wholly inside the lower room outline, so none of the
  // fragment's cut edges is itself a wall. Bind that fragment to the nearest authoritative wall
  // of the served room as an interior bearing/ledger line instead of inventing a free-standing
  // post inside an occupied space.
  const fallbackWall = floor.walls
    .filter((wall) => roof.servesSpaceIds.some((spaceId) => wall.adjacentSpaceIds.includes(spaceId)))
    .sort((left, right) => distancePointToSegment({
      x: orthogonalPolygonBounds(roof.footprint).x + orthogonalPolygonBounds(roof.footprint).width / 2,
      y: orthogonalPolygonBounds(roof.footprint).y + orthogonalPolygonBounds(roof.footprint).depth / 2,
    }, wallSegment(left)) - distancePointToSegment({
      x: orthogonalPolygonBounds(roof.footprint).x + orthogonalPolygonBounds(roof.footprint).width / 2,
      y: orthogonalPolygonBounds(roof.footprint).y + orthogonalPolygonBounds(roof.footprint).depth / 2,
    }, wallSegment(right)) || left.id.localeCompare(right.id))[0];
  if (!fallbackWall && lines.length === 0) throw new Error(`ROOF_SUPPORT_INCOMPLETE:${roof.id}:NO_BEARING_LINE`);
  const fallbackAlreadyReferenced = fallbackWall
    ? lines.some((line) => line.bearingWallIds.includes(fallbackWall.id))
    : true;
  return {
    roofSystemId: roof.id,
    bearingLines: [
      ...lines,
      ...fallbackWall && !fallbackAlreadyReferenced
        ? [{
            id: `${roof.id}-bearing-interior-ledger`,
            segment: wallSegment(fallbackWall),
            role: "interior" as const,
            bearingWallIds: [fallbackWall.id],
            structuralColumnIds: [],
            secondarySupportIds: [],
          }]
        : [],
    ],
  };
}

function supportsAlongEdges(input: {
  roofId: string;
  floorId: string;
  baseElevationMm: number;
  topElevationMm: number;
  role: "canopy_post" | "pergola_post";
  footprint: OrthogonalPolygon;
  maximumSpacingMm: number;
  sectionMm: number;
  excludedEdge?: Segment2;
}): Array<SecondaryRoofSupport & { role: "canopy_post" | "pergola_post"; geometry: Point; sectionMm: { x: number; y: number } }> {
  const points = polygonSegments(input.footprint)
    .filter((edge) => !input.excludedEdge || !sameSegment(edge, input.excludedEdge))
    .flatMap((edge) => evenlySpacedPoints(edge, input.maximumSpacingMm));
  const unique = [...new Map(points.map((point) => [pointKey(point), point])).values()];
  return unique.map((geometry, index) => ({
    id: `${input.roofId}-${input.role}-${index + 1}`,
    role: input.role,
    floorId: input.floorId,
    baseElevationMm: input.baseElevationMm,
    topElevationMm: input.topElevationMm,
    roofSystemIds: [input.roofId],
    geometry,
    sectionMm: { x: input.sectionMm, y: input.sectionMm },
  }));
}

function coordinatePointSupportAroundOpenings(
  support: SecondaryRoofSupport & { role: "canopy_post" | "pergola_post"; geometry: Point; sectionMm: { x: number; y: number } },
  floor: V3CirculatedFloor,
  perimeterEdges?: readonly Segment2[],
) {
  let geometries = [support.geometry];
  for (const opening of floor.openings) {
    const wall = floor.walls.find((candidate) => candidate.id === opening.wallId);
    if (!wall) continue;
    const length = segmentLength(wallSegment(wall));
    geometries = geometries.flatMap((geometry) => {
      if (!pointOnSegment(geometry, wallSegment(wall))) return [geometry];
      // A support may meet an unrelated door wall at a T-junction. Only coordinate
      // openings that lie on the same perimeter edge as the support; otherwise a
      // valid perimeter post can be deleted or moved into the host clear zone.
      if (perimeterEdges && !perimeterEdges.some((edge) => pointOnSegment(geometry, edge)
        && collinearOverlap(edge, wallSegment(wall)))) return [geometry];
      const offset = Math.hypot(geometry.x - wall.start.x, geometry.y - wall.start.y);
      const halfSection = support.sectionMm.x / 2;
      if (offset + halfSection < opening.offsetMm || offset - halfSection > opening.offsetMm + opening.widthMm) return [geometry];
      return [opening.offsetMm - halfSection - 1, opening.offsetMm + opening.widthMm + halfSection + 1]
        .filter((candidate) => candidate >= 0 && candidate <= length)
        .map((safeOffset) => {
          const ratio = length === 0 ? 0 : safeOffset / length;
          return {
            x: Math.round(wall.start.x + (wall.end.x - wall.start.x) * ratio),
            y: Math.round(wall.start.y + (wall.end.y - wall.start.y) * ratio),
          };
        })
        .filter((candidate) => !perimeterEdges || perimeterEdges.some((edge) => pointOnSegment(candidate, edge)));
    });
  }
  return [...new Map(geometries.map((geometry) => [pointKey(geometry), geometry])).values()].map((geometry, index) => ({
    ...support,
    id: index === 0 ? support.id : `${support.id}-clear-${index + 1}`,
    geometry,
  }));
}

function canopySupports(roof: EnclosureRoofSystem, floor: V3CirculatedFloor, floors: readonly V3CirculatedFloor[] = [floor]) {
  const footprintEdges = polygonSegments(roof.footprint);
  const servedBounds = floor.spaces.filter((space) => roof.servesSpaceIds.includes(space.id)).map((space) => space.bounds);
  const ledgerEdges = footprintEdges.filter((edge) => {
    const groundWall = floor.walls.find((wall) => wall.adjacentSpaceIds.length === 2
      && roof.servesSpaceIds.some((id) => wall.adjacentSpaceIds.includes(id))
      && collinearOverlap(edge, wallSegment(wall)));
    const upperWall = floors
      .filter((candidate) => candidate.elevationMm === roof.eaveHeightMm)
      .flatMap((candidate) => candidate.walls)
      .find((wall) => wall.type === "exterior" && collinearOverlap(edge, wallSegment(wall)));
    return Boolean(groundWall || upperWall);
  });
  const ledgers: SecondaryRoofSupport[] = ledgerEdges.map((edge, index) => ({
    id: `${roof.id}-ledger-${index + 1}`,
    role: "ledger",
    floorId: floor.floorId,
    baseElevationMm: floor.elevationMm,
    topElevationMm: roof.eaveHeightMm,
    roofSystemIds: [roof.id],
    geometry: edge,
    sectionMm: { x: 150, y: 250 },
  }));
  const posts = supportsAlongEdges({
    roofId: roof.id,
    floorId: floor.floorId,
    baseElevationMm: floor.elevationMm,
    topElevationMm: roof.eaveHeightMm,
    role: "canopy_post",
    footprint: roof.footprint,
    maximumSpacingMm: CANOPY_MAX_UNSUPPORTED_SPAN_MM,
    sectionMm: CANOPY_POST_SECTION_MM,
    excludedEdge: undefined,
  }).flatMap((support) => {
    // Ledger-bearing edges transfer into the enclosure wall; duplicating a post
    // on that same edge can obstruct the door/window the ledger is spanning.
    if (ledgerEdges.some((edge) => pointOnSegment(support.geometry, edge))) return [];
    // Fragment roofs can have internal cut edges where an upper storey overlaps the parking
    // canopy. Posts on those cut edges obstruct the host clear zone; keep posts on the actual
    // host perimeter and coordinate them around authoritative openings.
    if (servedBounds.some((bounds) => support.geometry.x > bounds.x && support.geometry.x < rectangleRight(bounds)
      && support.geometry.y > bounds.y && support.geometry.y < rectangleBottom(bounds))) return [];
    return coordinatePointSupportAroundOpenings(support, floor, footprintEdges);
  });
  if (ledgers.length === 0 && posts.length === 0) {
    // A fully internal setback island is bounded by the upper slab edge on every side. Model
    // continuous ledgers at those slab edges; adding posts here would obstruct the parking bay.
    ledgerEdges.push(...footprintEdges);
    ledgers.push(...footprintEdges.map((edge, index): SecondaryRoofSupport => ({
      id: `${roof.id}-slab-edge-ledger-${index + 1}`,
      role: "ledger",
      floorId: floor.floorId,
      baseElevationMm: floor.elevationMm,
      topElevationMm: roof.eaveHeightMm,
      roofSystemIds: [roof.id],
      geometry: edge,
      sectionMm: { x: 150, y: 250 },
    })));
  }
  const supports = [...ledgers, ...posts];
  const reference: RoofSupportReference = {
    roofSystemId: roof.id,
    bearingLines: footprintEdges.filter((segment) => {
      const midpoint = { x: (segment.start.x + segment.end.x) / 2, y: (segment.start.y + segment.end.y) / 2 };
      return ledgerEdges.some((edge) => sameSegment(edge, segment)) || !servedBounds.some((bounds) => midpoint.x > bounds.x && midpoint.x < rectangleRight(bounds)
        && midpoint.y > bounds.y && midpoint.y < rectangleBottom(bounds));
    }).map((segment, index) => ({
      id: `${roof.id}-bearing-${index + 1}`,
      segment,
      role: "perimeter" as const,
      bearingWallIds: [],
      structuralColumnIds: [],
      secondarySupportIds: supports.filter((support) => support.role === "ledger"
        ? sameSegment(support.geometry, segment)
        : pointOnSegment(support.geometry, segment)).map((support) => support.id),
    })).filter((line) => line.secondarySupportIds.length > 0),
  };
  return { supports, reference };
}

function member(id: string, start: Point3, end: Point3, sectionMm: LinearMember["sectionMm"]): LinearMember {
  return { id, start, end, sectionMm };
}

function pergolaForRequirement(
  requirement: CurrentBuildingRequirements["shadeStructures"][number],
  floor: V3CirculatedFloor,
  hostSpaceId: string,
  bounds: Rectangle,
  preserveHostClearZone = false,
): OpenPergolaSystem {
  const coversHost = requirement.location !== "front_entry";
  const targetArea = coversHost
    ? bounds.width * bounds.depth
    : requirement.targetAreaM2
      ? Math.round(requirement.targetAreaM2 * 1_000_000)
      : bounds.width * bounds.depth;
  // Parking shade may not introduce a post line through the vehicle clear zone.
  // Treat its requested area as a minimum and span the complete parking bay so
  // every post remains on the canonical parking perimeter.
  const depth = coversHost || preserveHostClearZone
    ? bounds.depth
    : Math.max(1200, Math.min(bounds.depth, Math.round(targetArea / Math.max(1, bounds.width))));
  const footprintBounds = { ...bounds, depth };
  const footprint = normalizeOrthogonalPolygon(rectangleToOrthogonalPolygon(footprintBounds));
  const topElevationMm = floor.elevationMm + floor.floorHeightMm;
  const edges = polygonSegments(footprint);
  const frameMembers = edges.map((edge, index) => member(
    `${requirement.id}-frame-${index + 1}`,
    roofPoint(edge.start.x, edge.start.y, topElevationMm),
    roofPoint(edge.end.x, edge.end.y, topElevationMm),
    PERGOLA_FRAME_SECTION_MM,
  ));
  const slatOrientation = footprintBounds.width >= footprintBounds.depth ? "y" as const : "x" as const;
  const crossSpan = slatOrientation === "y" ? footprintBounds.width : footprintBounds.depth;
  const slatCount = Math.max(2, Math.ceil(crossSpan / PERGOLA_SLAT_SPACING_MM));
  const slatMembers = Array.from({ length: slatCount }, (_, index) => {
    const offset = Math.round((index + 0.5) * crossSpan / slatCount);
    return slatOrientation === "y"
      ? member(`${requirement.id}-slat-${index + 1}`, roofPoint(footprintBounds.x + offset, footprintBounds.y, topElevationMm + 80), roofPoint(footprintBounds.x + offset, rectangleBottom(footprintBounds), topElevationMm + 80), PERGOLA_SLAT_SECTION_MM)
      : member(`${requirement.id}-slat-${index + 1}`, roofPoint(footprintBounds.x, footprintBounds.y + offset, topElevationMm + 80), roofPoint(rectangleRight(footprintBounds), footprintBounds.y + offset, topElevationMm + 80), PERGOLA_SLAT_SECTION_MM);
  });
  const coveredFraction = Math.min(1, slatCount * PERGOLA_SLAT_SECTION_MM.width / crossSpan);
  const openAreaRatio = Number((1 - coveredFraction).toFixed(4));
  if (openAreaRatio < PERGOLA_MIN_OPEN_AREA_RATIO) throw new Error(`SHADE_STRUCTURE_NOT_REALIZED:${requirement.id}:INSUFFICIENT_OPEN_RATIO`);
  return {
    id: requirement.id,
    kind: "open_pergola",
    hostFloorId: floor.floorId,
    hostSpaceId,
    footprint,
    frameMembers,
    slatMembers,
    slatOrientation,
    slatSpacingMm: Math.round(crossSpan / slatCount),
    openAreaRatio,
    topElevationMm: topElevationMm + 80,
  };
}

function solidCanopyForRequirement(
  requirement: CurrentBuildingRequirements["shadeStructures"][number],
  requirements: CurrentBuildingRequirements,
  scheme: V3CirculatedScheme,
  floor: V3CirculatedFloor,
  hostSpaceId: string,
  hostBounds: Rectangle,
): EnclosureRoofSystem {
  let rectangle: Rectangle;
  if (requirement.location !== "front_entry") {
    rectangle = { ...hostBounds };
  } else {
    const side = scheme.arrivalRealization.primaryRoadSide;
    const targetAreaMm2 = Math.round((requirement.targetAreaM2 ?? 4) * 1_000_000);
    const width = Math.min(side === "north" || side === "south" ? hostBounds.width : 1800, Math.max(1800, Math.round(Math.sqrt(targetAreaMm2 * 1.8))));
    const depth = Math.max(1200, Math.round(targetAreaMm2 / width));
    if (side === "north") rectangle = { x: hostBounds.x, y: Math.max(0, hostBounds.y - depth), width: Math.min(width, hostBounds.width), depth };
    else if (side === "south") rectangle = { x: hostBounds.x, y: Math.min(requirements.site.depthMm - depth, rectangleBottom(hostBounds)), width: Math.min(width, hostBounds.width), depth };
    else if (side === "west") rectangle = { x: Math.max(0, hostBounds.x - depth), y: hostBounds.y, width: depth, depth: Math.min(width, hostBounds.depth) };
    else rectangle = { x: Math.min(requirements.site.widthMm - depth, rectangleRight(hostBounds)), y: hostBounds.y, width: depth, depth: Math.min(width, hostBounds.depth) };
  }
  const eaveHeightMm = floor.elevationMm + floor.floorHeightMm;
  return {
    id: requirement.id,
    servesSpaceIds: [hostSpaceId],
    footprint: normalizeOrthogonalPolygon(rectangleToOrthogonalPolygon(rectangle)),
    kind: "solid_canopy",
    planes: roofPlanesForRectangle(requirement.id, "solid_canopy", rectangle, eaveHeightMm),
    eaveHeightMm,
    overhangMm: 0,
  };
}

function pergolaSupports(roof: OpenPergolaSystem, floor: V3CirculatedFloor) {
  const footprintEdges = polygonSegments(roof.footprint);
  const hostSpaceId = roof.hostSpaceId;
  // Any wall bordering the host space can carry a pergola ledger, except a wall with a
  // vehicle aperture: that edge keeps perimeter posts flanking the vehicle clear zone.
  const ledgerEdges = hostSpaceId ? footprintEdges.filter((edge) => floor.walls.some((wall) => wall.adjacentSpaceIds.includes(hostSpaceId)
    && collinearOverlap(edge, wallSegment(wall))
    && !floor.openings.some((opening) => opening.wallId === wall.id && opening.usage === "vehicle"))) : [];
  const ledgers: SecondaryRoofSupport[] = ledgerEdges.map((edge, index) => ({
    id: `${roof.id}-ledger-${index + 1}`,
    role: "ledger",
    floorId: floor.floorId,
    baseElevationMm: floor.elevationMm,
    topElevationMm: roof.topElevationMm,
    roofSystemIds: [roof.id],
    geometry: edge,
    sectionMm: { x: PERGOLA_FRAME_SECTION_MM.width, y: PERGOLA_FRAME_SECTION_MM.depth },
  }));
  const posts = supportsAlongEdges({
    roofId: roof.id,
    floorId: floor.floorId,
    baseElevationMm: floor.elevationMm,
    topElevationMm: roof.topElevationMm,
    role: "pergola_post",
    footprint: roof.footprint,
    maximumSpacingMm: PERGOLA_MAX_POST_SPACING_MM,
    sectionMm: PERGOLA_POST_SECTION_MM,
  }).flatMap((support) => {
    const containingEdges = footprintEdges.filter((edge) => pointOnSegment(support.geometry, edge));
    const ledgerOnly = containingEdges.length > 0 && containingEdges.every((edge) => ledgerEdges.some((ledger) => sameSegment(ledger, edge)));
    if (ledgerOnly) return [];
    return coordinatePointSupportAroundOpenings(support, floor, footprintEdges);
  });
  const supports = [...ledgers, ...posts];
  return {
    supports,
    reference: {
      roofSystemId: roof.id,
      bearingLines: footprintEdges.map((segment, index) => ({
        id: `${roof.id}-bearing-${index + 1}`,
        segment,
        role: "perimeter" as const,
        bearingWallIds: [],
        structuralColumnIds: [],
        secondarySupportIds: supports.filter((support) => support.role === "ledger"
          ? sameSegment(support.geometry, segment)
          : pointOnSegment(support.geometry, segment)).map((support) => support.id),
      })),
    } satisfies RoofSupportReference,
  };
}

/**
 * Temporary product policy: enclosure roofs are flat-only.
 *
 * The requirements contract continues to accept historical roof intent so saved
 * projects remain readable, but the active physical engine must not synthesize
 * pitched geometry until that system is ready to ship.
 */
function enclosureRoofKind(): EnclosureRoofSystem["kind"] {
  return "flat_slab";
}

function hostSpaceForShade(requirements: CurrentBuildingRequirements, scheme: V3CirculatedScheme, location: CurrentBuildingRequirements["shadeStructures"][number]["location"]) {
  const preferredTypes = location === "parking" ? ["parking"] : location === "verandah" ? ["verandah", "balcony"] : location === "terrace" ? ["terrace", "balcony"] : ["foyer"];
  for (const floor of [...scheme.floors].sort((left, right) => location === "terrace" ? right.level - left.level : left.level - right.level)) {
    const space = floor.spaces.find((candidate) => preferredTypes.includes(candidate.type));
    if (space) return { floor, space };
  }
  return undefined;
}

export function deriveV3RoofSystems(
  requirements: CurrentBuildingRequirements,
  scheme: V3CirculatedScheme,
  structuralConcept: StructuralConcept,
): V3PhysicalRoofResult {
  const roofSystems: RoofSystem[] = [];
  const secondaryRoofSupports: SecondaryRoofSupport[] = [];
  const roofSupportReferences: RoofSupportReference[] = [];
  const orderedFloors = [...scheme.floors].sort((left, right) => left.level - right.level);
  const shadeHosts = new Map(requirements.shadeStructures.flatMap((requirement) => {
    const host = hostSpaceForShade(requirements, scheme, requirement.location);
    return host ? [[requirement.id, host] as const] : [];
  }));
  const explicitlyShadedHostIds = new Set([...shadeHosts.values()].map((host) => host.space.id));
  for (const floor of orderedFloors) {
    const immediateUpper = orderedFloors.find((upper) => upper.level === floor.level + 1);
    const upperBounds = immediateUpper?.regions
      .filter((region) => region.kind === "interior" || region.kind === "covered_outdoor")
      .map((region) => orthogonalPolygonBounds(region.polygon)) ?? [];
    let fragmentIndex = 0;
    for (const region of floor.regions.filter((candidate) => candidate.kind === "interior" || candidate.kind === "covered_outdoor")) {
      const space = floor.spaces.find((candidate) => candidate.id === region.spaceId);
      if (!space) continue;
      if (region.kind === "covered_outdoor" && explicitlyShadedHostIds.has(space.id)) continue;
      const regionBounds = orthogonalPolygonBounds(region.polygon);
      const exposedFragments = subtractRectangles(regionBounds, upperBounds);
      const roofFragments = region.kind === "covered_outdoor" && exposedFragments.length === 0
        // A fully occupied upper floor still needs an explicit supported transfer
        // slab over the covered outdoor space; it is not a roofless overlap.
        ? space.id.includes("-stacked-support-space-") ? [] : [regionBounds]
        : exposedFragments;
      for (const exposed of roofFragments) {
        const id = `${floor.floorId}-roof-${space.id}-${fragmentIndex + 1}`;
        const kind = region.kind === "covered_outdoor" ? "solid_canopy" : enclosureRoofKind();
        const roof: EnclosureRoofSystem = {
          id,
          servesSpaceIds: [space.id],
          footprint: normalizeOrthogonalPolygon(rectangleToOrthogonalPolygon(exposed)),
          kind,
          planes: roofPlanesForRectangle(id, kind, exposed, floor.elevationMm + floor.floorHeightMm),
          eaveHeightMm: floor.elevationMm + floor.floorHeightMm,
          overhangMm: kind === "flat_slab" ? 0 : ROOF_OVERHANG_MM,
        };
        roofSystems.push(roof);
        if (kind === "solid_canopy") {
          const canopy = canopySupports(roof, floor, orderedFloors);
          secondaryRoofSupports.push(...canopy.supports);
          roofSupportReferences.push(canopy.reference);
        } else roofSupportReferences.push(enclosureSupportReference(roof, floor, orderedFloors, structuralConcept));
        fragmentIndex += 1;
      }
    }
  }
  for (const requirement of requirements.shadeStructures.filter((item) => item.type === "solid_canopy")) {
    const host = shadeHosts.get(requirement.id);
    if (!host) continue;
    const roof = solidCanopyForRequirement(requirement, requirements, scheme, host.floor, host.space.id, host.space.bounds);
    roofSystems.push(roof);
    const canopy = canopySupports(roof, host.floor, orderedFloors);
    secondaryRoofSupports.push(...canopy.supports);
    roofSupportReferences.push(canopy.reference);
  }
  for (const requirement of requirements.shadeStructures.filter((item) => item.type === "open_pergola")) {
    const host = shadeHosts.get(requirement.id);
    if (!host) continue;
    const roof = pergolaForRequirement(requirement, host.floor, host.space.id, host.space.bounds, host.space.type === "parking");
    roofSystems.push(roof);
    const pergola = pergolaSupports(roof, host.floor);
    secondaryRoofSupports.push(...pergola.supports);
    roofSupportReferences.push(pergola.reference);
  }
  return { roofSystems, secondaryRoofSupports, roofSupportReferences };
}

function distancePointToSegment(point: Point, segment: Segment2) {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const length2 = dx * dx + dy * dy;
  if (length2 === 0) return Math.hypot(point.x - segment.start.x, point.y - segment.start.y);
  const t = Math.max(0, Math.min(1, ((point.x - segment.start.x) * dx + (point.y - segment.start.y) * dy) / length2));
  return Math.hypot(point.x - (segment.start.x + t * dx), point.y - (segment.start.y + t * dy));
}

function sampleFootprint(polygon: OrthogonalPolygon, stepMm = 500) {
  const bounds = orthogonalPolygonBounds(polygon);
  const points = [...polygon.points];
  for (let x = bounds.x; x <= rectangleRight(bounds); x += stepMm) for (let y = bounds.y; y <= rectangleBottom(bounds); y += stepMm) points.push({ x, y });
  return points;
}

/** Concept-feasibility support audit shared with WS8; this is not structural certification. */
export function evaluateRoofSupportCompleteness(input: {
  roofSystems: RoofSystem[];
  roofSupportReferences: RoofSupportReference[];
  secondaryRoofSupports: SecondaryRoofSupport[];
  structuralConcept: StructuralConcept;
  walls: WallSegment[];
}): RoofSupportIssue[] {
  const issues: RoofSupportIssue[] = [];
  const walls = new Map(input.walls.map((wall) => [wall.id, wall]));
  const columns = new Map(input.structuralConcept.columns.map((column) => [column.id, column]));
  const supports = new Map(input.secondaryRoofSupports.map((support) => [support.id, support]));
  for (const roof of input.roofSystems) {
    const reference = input.roofSupportReferences.find((candidate) => candidate.roofSystemId === roof.id);
    const lines = reference?.bearingLines ?? [];
    for (const line of lines) {
      const backed = line.bearingWallIds.some((id) => {
        const wall = walls.get(id);
        return wall ? collinearOverlap(line.segment, wallSegment(wall)) : false;
      }) || line.structuralColumnIds.some((id) => {
        const column = columns.get(id);
        return column ? pointOnSegment(column.center, line.segment) : false;
      }) || line.secondarySupportIds.some((id) => {
        const support = supports.get(id);
        if (!support) return false;
        return support.role === "ledger" ? sameSegment(support.geometry, line.segment) : pointOnSegment(support.geometry, line.segment);
      });
      if (!backed) issues.push({ roofSystemId: roof.id, code: "UNBACKED_BEARING_LINE", measuredMm: 1, requiredMm: 0 });
    }
    if (roof.kind !== "open_pergola" && roof.kind !== "solid_canopy") {
      const maximumReach = Math.max(...sampleFootprint(roof.footprint).map((point) => Math.min(...lines.map((line) => distancePointToSegment(point, line.segment)))));
      if (!Number.isFinite(maximumReach) || maximumReach > ENCLOSURE_ROOF_MAX_SUPPORT_REACH_MM) issues.push({ roofSystemId: roof.id, code: "SUPPORT_REACH_EXCEEDED", measuredMm: maximumReach, requiredMm: ENCLOSURE_ROOF_MAX_SUPPORT_REACH_MM });
    } else {
      const maximum = roof.kind === "open_pergola" ? PERGOLA_MAX_POST_SPACING_MM : CANOPY_MAX_UNSUPPORTED_SPAN_MM;
      for (const line of lines) {
        const lineLength = segmentLength(line.segment);
        const referencedSupports = line.secondarySupportIds.map((id) => supports.get(id)).filter(Boolean) as SecondaryRoofSupport[];
        if (referencedSupports.some((support) => support.role === "ledger")) continue;
        const offsets = [
          0,
          lineLength,
          ...referencedSupports.flatMap((support) => support.role === "ledger" ? [] : [Math.hypot(
            support.geometry.x - line.segment.start.x,
            support.geometry.y - line.segment.start.y,
          )]),
        ].sort((left, right) => left - right);
        const maximumGap = offsets.slice(1).reduce((largest, offset, index) => Math.max(largest, offset - offsets[index]), 0);
        if (maximumGap > maximum) issues.push({ roofSystemId: roof.id, code: "MEMBER_SPAN_EXCEEDED", measuredMm: maximumGap, requiredMm: maximum });
      }
    }
  }
  return issues;
}
