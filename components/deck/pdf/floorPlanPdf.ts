import type { DrawingFloorArtifact, RoomZone } from "@/lib/drawing/schema";

export type PdfWallPrimitive = { x1: number; y1: number; x2: number; y2: number; thicknessMm: number; stroke: string };
export type PdfRoomFillPrimitive = { points: string; fill: string; opacity: number };
export type PdfRoomLabelPrimitive = { x: number; y: number; name: string; fontSize: number };
export type PdfAreaLabelPrimitive = { x: number; y: number; label: string; fontSize: number };
export type PdfDimensionPrimitive = { x: number; y: number; label: string };
export type PdfFurniturePrimitive = { x: number; y: number; width: number; depth: number; stroke: string; kind: string };
export type PdfOpeningPrimitive = { x1: number; y1: number; x2: number; y2: number; stroke: string };
export type PdfSitePrimitive = { x: number; y: number; width: number; depth: number };

const ZONE_FILL: Record<RoomZone, string> = {
  social: "#fff6ea",
  private: "#b5a697",
  kitchen: "#c97940",
  wet: "#c97940",
  circulation: "#8e5a31",
  outdoor: "#38765a",
  utility: "#8e5a31",
  work: "#b5a697",
  sacred: "#c97940",
};

function polygonPoints(points: { x: number; y: number }[]) {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

export function floorPlanToPdfPrimitives(artifact: DrawingFloorArtifact) {
  const walls: PdfWallPrimitive[] = artifact.walls.map((wall) => ({
    x1: wall.start.x,
    y1: wall.start.y,
    x2: wall.end.x,
    y2: wall.end.y,
    thicknessMm: Math.max(wall.thicknessMm, 80),
    stroke: wall.type === "exterior" ? "#fff6ea" : "#cdbdab",
  }));
  const roomFills: PdfRoomFillPrimitive[] = artifact.rooms.map((room) => ({
    points: polygonPoints(room.polygon),
    fill: ZONE_FILL[room.zone],
    opacity: 0.12,
  }));
  const roomLabels: PdfRoomLabelPrimitive[] = artifact.rooms.map((room) => ({
    x: room.label.x,
    y: room.label.y,
    name: room.name.toUpperCase(),
    fontSize: room.label.fontSizeMm,
  }));
  const areaLabels: PdfAreaLabelPrimitive[] = artifact.rooms.map((room) => ({
    x: room.label.x,
    y: room.label.y + room.label.fontSizeMm * 1.2,
    label: `${(room.areaMm2 / 1_000_000).toFixed(1)} SQM`,
    fontSize: room.label.fontSizeMm,
  }));
  const dimensions: PdfDimensionPrimitive[] = artifact.dimensions.overall.map((dimension) => ({
    x: (dimension.start.x + dimension.end.x) / 2,
    y: (dimension.start.y + dimension.end.y) / 2,
    label: dimension.label,
  }));
  const furniture: PdfFurniturePrimitive[] = artifact.furniture.map((item) => ({
    x: item.bounds.x,
    y: item.bounds.y,
    width: item.bounds.width,
    depth: item.bounds.depth,
    stroke: "#8e5a31",
    kind: item.kind,
  }));
  const openings: PdfOpeningPrimitive[] = artifact.openings.map((opening) => ({
    x1: opening.start.x,
    y1: opening.start.y,
    x2: opening.end.x,
    y2: opening.end.y,
    stroke: opening.kind === "window" ? "#64b5d6" : "#ff7a2f",
  }));
  const site: PdfSitePrimitive = {
    x: artifact.siteBounds.x,
    y: artifact.siteBounds.y,
    width: artifact.siteBounds.width,
    depth: artifact.siteBounds.depth,
  };
  return { viewBox: artifact.viewBox, walls, roomFills, roomLabels, areaLabels, dimensions, furniture, openings, site };
}
