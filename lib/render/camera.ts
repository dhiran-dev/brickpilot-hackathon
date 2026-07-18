import type { CardinalDirection } from "@/lib/building/requirements";
import type { CurrentBuilding, CurrentFloor, CurrentOpening, FacadeZone, WallSegment } from "@/lib/building/schema";
import { orthogonalPolygonBounds } from "@/lib/building/orthogonal-partition";

export const SEMANTIC_CAMERA_VERSION = "semantic-camera-v3.0.0" as const;
export const SEMANTIC_RENDER_VIEWS = ["primary_road_elevation", "secondary_context", "aerial"] as const;
export type SemanticRenderView = (typeof SEMANTIC_RENDER_VIEWS)[number];

export type SemanticRenderCamera = {
  cameraVersion: typeof SEMANTIC_CAMERA_VERSION;
  view: SemanticRenderView;
  facadeSide: CardinalDirection;
  facadeRole: FacadeZone["role"];
  targetWallIds: string[];
  targetOpeningId?: string;
  positionMm: { x: number; y: number; z: number };
  targetMm: { x: number; y: number; z: number };
  mainEntryMustBeVisible: boolean;
  geometryHash: string;
};

function openingMidpoint(floor: CurrentFloor, wall: WallSegment, opening: CurrentOpening) {
  const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
  if (length <= 0) throw new Error(`SEMANTIC_CAMERA_ZERO_LENGTH_WALL:${wall.id}`);
  const along = opening.offsetMm + opening.widthMm / 2;
  return {
    x: Math.round(wall.start.x + (wall.end.x - wall.start.x) * along / length),
    y: Math.round(wall.start.y + (wall.end.y - wall.start.y) * along / length),
    z: floor.elevationMm + Math.round(opening.heightMm * 0.55),
  };
}

function offsetFromSide(target: { x: number; y: number; z: number }, side: CardinalDirection, distanceMm: number, elevationMm: number) {
  if (side === "north") return { x: target.x, y: target.y - distanceMm, z: elevationMm };
  if (side === "south") return { x: target.x, y: target.y + distanceMm, z: elevationMm };
  if (side === "east") return { x: target.x + distanceMm, y: target.y, z: elevationMm };
  return { x: target.x - distanceMm, y: target.y, z: elevationMm };
}

function primaryFacade(building: CurrentBuilding) {
  const facade = building.facadeZones.find((zone) => zone.role === "primary_road_elevation" && zone.containsMainEntry);
  if (!facade) throw new Error("SEMANTIC_CAMERA_PRIMARY_FACADE_MISSING");
  const mainEntry = building.floors.flatMap((floor) => floor.openings).find((opening) => opening.role === "main_entry");
  if (!mainEntry || !facade.exteriorWallIds.includes(mainEntry.wallId)) throw new Error("SEMANTIC_CAMERA_MAIN_ENTRY_FACADE_CONFLICT");
  const floor = building.floors.find((candidate) => candidate.id === mainEntry.floorId);
  const wall = floor?.walls.find((candidate) => candidate.id === mainEntry.wallId);
  if (!floor || !wall) throw new Error("SEMANTIC_CAMERA_MAIN_ENTRY_GEOMETRY_MISSING");
  return { facade, mainEntry, floor, wall };
}

function buildingPlanCentre(building: CurrentBuilding) {
  const bounds = orthogonalPolygonBounds(building.floors[0].envelope);
  return {
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.depth / 2),
    z: Math.round(Math.max(...building.floors.map((floor) => floor.elevationMm + floor.floorHeightMm)) * 0.45),
  };
}

/** Semantic cameras are derived from canonical facade/opening geometry, never from site.facing prose. */
export function buildSemanticRenderCameras(building: CurrentBuilding): Record<SemanticRenderView, SemanticRenderCamera> {
  const primary = primaryFacade(building);
  const target = openingMidpoint(primary.floor, primary.wall, primary.mainEntry);
  const planCentre = buildingPlanCentre(building);
  const span = Math.max(building.site.widthMm, building.site.depthMm);
  const secondary = building.facadeZones.find((zone) => zone.role === "secondary_road_elevation")
    ?? building.facadeZones.find((zone) => zone.role !== "primary_road_elevation")
    ?? primary.facade;
  return {
    primary_road_elevation: {
      cameraVersion: SEMANTIC_CAMERA_VERSION,
      view: "primary_road_elevation",
      facadeSide: primary.facade.side,
      facadeRole: primary.facade.role,
      targetWallIds: [...primary.facade.exteriorWallIds],
      targetOpeningId: primary.mainEntry.id,
      positionMm: offsetFromSide(target, primary.facade.side, Math.round(span * 0.85), Math.max(2_400, target.z + 900)),
      targetMm: target,
      mainEntryMustBeVisible: true,
      geometryHash: building.candidate.geometryHash,
    },
    secondary_context: {
      cameraVersion: SEMANTIC_CAMERA_VERSION,
      view: "secondary_context",
      facadeSide: secondary.side,
      facadeRole: secondary.role,
      targetWallIds: [...secondary.exteriorWallIds],
      positionMm: offsetFromSide(planCentre, secondary.side, Math.round(span * 0.95), Math.max(3_000, planCentre.z + 1_200)),
      targetMm: planCentre,
      mainEntryMustBeVisible: secondary.containsMainEntry,
      geometryHash: building.candidate.geometryHash,
    },
    aerial: {
      cameraVersion: SEMANTIC_CAMERA_VERSION,
      view: "aerial",
      facadeSide: primary.facade.side,
      facadeRole: primary.facade.role,
      targetWallIds: [...primary.facade.exteriorWallIds],
      targetOpeningId: primary.mainEntry.id,
      positionMm: offsetFromSide(planCentre, primary.facade.side, Math.round(span * 0.7), Math.round(span * 0.9)),
      targetMm: planCentre,
      mainEntryMustBeVisible: true,
      geometryHash: building.candidate.geometryHash,
    },
  };
}
