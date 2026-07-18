import { orthogonalPolygonSchema, type FloorRegion, type OrthogonalPolygon, type Point, type Rectangle } from "@/lib/building/schema";
import { AREA_TOLERANCE_MM2 } from "@/lib/building/v3-constants";

export function rectangleToOrthogonalPolygon(rectangle: Rectangle): OrthogonalPolygon {
  return { points: [
    { x: rectangle.x, y: rectangle.y },
    { x: rectangle.x, y: rectangle.y + rectangle.depth },
    { x: rectangle.x + rectangle.width, y: rectangle.y + rectangle.depth },
    { x: rectangle.x + rectangle.width, y: rectangle.y },
  ] };
}

function signedDoubleArea(points: Point[]) {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
}

export function orthogonalPolygonAreaMm2(polygon: OrthogonalPolygon) {
  return Math.abs(signedDoubleArea(polygon.points)) / 2;
}

export function orthogonalPolygonBounds(polygon: OrthogonalPolygon): Rectangle {
  const xs = polygon.points.map((point) => point.x);
  const ys = polygon.points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, depth: Math.max(...ys) - y };
}

export function normalizeOrthogonalPolygon(input: OrthogonalPolygon): OrthogonalPolygon {
  let points = input.points.map((point) => {
    if (!Number.isInteger(point.x) || !Number.isInteger(point.y)) throw new Error("ORTHOGONAL_POLYGON_NON_INTEGER_COORDINATE");
    return { ...point };
  });
  if (points.length > 1 && points[0].x === points.at(-1)?.x && points[0].y === points.at(-1)?.y) points = points.slice(0, -1);
  points = points.filter((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    return !((previous.x === point.x && point.x === next.x) || (previous.y === point.y && point.y === next.y));
  });
  if (signedDoubleArea(points) > 0) points.reverse();
  const firstIndex = points.reduce((best, point, index) => {
    const candidate = points[best];
    return point.x < candidate.x || (point.x === candidate.x && point.y < candidate.y) ? index : best;
  }, 0);
  points = [...points.slice(firstIndex), ...points.slice(0, firstIndex)];
  return orthogonalPolygonSchema.parse({ points });
}

function pointInPolygon(point: Point, polygon: OrthogonalPolygon) {
  let inside = false;
  for (let current = 0, previous = polygon.points.length - 1; current < polygon.points.length; previous = current, current += 1) {
    const a = polygon.points[current];
    const b = polygon.points[previous];
    if (((a.y > point.y) !== (b.y > point.y)) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export type PartitionCoverageAudit = {
  envelopeAreaMm2: number;
  coveredAreaMm2: number;
  gapAreaMm2: number;
  overlapAreaMm2: number;
  outsideAreaMm2: number;
  valid: boolean;
};

export function auditOrthogonalPartition(envelope: OrthogonalPolygon, regions: readonly Pick<FloorRegion, "polygon">[]): PartitionCoverageAudit {
  const polygons = [envelope, ...regions.map((region) => region.polygon)];
  const xs = [...new Set(polygons.flatMap((polygon) => polygon.points.map((point) => point.x)))].sort((a, b) => a - b);
  const ys = [...new Set(polygons.flatMap((polygon) => polygon.points.map((point) => point.y)))].sort((a, b) => a - b);
  let coveredAreaMm2 = 0;
  let gapAreaMm2 = 0;
  let overlapAreaMm2 = 0;
  let outsideAreaMm2 = 0;
  for (let xIndex = 0; xIndex < xs.length - 1; xIndex += 1) for (let yIndex = 0; yIndex < ys.length - 1; yIndex += 1) {
    const width = xs[xIndex + 1] - xs[xIndex];
    const depth = ys[yIndex + 1] - ys[yIndex];
    if (width <= 0 || depth <= 0) continue;
    const area = width * depth;
    const sample = { x: xs[xIndex] + width / 2, y: ys[yIndex] + depth / 2 };
    const inEnvelope = pointInPolygon(sample, envelope);
    const count = regions.filter((region) => pointInPolygon(sample, region.polygon)).length;
    if (inEnvelope) {
      if (count === 0) gapAreaMm2 += area;
      else {
        coveredAreaMm2 += area;
        if (count > 1) overlapAreaMm2 += area * (count - 1);
      }
    } else if (count > 0) outsideAreaMm2 += area;
  }
  const envelopeAreaMm2 = orthogonalPolygonAreaMm2(envelope);
  return {
    envelopeAreaMm2,
    coveredAreaMm2,
    gapAreaMm2,
    overlapAreaMm2,
    outsideAreaMm2,
    valid: gapAreaMm2 <= AREA_TOLERANCE_MM2 && overlapAreaMm2 <= AREA_TOLERANCE_MM2 && outsideAreaMm2 <= AREA_TOLERANCE_MM2,
  };
}

export function residualRectangles(envelope: Rectangle, occupied: readonly Rectangle[]) {
  const xs = [...new Set([envelope.x, envelope.x + envelope.width, ...occupied.flatMap((item) => [item.x, item.x + item.width])])].sort((a, b) => a - b);
  const ys = [...new Set([envelope.y, envelope.y + envelope.depth, ...occupied.flatMap((item) => [item.y, item.y + item.depth])])].sort((a, b) => a - b);
  const residual: Rectangle[] = [];
  for (let yIndex = 0; yIndex < ys.length - 1; yIndex += 1) for (let xIndex = 0; xIndex < xs.length - 1; xIndex += 1) {
    const cell = { x: xs[xIndex], y: ys[yIndex], width: xs[xIndex + 1] - xs[xIndex], depth: ys[yIndex + 1] - ys[yIndex] };
    const sample = { x: cell.x + cell.width / 2, y: cell.y + cell.depth / 2 };
    if (!occupied.some((item) => sample.x > item.x && sample.x < item.x + item.width && sample.y > item.y && sample.y < item.y + item.depth)) residual.push(cell);
  }
  return residual;
}
