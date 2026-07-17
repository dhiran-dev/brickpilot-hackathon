import type { DrawingFloorArtifact } from "@/lib/drawing/schema";

export type PdfWallPrimitive = { x1: number; y1: number; x2: number; y2: number; thicknessMm: number; stroke: string };
export type PdfRoomLabelPrimitive = { x: number; y: number; name: string; areaLabel: string };

export function floorPlanToPdfPrimitives(artifact: DrawingFloorArtifact) {
  const walls: PdfWallPrimitive[] = artifact.walls.map((wall) => ({
    x1: wall.start.x,
    y1: wall.start.y,
    x2: wall.end.x,
    y2: wall.end.y,
    thicknessMm: wall.thicknessMm,
    stroke: wall.type === "exterior" ? "#fff6ea" : "#cdbdab",
  }));
  const roomLabels: PdfRoomLabelPrimitive[] = artifact.rooms.map((room) => ({
    x: room.label.x,
    y: room.label.y,
    name: room.name.toUpperCase(),
    areaLabel: `${(room.areaMm2 / 1_000_000).toFixed(1)} SQM`,
  }));
  return { viewBox: artifact.viewBox, walls, roomLabels };
}
