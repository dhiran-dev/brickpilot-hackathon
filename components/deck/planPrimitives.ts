import type { DrawingFloorArtifact, DrawingOpening, RoomZone } from "@/lib/drawing/schema";
import type { Point, Rectangle } from "@/lib/building/schema";

/**
 * Neutral, renderer-agnostic primitives for one floor plan. Both the on-screen
 * `DeckPlan` SVG and the react-pdf `DeckDocument` consume this exact output, so
 * the downloaded sheet shows precisely what the slide shows — the parity rule
 * for the deck module lives here.
 */

export const PLAN_COLORS = {
  panel: "#0b0a09",
  ink: "#fff6ea",
  secondary: "#c9b9a7",
  construction: "#8e5a31",
  accent: "#ff7a2f",
  info: "#64b5d6",
  zone: {
    social: "#c98b38",
    private: "#4a78b8",
    kitchen: "#bc6335",
    wet: "#2f8b8b",
    circulation: "#74716c",
    outdoor: "#4e885d",
    utility: "#667787",
    work: "#5862a7",
    sacred: "#865a9f",
  } satisfies Record<RoomZone, string>,
};

export type PlanLine = { x1: number; y1: number; x2: number; y2: number };
export type PlanRect = { x: number; y: number; width: number; depth: number };

export type PlanPrimitives = {
  view: Rectangle;
  site: PlanRect;
  envelope: PlanRect;
  roads: Array<{ bounds: PlanRect; label: string; vertical: boolean; labelX: number; labelY: number }>;
  roomFills: Array<{ points: string; fill: string; openEdge: boolean }>;
  intentionalUnbuilt: Array<{ points: string }>;
  roofLines: Array<PlanLine & { dashed: boolean }>;
  supportPoints: Point[];
  supportLines: PlanLine[];
  guardLines: PlanLine[];
  walls: Array<PlanLine & { thicknessMm: number; stroke: string }>;
  columns: PlanRect[];
  openings: Array<{
    kind: DrawingOpening["kind"];
    erase: PlanLine & { width: number };
    lines: Array<PlanLine & { stroke: string; dashed?: boolean }>;
    arcPoints: Point[];
    entrance: { shaft: PlanLine; head: Point[]; labelX: number; labelY: number } | null;
  }>;
  furniture: Array<{ kind: string; rect: PlanRect; inner: PlanLine[] }>;
  roomLabels: Array<{ x: number; y: number; name: string; fontSize: number }>;
  areaLabels: Array<{ x: number; y: number; label: string; fontSize: number }>;
  dimensions: Array<{ line: PlanLine; extensions: PlanLine[]; labelX: number; labelY: number; label: string; anchor: "middle" | "end" }>;
  compass: { x: number; y: number };
  scaleBar: { x: number; y: number; widthMm: number; label: string };
};

function polygonPoints(points: Point[]) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function openingPrimitives(opening: DrawingOpening): PlanPrimitives["openings"][number] {
  const horizontal = opening.start.y === opening.end.y;
  const erase: PlanLine & { width: number } = {
    x1: opening.start.x,
    y1: opening.start.y,
    x2: opening.end.x,
    y2: opening.end.y,
    width: opening.wallThicknessMm + 70,
  };
  const lines: Array<PlanLine & { stroke: string; dashed?: boolean }> = [];
  let arcPoints: Point[] = [];
  let entrance: PlanPrimitives["openings"][number]["entrance"] = null;

  const midX = (opening.start.x + opening.end.x) / 2;
  const midY = (opening.start.y + opening.end.y) / 2;

  if (opening.isEntrance) {
    const interior = opening.interiorPoint ?? opening.leafPoint;
    const vector = { x: interior.x - midX, y: interior.y - midY };
    const length = Math.hypot(vector.x, vector.y) || 1;
    const outside = { x: midX - (vector.x / length) * 820, y: midY - (vector.y / length) * 820 };
    const direction = { x: (midX - outside.x) / 820, y: (midY - outside.y) / 820 };
    const normal = { x: -direction.y, y: direction.x };
    const base = { x: midX - direction.x * 240, y: midY - direction.y * 240 };
    entrance = {
      shaft: { x1: outside.x, y1: outside.y, x2: midX - direction.x * 120, y2: midY - direction.y * 120 },
      head: [
        { x: midX, y: midY },
        { x: base.x + normal.x * 130, y: base.y + normal.y * 130 },
        { x: base.x - normal.x * 130, y: base.y - normal.y * 130 },
      ],
      labelX: outside.x + normal.x * 0,
      labelY: horizontal ? outside.y + 320 : outside.y,
    };
  }

  if (opening.kind === "window") {
    const dx = horizontal ? 0 : 95;
    const dy = horizontal ? 95 : 0;
    lines.push(
      { x1: opening.start.x - dx, y1: opening.start.y - dy, x2: opening.end.x - dx, y2: opening.end.y - dy, stroke: PLAN_COLORS.info },
      { x1: opening.start.x + dx, y1: opening.start.y + dy, x2: opening.end.x + dx, y2: opening.end.y + dy, stroke: PLAN_COLORS.info },
    );
  } else if (opening.kind === "open_connection") {
    const tickX = horizontal ? 0 : opening.wallThicknessMm * 0.72;
    const tickY = horizontal ? opening.wallThicknessMm * 0.72 : 0;
    lines.push(
      { x1: opening.start.x, y1: opening.start.y, x2: opening.end.x, y2: opening.end.y, stroke: PLAN_COLORS.construction, dashed: true },
      { x1: opening.start.x - tickX, y1: opening.start.y - tickY, x2: opening.start.x + tickX, y2: opening.start.y + tickY, stroke: PLAN_COLORS.secondary },
      { x1: opening.end.x - tickX, y1: opening.end.y - tickY, x2: opening.end.x + tickX, y2: opening.end.y + tickY, stroke: PLAN_COLORS.secondary },
    );
  } else {
    // Door: leaf line plus the swing arc, sampled into points so every
    // renderer (DOM SVG and react-pdf alike) draws it identically.
    lines.push({ x1: opening.hingePoint.x, y1: opening.hingePoint.y, x2: opening.leafPoint.x, y2: opening.leafPoint.y, stroke: PLAN_COLORS.ink });
    const closedPoint = opening.hingePoint.x === opening.start.x && opening.hingePoint.y === opening.start.y ? opening.end : opening.start;
    const startAngle = Math.atan2(closedPoint.y - opening.hingePoint.y, closedPoint.x - opening.hingePoint.x);
    let endAngle = Math.atan2(opening.leafPoint.y - opening.hingePoint.y, opening.leafPoint.x - opening.hingePoint.x);
    const sweepClockwise = opening.swing !== "counterclockwise";
    if (sweepClockwise && endAngle < startAngle) endAngle += Math.PI * 2;
    if (!sweepClockwise && endAngle > startAngle) endAngle -= Math.PI * 2;
    const segments = 9;
    arcPoints = Array.from({ length: segments + 1 }, (_, index) => {
      const angle = startAngle + ((endAngle - startAngle) * index) / segments;
      return { x: opening.hingePoint.x + Math.cos(angle) * opening.widthMm, y: opening.hingePoint.y + Math.sin(angle) * opening.widthMm };
    });
  }

  return { kind: opening.kind, erase, lines, arcPoints, entrance };
}

function furniturePrimitives(item: DrawingFloorArtifact["furniture"][number]): PlanPrimitives["furniture"][number] {
  const { x, y, width, depth } = item.bounds;
  const inner: PlanLine[] = [];
  if (item.kind === "stair") {
    for (let index = 1; index < 7; index += 1) {
      inner.push({ x1: x, y1: y + (depth / 7) * index, x2: x + width, y2: y + (depth / 7) * index });
    }
  } else if (item.kind === "bed") {
    inner.push({ x1: x, y1: y + depth * 0.25, x2: x + width, y2: y + depth * 0.25 });
  } else if (item.kind === "sofa") {
    inner.push({ x1: x, y1: y + depth * 0.25, x2: x + width, y2: y + depth * 0.25 });
  } else if (item.kind === "storage") {
    inner.push({ x1: x, y1: y + depth / 2, x2: x + width, y2: y + depth / 2 });
  }
  return { kind: item.kind, rect: { x, y, width, depth }, inner };
}

export function planPrimitives(artifact: DrawingFloorArtifact): PlanPrimitives {
  const roads = artifact.roadCorridors.map((road) => ({
    bounds: { x: road.bounds.x, y: road.bounds.y, width: road.bounds.width, depth: road.bounds.depth },
    label: `ROAD · ${road.edge.toUpperCase()}`,
    vertical: road.labelRotation === -90,
    labelX: road.labelPoint.x,
    labelY: road.labelPoint.y,
  }));

  const roomFills = artifact.rooms.map((room) => ({
    points: polygonPoints(room.polygon),
    fill: PLAN_COLORS.zone[room.zone],
    openEdge: room.edgeTreatment === "open",
  }));
  const intentionalUnbuilt = (artifact.intentionalUnbuiltRegions ?? []).map((region) => ({ points: polygonPoints(region.polygon) }));
  const roofLines = (artifact.roofOverlay ?? []).flatMap((roof) => [
    ...roof.footprint.map((start, index) => {
      const end = roof.footprint[(index + 1) % roof.footprint.length];
      return { x1: start.x, y1: start.y, x2: end.x, y2: end.y, dashed: roof.kind === "open_pergola" };
    }),
    ...roof.ridges.map((ridge) => ({ x1: ridge.start.x, y1: ridge.start.y, x2: ridge.end.x, y2: ridge.end.y, dashed: true })),
  ]);
  const supportPoints = (artifact.supports ?? []).flatMap((support) => "start" in support.geometry ? [] : [support.geometry]);
  const supportLines = (artifact.supports ?? []).flatMap((support) => "start" in support.geometry ? [{ x1: support.geometry.start.x, y1: support.geometry.start.y, x2: support.geometry.end.x, y2: support.geometry.end.y }] : []);
  const guardLines = (artifact.guards ?? []).map((guard) => ({ x1: guard.edge.start.x, y1: guard.edge.start.y, x2: guard.edge.end.x, y2: guard.edge.end.y }));

  const walls = artifact.walls.map((wall) => ({
    x1: wall.start.x,
    y1: wall.start.y,
    x2: wall.end.x,
    y2: wall.end.y,
    thicknessMm: Math.max(wall.thicknessMm, 80),
    stroke: wall.type === "exterior" ? PLAN_COLORS.ink : PLAN_COLORS.secondary,
  }));

  const columns = artifact.columns.map((column) => ({
    x: column.center.x - column.widthMm / 2,
    y: column.center.y - column.depthMm / 2,
    width: column.widthMm,
    depth: column.depthMm,
  }));

  const roomLabels = artifact.rooms.map((room) => ({
    x: room.label.x,
    y: room.label.y,
    name: room.label.mode === "schedule" && room.label.scheduleRef ? room.label.scheduleRef : room.name.toUpperCase(),
    fontSize: room.label.fontSizeMm * (room.label.mode === "schedule" ? 1.15 : 1),
  }));

  const areaLabels = artifact.rooms
    .filter((room) => room.label.mode !== "schedule")
    .map((room) => ({
      x: room.label.x,
      y: room.label.y + room.label.fontSizeMm * 0.95,
      label: `${(room.areaMm2 / 1_000_000).toFixed(1)} M²`,
      fontSize: room.label.fontSizeMm * 0.72,
    }));

  const dimensions = artifact.dimensions.overall.map((dimension) => {
    const horizontal = dimension.orientation === "horizontal";
    const offsetX = horizontal ? 0 : dimension.offsetMm;
    const offsetY = horizontal ? dimension.offsetMm : 0;
    const x1 = dimension.start.x + offsetX;
    const y1 = dimension.start.y + offsetY;
    const x2 = dimension.end.x + offsetX;
    const y2 = dimension.end.y + offsetY;
    return {
      line: { x1, y1, x2, y2 },
      extensions: [
        { x1: dimension.start.x, y1: dimension.start.y, x2: x1, y2: y1 },
        { x1: dimension.end.x, y1: dimension.end.y, x2, y2 },
      ],
      labelX: horizontal ? (x1 + x2) / 2 : x1 - 260,
      labelY: horizontal ? y1 - 160 : (y1 + y2) / 2,
      label: dimension.label,
      anchor: horizontal ? ("middle" as const) : ("end" as const),
    };
  });

  const compass = { x: artifact.siteBounds.x + artifact.siteBounds.width - 900, y: artifact.siteBounds.y + 1250 };

  const geometryBottom = Math.max(
    artifact.siteBounds.y + artifact.siteBounds.depth,
    ...roads.map((road) => road.bounds.y + road.bounds.depth),
  );
  const scaleBar = {
    x: artifact.siteBounds.x,
    y: geometryBottom + 700,
    widthMm: artifact.scaleBarMm,
    label: `${artifact.scaleBarMm / 1000} m`,
  };

  // Crop to the geometry that matters — not the whole drawing sheet.
  const margin = 700;
  const xs: number[] = [];
  const ys: number[] = [];
  const include = (rect: PlanRect) => {
    xs.push(rect.x, rect.x + rect.width);
    ys.push(rect.y, rect.y + rect.depth);
  };
  include({ x: artifact.siteBounds.x, y: artifact.siteBounds.y, width: artifact.siteBounds.width, depth: artifact.siteBounds.depth });
  include({ x: artifact.envelope.x, y: artifact.envelope.y, width: artifact.envelope.width, depth: artifact.envelope.depth });
  for (const road of roads) include(road.bounds);
  for (const dimension of dimensions) {
    xs.push(dimension.line.x1, dimension.line.x2, dimension.labelX);
    ys.push(dimension.line.y1, dimension.line.y2, dimension.labelY);
  }
  xs.push(compass.x + 600);
  ys.push(compass.y - 700, scaleBar.y + 500);
  const minX = Math.min(...xs) - margin;
  const minY = Math.min(...ys) - margin;
  const view = { x: minX, y: minY, width: Math.max(...xs) + margin - minX, depth: Math.max(...ys) + margin - minY };

  return {
    view,
    site: { x: artifact.siteBounds.x, y: artifact.siteBounds.y, width: artifact.siteBounds.width, depth: artifact.siteBounds.depth },
    envelope: { x: artifact.envelope.x, y: artifact.envelope.y, width: artifact.envelope.width, depth: artifact.envelope.depth },
    roads,
    roomFills,
    intentionalUnbuilt,
    roofLines,
    supportPoints,
    supportLines,
    guardLines,
    walls,
    columns,
    openings: artifact.openings.map(openingPrimitives),
    furniture: artifact.furniture.map(furniturePrimitives),
    roomLabels,
    areaLabels,
    dimensions,
    compass,
    scaleBar,
  };
}
