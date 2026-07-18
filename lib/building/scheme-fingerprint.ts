import type { CardinalDirection, RoomType } from "@/lib/building/requirements";
import type { OrthogonalPolygon, Point, Rectangle } from "@/lib/building/schema";

export const SCHEME_TOPOLOGY_FINGERPRINT_VERSION = "scheme-topology-v1" as const;
export const SCHEME_ADJACENCY_JACCARD_THRESHOLD = 0.9;
export const SCHEME_FOOTPRINT_IOU_THRESHOLD = 0.85;
export const SCHEME_FINGERPRINT_QUANTIZATION_MM = 100;

export type SchemeTopologyRoom = {
  id: string;
  floorId: string;
  roomType: RoomType;
  centroid: Point;
};

export type SchemeTopologyInput = {
  envelope: Rectangle;
  primaryRoadSide: CardinalDirection;
  rooms: SchemeTopologyRoom[];
  adjacencyEdges: Array<readonly [string, string]>;
  mainEntry: { side: CardinalDirection; targetRoomId: string };
  secondaryEntry?: { side: CardinalDirection; targetRoomId: string };
  voids: Array<{ floorId: string; centroid: Point }>;
  wings: { count: number; orientations: CardinalDirection[] };
  occupiedFootprintsByFloor: Array<{ floorId: string; polygons: OrthogonalPolygon[] }>;
};

export type SchemeTopologyFingerprint = {
  version: typeof SCHEME_TOPOLOGY_FINGERPRINT_VERSION;
  hash: string;
  adjacencyEdges: string[];
  entrySignature: string;
  courtyardSignature: string;
  wingSignature: string;
  occupiedFootprintsByFloor: Array<{ floorId: string; polygons: number[][][] }>;
};

function quantize(value: number) {
  return Math.round(value / SCHEME_FINGERPRINT_QUANTIZATION_MM) * SCHEME_FINGERPRINT_QUANTIZATION_MM;
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
    .join(",")}}`;
  return JSON.stringify(value);
}

function roadRelativePosition(point: Point, envelope: Rectangle, side: CardinalDirection) {
  switch (side) {
    case "north": return { inward: point.y - envelope.y, lateral: point.x - envelope.x };
    case "south": return { inward: envelope.y + envelope.depth - point.y, lateral: envelope.x + envelope.width - point.x };
    case "east": return { inward: envelope.x + envelope.width - point.x, lateral: point.y - envelope.y };
    case "west": return { inward: point.x - envelope.x, lateral: envelope.y + envelope.depth - point.y };
  }
}

function roomTokens(input: SchemeTopologyInput) {
  const tokenById = new Map<string, string>();
  const groups = new Map<string, SchemeTopologyRoom[]>();
  for (const room of input.rooms) {
    const key = `${room.floorId}:${room.roomType}`;
    groups.set(key, [...(groups.get(key) ?? []), room]);
  }
  for (const [key, rooms] of groups) {
    rooms.sort((left, right) => {
      const leftPosition = roadRelativePosition(left.centroid, input.envelope, input.primaryRoadSide);
      const rightPosition = roadRelativePosition(right.centroid, input.envelope, input.primaryRoadSide);
      return quantize(leftPosition.inward) - quantize(rightPosition.inward)
        || quantize(leftPosition.lateral) - quantize(rightPosition.lateral)
        || left.id.localeCompare(right.id);
    });
    rooms.forEach((room, index) => tokenById.set(room.id, `${key}:${index + 1}`));
  }
  return tokenById;
}

function centroidClass(point: Point, envelope: Rectangle) {
  const xRatio = (point.x - envelope.x) / envelope.width;
  const yRatio = (point.y - envelope.y) / envelope.depth;
  const horizontal = xRatio < 1 / 3 ? "west" : xRatio > 2 / 3 ? "east" : "center";
  const vertical = yRatio < 1 / 3 ? "north" : yRatio > 2 / 3 ? "south" : "center";
  return vertical === "center" && horizontal === "center" ? "center" : `${vertical}_${horizontal}`;
}

function normalizedPolygon(polygon: OrthogonalPolygon, envelope: Rectangle) {
  return polygon.points.map((point) => [quantize(point.x - envelope.x), quantize(point.y - envelope.y)]);
}

export function fingerprintSchemeTopology(input: SchemeTopologyInput): SchemeTopologyFingerprint {
  const tokens = roomTokens(input);
  const adjacencyEdges = input.adjacencyEdges.map(([leftId, rightId]) => {
    const left = tokens.get(leftId);
    const right = tokens.get(rightId);
    if (!left || !right) throw new Error(`SCHEME_FINGERPRINT_UNKNOWN_ROOM:${!left ? leftId : rightId}`);
    return [left, right].sort().join("<->");
  }).sort();
  const mainTarget = tokens.get(input.mainEntry.targetRoomId);
  if (!mainTarget) throw new Error(`SCHEME_FINGERPRINT_UNKNOWN_MAIN_ENTRY_TARGET:${input.mainEntry.targetRoomId}`);
  const secondaryTarget = input.secondaryEntry ? tokens.get(input.secondaryEntry.targetRoomId) : undefined;
  if (input.secondaryEntry && !secondaryTarget) throw new Error(`SCHEME_FINGERPRINT_UNKNOWN_SECONDARY_ENTRY_TARGET:${input.secondaryEntry.targetRoomId}`);
  const entrySignature = [
    `main:${input.mainEntry.side}:${mainTarget}`,
    input.secondaryEntry ? `secondary:${input.secondaryEntry.side}:${secondaryTarget}` : "secondary:none",
  ].join("|");
  const courtyardSignature = `${input.voids.length}:${input.voids
    .map((item) => `${item.floorId}:${centroidClass(item.centroid, input.envelope)}`)
    .sort()
    .join("|")}`;
  const wingSignature = `${input.wings.count}:${[...input.wings.orientations].sort().join("|")}`;
  const occupiedFootprintsByFloor = input.occupiedFootprintsByFloor
    .map((floor) => ({
      floorId: floor.floorId,
      polygons: floor.polygons.map((polygon) => normalizedPolygon(polygon, input.envelope)),
    }))
    .sort((left, right) => left.floorId.localeCompare(right.floorId));
  const payload = {
    version: SCHEME_TOPOLOGY_FINGERPRINT_VERSION,
    adjacencyEdges,
    entrySignature,
    courtyardSignature,
    wingSignature,
    occupiedFootprintsByFloor,
  };
  return { ...payload, hash: stableHash(stableJson(payload)) };
}

function pointInPolygon(point: Point, polygon: number[][]) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const [currentX, currentY] = polygon[current];
    const [previousX, previousY] = polygon[previous];
    const intersects = ((currentY > point.y) !== (previousY > point.y))
      && point.x < (previousX - currentX) * (point.y - currentY) / (previousY - currentY) + currentX;
    if (intersects) inside = !inside;
  }
  return inside;
}

function footprintIntersectionOverUnion(left: SchemeTopologyFingerprint, right: SchemeTopologyFingerprint) {
  const leftFloors = new Map(left.occupiedFootprintsByFloor.map((floor) => [floor.floorId, floor.polygons]));
  const rightFloors = new Map(right.occupiedFootprintsByFloor.map((floor) => [floor.floorId, floor.polygons]));
  const floorIds = new Set([...leftFloors.keys(), ...rightFloors.keys()]);
  let intersectionArea = 0;
  let unionArea = 0;
  for (const floorId of floorIds) {
    const leftPolygons = leftFloors.get(floorId) ?? [];
    const rightPolygons = rightFloors.get(floorId) ?? [];
    const allPolygons = [...leftPolygons, ...rightPolygons];
    const xs = [...new Set(allPolygons.flatMap((polygon) => polygon.map(([x]) => x)))].sort((a, b) => a - b);
    const ys = [...new Set(allPolygons.flatMap((polygon) => polygon.map(([, y]) => y)))].sort((a, b) => a - b);
    for (let xIndex = 0; xIndex < xs.length - 1; xIndex += 1) {
      for (let yIndex = 0; yIndex < ys.length - 1; yIndex += 1) {
        const width = xs[xIndex + 1] - xs[xIndex];
        const depth = ys[yIndex + 1] - ys[yIndex];
        if (width <= 0 || depth <= 0) continue;
        const sample = { x: xs[xIndex] + width / 2, y: ys[yIndex] + depth / 2 };
        const inLeft = leftPolygons.some((polygon) => pointInPolygon(sample, polygon));
        const inRight = rightPolygons.some((polygon) => pointInPolygon(sample, polygon));
        if (inLeft || inRight) unionArea += width * depth;
        if (inLeft && inRight) intersectionArea += width * depth;
      }
    }
  }
  return unionArea === 0 ? 1 : intersectionArea / unionArea;
}

function jaccard(left: readonly string[], right: readonly string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = [...leftSet].filter((value) => rightSet.has(value)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 1 : intersection / union;
}

export type SchemeTopologyComparison = {
  nearDuplicate: boolean;
  adjacencyJaccard: number;
  footprintIoU: number;
  signaturesMatch: boolean;
};

export function compareSchemeTopologyFingerprints(
  left: SchemeTopologyFingerprint,
  right: SchemeTopologyFingerprint,
): SchemeTopologyComparison {
  const adjacencyJaccard = jaccard(left.adjacencyEdges, right.adjacencyEdges);
  const footprintIoU = footprintIntersectionOverUnion(left, right);
  const signaturesMatch = left.entrySignature === right.entrySignature
    && left.courtyardSignature === right.courtyardSignature
    && left.wingSignature === right.wingSignature;
  return {
    adjacencyJaccard,
    footprintIoU,
    signaturesMatch,
    nearDuplicate: signaturesMatch
      && adjacencyJaccard >= SCHEME_ADJACENCY_JACCARD_THRESHOLD
      && footprintIoU >= SCHEME_FOOTPRINT_IOU_THRESHOLD,
  };
}

export function areSchemeTopologiesNearDuplicates(left: SchemeTopologyInput, right: SchemeTopologyInput) {
  return compareSchemeTopologyFingerprints(fingerprintSchemeTopology(left), fingerprintSchemeTopology(right));
}
