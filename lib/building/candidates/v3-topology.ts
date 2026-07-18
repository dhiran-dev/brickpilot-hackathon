import type { CardinalDirection, CurrentBuildingRequirements, RoomRequirement } from "@/lib/building/requirements";
import type { OrthogonalPolygon, Point, Rectangle, Segment2 } from "@/lib/building/schema";
import {
  MAIN_ENTRY_MIN_WALL_RUN_MM,
  VEHICLE_APERTURE_MIN_CLEAR_WIDTH_MM,
} from "@/lib/building/v3-constants";
import type { V3PartiId } from "@/lib/building/partis";
import type { SchemeTopologyInput, SchemeTopologyRoom } from "@/lib/building/scheme-fingerprint";

export type TopologyReservation = {
  id: string;
  side: CardinalDirection;
  segment: Segment2;
  minimumClearWidthMm: number;
  targetRoomId: string;
};

export type V3TopologySkeleton = SchemeTopologyInput & {
  contractVersion: "topology-stage-v3";
  partiId: V3PartiId;
  variant: number;
  foyerWallRunReservation: TopologyReservation;
  vehicleApertureReservation?: TopologyReservation;
  relaxationFindings: Array<{
    code: "ENTRY_SIDE_MOVED_TO_FEASIBLE_ROAD" | "INFERRED_COURTYARD_REMOVED";
    requirementPath: string;
    requestedValue: unknown;
    resolvedValue: unknown;
  }>;
};

function rectangle(x: number, y: number, width: number, depth: number): OrthogonalPolygon {
  return { points: [{ x, y }, { x, y: y + depth }, { x: x + width, y: y + depth }, { x: x + width, y }] };
}

function opposite(side: CardinalDirection): CardinalDirection {
  return side === "north" ? "south" : side === "south" ? "north" : side === "east" ? "west" : "east";
}

function resolveEntrySide(requirements: CurrentBuildingRequirements) {
  const requested = requirements.entry.primarySide.value;
  const roadEdges = requirements.site.roadEdges;
  if (requested !== "auto_road_side" && roadEdges.includes(requested)) return { side: requested, moved: false };
  return { side: roadEdges[0], moved: requested !== "auto_road_side" && requested !== roadEdges[0] };
}

function edgeSegment(envelope: Rectangle, side: CardinalDirection, length: number, offsetRatio: number): Segment2 {
  const edgeLength = side === "north" || side === "south" ? envelope.width : envelope.depth;
  if (edgeLength < length) throw new Error(`TOPOLOGY_EDGE_RESERVATION_TOO_SHORT:${side}:${length}`);
  const offset = Math.round((edgeLength - length) * Math.max(0, Math.min(1, offsetRatio)));
  if (side === "north") return { start: { x: envelope.x + offset, y: envelope.y }, end: { x: envelope.x + offset + length, y: envelope.y } };
  if (side === "south") return { start: { x: envelope.x + offset + length, y: envelope.y + envelope.depth }, end: { x: envelope.x + offset, y: envelope.y + envelope.depth } };
  if (side === "west") return { start: { x: envelope.x, y: envelope.y + offset + length }, end: { x: envelope.x, y: envelope.y + offset } };
  return { start: { x: envelope.x + envelope.width, y: envelope.y + offset }, end: { x: envelope.x + envelope.width, y: envelope.y + offset + length } };
}

function compactFootprints(envelope: Rectangle, entrySide: CardinalDirection, variant: number) {
  const fraction = 0.64 + variant * 0.03;
  if (entrySide === "north") return [rectangle(envelope.x, envelope.y, envelope.width, Math.round(envelope.depth * fraction))];
  if (entrySide === "south") {
    const depth = Math.round(envelope.depth * fraction);
    return [rectangle(envelope.x, envelope.y + envelope.depth - depth, envelope.width, depth)];
  }
  if (entrySide === "west") return [rectangle(envelope.x, envelope.y, Math.round(envelope.width * fraction), envelope.depth)];
  const width = Math.round(envelope.width * fraction);
  return [rectangle(envelope.x + envelope.width - width, envelope.y, width, envelope.depth)];
}

function courtyardFootprints(envelope: Rectangle, variant: number) {
  const band = Math.round(Math.min(envelope.width, envelope.depth) * (0.2 + variant * 0.015));
  return [
    rectangle(envelope.x, envelope.y, envelope.width, band),
    rectangle(envelope.x, envelope.y + envelope.depth - band, envelope.width, band),
    rectangle(envelope.x, envelope.y + band, band, envelope.depth - 2 * band),
    rectangle(envelope.x + envelope.width - band, envelope.y + band, band, envelope.depth - 2 * band),
  ];
}

function lFootprint(envelope: Rectangle, entrySide: CardinalDirection, variant: number): OrthogonalPolygon[] {
  const cutWidth = Math.round(envelope.width * (0.42 - variant * 0.025));
  const cutDepth = Math.round(envelope.depth * (0.42 - variant * 0.025));
  const missingEast = entrySide === "south" || entrySide === "west" ? variant % 2 === 0 : variant % 2 !== 0;
  const missingNorth = entrySide === "south" || entrySide === "east";
  const left = envelope.x;
  const right = envelope.x + envelope.width;
  const top = envelope.y;
  const bottom = envelope.y + envelope.depth;
  const cutLeft = missingEast ? right - cutWidth : left + cutWidth;
  const cutTop = missingNorth ? top + cutDepth : bottom - cutDepth;
  if (missingNorth && missingEast) return [{ points: [
    { x: left, y: top }, { x: left, y: bottom }, { x: right, y: bottom }, { x: right, y: cutTop }, { x: cutLeft, y: cutTop }, { x: cutLeft, y: top },
  ] }];
  if (missingNorth && !missingEast) return [{ points: [
    { x: cutLeft, y: top }, { x: cutLeft, y: cutTop }, { x: left, y: cutTop }, { x: left, y: bottom }, { x: right, y: bottom }, { x: right, y: top },
  ] }];
  if (!missingNorth && missingEast) return [{ points: [
    { x: left, y: top }, { x: left, y: bottom }, { x: cutLeft, y: bottom }, { x: cutLeft, y: cutTop }, { x: right, y: cutTop }, { x: right, y: top },
  ] }];
  return [{ points: [
    { x: left, y: top }, { x: left, y: cutTop }, { x: cutLeft, y: cutTop }, { x: cutLeft, y: bottom }, { x: right, y: bottom }, { x: right, y: top },
  ] }];
}

function tFootprints(envelope: Rectangle, entrySide: CardinalDirection, variant: number) {
  const crossDepth = Math.round((entrySide === "north" || entrySide === "south" ? envelope.depth : envelope.width) * (0.28 + variant * 0.015));
  const stemWidth = Math.round((entrySide === "north" || entrySide === "south" ? envelope.width : envelope.depth) * (0.34 + variant * 0.02));
  if (entrySide === "south") return [
    rectangle(envelope.x, envelope.y + envelope.depth - crossDepth, envelope.width, crossDepth),
    rectangle(envelope.x + Math.round((envelope.width - stemWidth) / 2), envelope.y, stemWidth, envelope.depth - crossDepth),
  ];
  if (entrySide === "north") return [
    rectangle(envelope.x, envelope.y, envelope.width, crossDepth),
    rectangle(envelope.x + Math.round((envelope.width - stemWidth) / 2), envelope.y + crossDepth, stemWidth, envelope.depth - crossDepth),
  ];
  if (entrySide === "east") return [
    rectangle(envelope.x + envelope.width - crossDepth, envelope.y, crossDepth, envelope.depth),
    rectangle(envelope.x, envelope.y + Math.round((envelope.depth - stemWidth) / 2), envelope.width - crossDepth, stemWidth),
  ];
  return [
    rectangle(envelope.x, envelope.y, crossDepth, envelope.depth),
    rectangle(envelope.x + crossDepth, envelope.y + Math.round((envelope.depth - stemWidth) / 2), envelope.width - crossDepth, stemWidth),
  ];
}

function rotateFromSouth(point: { x: number; y: number }, entrySide: CardinalDirection) {
  if (entrySide === "south") return point;
  if (entrySide === "north") return { x: 1 - point.x, y: 1 - point.y };
  if (entrySide === "east") return { x: point.y, y: 1 - point.x };
  return { x: 1 - point.y, y: point.x };
}

const TEMPLATE_ROOM_POSITIONS: Readonly<Record<V3PartiId, ReadonlyArray<{ x: number; y: number }>>> = {
  compact_bar: [{ x: 0.18, y: 0.78 }, { x: 0.5, y: 0.78 }, { x: 0.82, y: 0.78 }, { x: 0.18, y: 0.45 }, { x: 0.5, y: 0.45 }, { x: 0.82, y: 0.45 }, { x: 0.35, y: 0.2 }, { x: 0.68, y: 0.2 }],
  courtyard_ring: [{ x: 0.2, y: 0.85 }, { x: 0.5, y: 0.85 }, { x: 0.8, y: 0.85 }, { x: 0.85, y: 0.5 }, { x: 0.8, y: 0.15 }, { x: 0.5, y: 0.15 }, { x: 0.2, y: 0.15 }, { x: 0.15, y: 0.5 }],
  articulated_l: [{ x: 0.18, y: 0.82 }, { x: 0.5, y: 0.82 }, { x: 0.82, y: 0.82 }, { x: 0.18, y: 0.55 }, { x: 0.18, y: 0.28 }, { x: 0.45, y: 0.28 }, { x: 0.7, y: 0.28 }],
  t_hub: [{ x: 0.2, y: 0.82 }, { x: 0.5, y: 0.82 }, { x: 0.8, y: 0.82 }, { x: 0.5, y: 0.58 }, { x: 0.5, y: 0.36 }, { x: 0.5, y: 0.16 }],
};

function roomCentroids(
  requirements: CurrentBuildingRequirements,
  partiId: V3PartiId,
  entrySide: CardinalDirection,
  envelope: Rectangle,
): SchemeTopologyRoom[] {
  return requirements.floors.flatMap((floor) => {
    const rooms = requirements.rooms.filter((room) => room.floorId === floor.id).sort((left, right) =>
      Number(right.type === "foyer") - Number(left.type === "foyer")
      || Number(right.type === "parking") - Number(left.type === "parking")
      || left.type.localeCompare(right.type)
      || left.id.localeCompare(right.id),
    );
    return rooms.map((room, index) => {
      const base = TEMPLATE_ROOM_POSITIONS[partiId][index % TEMPLATE_ROOM_POSITIONS[partiId].length];
      const rotated = rotateFromSouth(base, entrySide);
      return {
        id: room.id,
        floorId: room.floorId,
        roomType: room.type,
        centroid: {
          x: Math.round(envelope.x + rotated.x * envelope.width),
          y: Math.round(envelope.y + rotated.y * envelope.depth),
        },
      };
    });
  });
}

function topologyAdjacency(rooms: SchemeTopologyRoom[], requirements: CurrentBuildingRequirements, partiId: V3PartiId) {
  const known = new Set(rooms.map((room) => room.id));
  const edges = requirements.relationships
    .filter((relationship) => relationship.type === "must_connect")
    .filter((relationship) => known.has(relationship.fromRoomId) && known.has(relationship.toRoomId))
    .map((relationship) => [relationship.fromRoomId, relationship.toRoomId] as const);
  for (const floor of requirements.floors) {
    const ordered = rooms.filter((room) => room.floorId === floor.id);
    const step = partiId === "courtyard_ring" ? 1 : partiId === "t_hub" ? 2 : partiId === "articulated_l" ? 3 : 1;
    for (let index = 0; index + step < ordered.length; index += 1) edges.push([ordered[index].id, ordered[index + step].id]);
  }
  return [...new Map(edges.map((edge) => [[...edge].sort().join("|"), edge])).values()];
}

function templateFootprints(partiId: V3PartiId, envelope: Rectangle, entrySide: CardinalDirection, variant: number) {
  if (partiId === "compact_bar") return compactFootprints(envelope, entrySide, variant);
  if (partiId === "courtyard_ring") return courtyardFootprints(envelope, variant);
  if (partiId === "articulated_l") return lFootprint(envelope, entrySide, variant);
  return tFootprints(envelope, entrySide, variant);
}

function templateVoid(partiId: V3PartiId, envelope: Rectangle, variant: number): Point {
  if (partiId === "courtyard_ring") return { x: envelope.x + Math.round(envelope.width * (0.5 + (variant - 1) * 0.025)), y: envelope.y + Math.round(envelope.depth * 0.5) };
  if (partiId === "articulated_l") return { x: envelope.x + Math.round(envelope.width * 0.73), y: envelope.y + Math.round(envelope.depth * 0.27) };
  if (partiId === "t_hub") return { x: envelope.x + Math.round(envelope.width * 0.72), y: envelope.y + Math.round(envelope.depth * 0.48) };
  return { x: envelope.x + Math.round(envelope.width * 0.5), y: envelope.y + Math.round(envelope.depth * 0.35) };
}

function wingSignature(partiId: V3PartiId, entrySide: CardinalDirection) {
  if (partiId === "compact_bar") return { count: 1, orientations: [entrySide === "north" || entrySide === "south" ? "east" as const : "north" as const] };
  if (partiId === "courtyard_ring") return { count: 4, orientations: ["north", "east", "south", "west"] as CardinalDirection[] };
  if (partiId === "articulated_l") return { count: 2, orientations: [entrySide, entrySide === "north" || entrySide === "south" ? "west" : "south"] as CardinalDirection[] };
  return { count: 3, orientations: [entrySide, entrySide === "north" || entrySide === "south" ? "east" : "north", entrySide === "north" || entrySide === "south" ? "west" : "south"] as CardinalDirection[] };
}

function secondaryEntry(requirements: CurrentBuildingRequirements, mainSide: CardinalDirection, rooms: SchemeTopologyRoom[]) {
  if (requirements.entry.secondaryEntry.value === "none" || requirements.entry.secondaryEntry.value === "auto") return undefined;
  const service = rooms.find((room) => room.roomType === "utility") ?? rooms.find((room) => room.roomType === "kitchen");
  if (!service) return undefined;
  const side = requirements.entry.secondaryEntry.value === "rear"
    ? opposite(mainSide)
    : requirements.site.roadEdges.find((road) => road !== mainSide) ?? opposite(mainSide);
  return { side, targetRoomId: service.id };
}

export function createV3TopologySkeleton(input: {
  requirements: CurrentBuildingRequirements;
  envelope: Rectangle;
  partiId: V3PartiId;
  variant: number;
}): V3TopologySkeleton {
  const { requirements, envelope, partiId, variant } = input;
  const resolvedEntry = resolveEntrySide(requirements);
  const rooms = roomCentroids(requirements, partiId, resolvedEntry.side, envelope);
  const foyer = rooms.find((room) => room.roomType === "foyer");
  if (!foyer) throw new Error("TOPOLOGY_FOYER_REQUIRED");
  const parking = rooms.find((room) => room.roomType === "parking");
  const footprints = templateFootprints(partiId, envelope, resolvedEntry.side, variant);
  const inferredCourtyardRemoved = requirements.courtyard.source === "inferred"
    && requirements.architecture.formStrategy !== "courtyard";
  const needsVoid = partiId === "courtyard_ring"
    || (!inferredCourtyardRemoved && requirements.courtyard.value !== "none" && requirements.courtyard.value !== "auto");
  const voidCentroid = needsVoid ? templateVoid(partiId, envelope, variant) : undefined;
  const entryOffset = variant % 2 === 0 ? 0.18 : 0.62;
  const vehicleOffset = entryOffset < 0.5 ? 0.68 : 0.06;
  return {
    contractVersion: "topology-stage-v3",
    partiId,
    variant,
    envelope,
    primaryRoadSide: resolvedEntry.side,
    rooms,
    adjacencyEdges: topologyAdjacency(rooms, requirements, partiId),
    mainEntry: { side: resolvedEntry.side, targetRoomId: foyer.id },
    secondaryEntry: secondaryEntry(requirements, resolvedEntry.side, rooms),
    voids: voidCentroid ? requirements.floors.map((floor) => ({ floorId: floor.id, centroid: voidCentroid })) : [],
    wings: wingSignature(partiId, resolvedEntry.side),
    occupiedFootprintsByFloor: requirements.floors.map((floor) => ({ floorId: floor.id, polygons: footprints })),
    foyerWallRunReservation: {
      id: "main-entry-wall-run",
      side: resolvedEntry.side,
      segment: edgeSegment(envelope, resolvedEntry.side, MAIN_ENTRY_MIN_WALL_RUN_MM, entryOffset),
      minimumClearWidthMm: MAIN_ENTRY_MIN_WALL_RUN_MM,
      targetRoomId: foyer.id,
    },
    vehicleApertureReservation: requirements.parking.vehicleCount > 0 && parking ? {
      id: "parking-vehicle-aperture",
      side: resolvedEntry.side,
      segment: edgeSegment(envelope, resolvedEntry.side, VEHICLE_APERTURE_MIN_CLEAR_WIDTH_MM, vehicleOffset),
      minimumClearWidthMm: VEHICLE_APERTURE_MIN_CLEAR_WIDTH_MM,
      targetRoomId: parking.id,
    } : undefined,
    relaxationFindings: [
      ...(resolvedEntry.moved ? [{
        code: "ENTRY_SIDE_MOVED_TO_FEASIBLE_ROAD" as const,
        requirementPath: "entry.primarySide",
        requestedValue: requirements.entry.primarySide.value,
        resolvedValue: resolvedEntry.side,
      }] : []),
      ...(inferredCourtyardRemoved ? [{
        code: "INFERRED_COURTYARD_REMOVED" as const,
        requirementPath: "courtyard",
        requestedValue: requirements.courtyard.value,
        resolvedValue: "none",
      }] : []),
    ],
  };
}
