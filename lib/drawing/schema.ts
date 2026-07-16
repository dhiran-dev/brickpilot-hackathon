import type { CardinalDirection, RoomType } from "@/lib/building/requirements";
import type { Point, Rectangle } from "@/lib/building/schema";
import { CAD_RENDERER_VERSION } from "@/lib/renderer-version";

export const RENDERER_VERSION = CAD_RENDERER_VERSION;

export const DRAWING_LAYER_DEFINITIONS = [
  { id: "site", label: "Site + setbacks", shortLabel: "Site", core: true },
  { id: "zoning", label: "Room zoning", shortLabel: "Zones", core: true },
  { id: "circulation", label: "Circulation + access", shortLabel: "Routes", core: true },
  { id: "walls", label: "Walls + columns", shortLabel: "Walls", core: true },
  { id: "openings", label: "Doors + windows", shortLabel: "Openings", core: true },
  { id: "furniture", label: "Furniture + fixtures", shortLabel: "Furniture", core: true },
  { id: "labels", label: "Room labels + areas", shortLabel: "Labels", core: true },
  { id: "dimensions-overall", label: "Overall dimensions", shortLabel: "Overall dims", core: true },
  { id: "dimensions-internal", label: "Internal dimensions", shortLabel: "Internal dims", core: true },
  { id: "validation", label: "Validation findings", shortLabel: "Findings", core: true },
  { id: "annotation", label: "North, scale + title block", shortLabel: "Sheet data", core: true },
] as const;

export type DrawingLayerId = (typeof DRAWING_LAYER_DEFINITIONS)[number]["id"];
export type DrawingAppearance = "cad-dark" | "paper-light";
export type DrawingPreset = "presentation" | "architectural" | "validation" | "print";
export type LayerVisibility = Record<DrawingLayerId, boolean>;

export const DRAWING_PRESETS: Record<DrawingPreset, { label: string; appearance: DrawingAppearance; visible: DrawingLayerId[] }> = {
  presentation: {
    label: "Presentation",
    appearance: "cad-dark",
    visible: ["site", "zoning", "walls", "openings", "furniture", "labels", "annotation"],
  },
  architectural: {
    label: "Architectural",
    appearance: "cad-dark",
    visible: ["site", "walls", "openings", "furniture", "labels", "dimensions-overall", "annotation"],
  },
  validation: {
    label: "Validation",
    appearance: "cad-dark",
    visible: ["site", "zoning", "circulation", "walls", "openings", "labels", "validation", "annotation"],
  },
  print: {
    label: "Print",
    appearance: "paper-light",
    visible: ["site", "walls", "openings", "furniture", "labels", "dimensions-overall", "dimensions-internal", "validation", "annotation"],
  },
};

export function visibilityForPreset(preset: DrawingPreset): LayerVisibility {
  const enabled = new Set(DRAWING_PRESETS[preset].visible);
  return Object.fromEntries(DRAWING_LAYER_DEFINITIONS.map(({ id }) => [id, enabled.has(id)])) as LayerVisibility;
}

export type RoomZone = "social" | "private" | "kitchen" | "wet" | "circulation" | "outdoor" | "utility" | "work" | "sacred";

export type DrawingRoom = {
  id: string;
  name: string;
  type: RoomType;
  zone: RoomZone;
  bounds: Rectangle;
  polygon: Point[];
  areaMm2: number;
  accessible: boolean;
  label: {
    mode: "center" | "compact" | "schedule";
    x: number;
    y: number;
    fontSizeMm: number;
    scheduleRef?: string;
  };
};

export type DrawingWall = {
  id: string;
  start: Point;
  end: Point;
  thicknessMm: number;
  type: "exterior" | "interior" | "shaft";
};

export type DrawingOpening = {
  id: string;
  wallId: string;
  kind: "door" | "window" | "open_connection";
  start: Point;
  end: Point;
  hingePoint: Point;
  leafPoint: Point;
  swing: "clockwise" | "counterclockwise" | "none";
  widthMm: number;
  wallThicknessMm: number;
  isEntrance: boolean;
  interiorPoint?: Point;
};

export type FurnitureKind = "sofa" | "bed" | "table" | "counter" | "bath" | "desk" | "storage" | "car" | "stair" | "landscape" | "altar";

export type DrawingFurniture = {
  id: string;
  roomId: string;
  kind: FurnitureKind;
  bounds: Rectangle;
};

export type DrawingDimension = {
  id: string;
  orientation: "horizontal" | "vertical";
  start: Point;
  end: Point;
  offsetMm: number;
  label: string;
};

export type DrawingRoute = {
  id: string;
  roomId: string;
  points: Point[];
  accessible: boolean;
};

export type DrawingFinding = {
  id: string;
  severity: "error" | "warning" | "info";
  message: string;
  objectIds: string[];
  point: Point;
};

export type DrawingFindingInput = {
  ruleId: string;
  severity: "error" | "warning" | "info";
  message: string;
  floorId?: string;
  objectIds: string[];
};

export type DrawingRoadCorridor = {
  edge: CardinalDirection;
  bounds: Rectangle;
  labelPoint: Point;
  labelRotation: 0 | -90;
};

export type DrawingAnnotationLayout = {
  scaleOrigin: Point;
  legendOrigin: Point;
  titleY: number;
  titleHeight: number;
  scheduleOrigin: Point;
};

export type DrawingFloorArtifact = {
  id: string;
  rendererVersion: typeof RENDERER_VERSION;
  buildingId: string;
  floorId: string;
  floorLabel: string;
  floorLevel: number;
  facing: CardinalDirection;
  roadEdges: CardinalDirection[];
  roadCorridors: DrawingRoadCorridor[];
  annotationLayout: DrawingAnnotationLayout;
  viewBox: Rectangle;
  siteBounds: Rectangle;
  envelope: Rectangle;
  rooms: DrawingRoom[];
  walls: DrawingWall[];
  columns: Array<{ id: string; center: Point; widthMm: number; depthMm: number }>;
  openings: DrawingOpening[];
  furniture: DrawingFurniture[];
  dimensions: { overall: DrawingDimension[]; internal: DrawingDimension[] };
  routes: DrawingRoute[];
  findings: DrawingFinding[];
  schedule: { ref: string; roomId: string; name: string; areaMm2: number }[];
  scaleBarMm: number;
  metadata: {
    algorithmVersion: string;
    rulePackVersion: string;
    seed: number;
    candidate: string;
  };
};

export type BuildingDrawing = {
  rendererVersion: typeof RENDERER_VERSION;
  buildingId: string;
  floors: DrawingFloorArtifact[];
};
