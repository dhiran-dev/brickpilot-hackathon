import type { FloorRequirement, FormStrategy, RoomRequirement } from "@/lib/building/requirements";
import type { PartiId } from "@/lib/building/partis";
import type { Rectangle } from "@/lib/building/schema";
import { defaultRoomOccupancy } from "@/lib/building/space-semantics";

export type ReservedRegion = {
  id: string;
  bounds: Rectangle;
  sourceFloorId: string;
  kind: "court_void" | "stair_core" | "setback";
  buildability: "blocked" | "open_to_sky";
};

export type CandidateRoom = Pick<
  RoomRequirement,
  "id" | "name" | "type" | "floorId" | "minAreaMm2" | "targetAreaMm2" | "accessible"
> & {
  bounds: Rectangle;
  occupied: boolean;
  perimeterOpen?: boolean;
};

export type FloorCandidate = {
  floor: FloorRequirement;
  cells: CandidateRoom[];
  appliedReservedRegions?: ReservedRegion[];
  accessSpineSpaceIds?: string[];
};

export type CandidateGeneratorOptions = {
  envelope: Rectangle;
  rooms: RoomRequirement[];
  floor: FloorRequirement;
  seed: number;
  variant: number;
  /** Required by the production parti path; optional for isolated legacy-generator diagnostics. */
  partiId?: PartiId;
  stairCore?: CandidateRoom;
  formStrategy?: FormStrategy;
  reservedRegions?: ReservedRegion[];
  requiredConnections?: Array<[string, string]>;
  isTopFloor?: boolean;
  allowOpenSetback?: boolean;
  projectCourtVoid?: boolean;
  simplifiedCourt?: boolean;
  entranceSide?: "north" | "east" | "south" | "west";
  roadEdges?: Array<"north" | "east" | "south" | "west">;
};

export type CandidateGenerator = (options: CandidateGeneratorOptions) => FloorCandidate;

function overlapArea(left: Rectangle, right: Rectangle) {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const depth = Math.max(0, Math.min(left.y + left.depth, right.y + right.depth) - Math.max(left.y, right.y));
  return width * depth;
}

function sameBounds(left: Rectangle, right: Rectangle) {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.depth === right.depth;
}

/** Returns occupied cells that intrude into a projected non-room region. */
export function reservedRegionConflicts(cells: CandidateRoom[], regions: readonly ReservedRegion[]) {
  return regions.flatMap((region) => cells
    .filter((cell) => overlapArea(cell.bounds, region.bounds) > 0)
    .filter((cell) => {
      if (region.kind === "stair_core") return !(cell.type === "stair" && sameBounds(cell.bounds, region.bounds));
      if (region.kind === "court_void") return cell.occupied || cell.type !== "courtyard" || !sameBounds(cell.bounds, region.bounds);
      if (region.kind === "setback") return cell.occupied || !["terrace", "courtyard"].includes(cell.type) || !sameBounds(cell.bounds, region.bounds);
      return true;
    })
    .map((cell) => ({ regionId: region.id, cellId: cell.id })));
}

export function candidateRoom(room: RoomRequirement, bounds: Rectangle): CandidateRoom {
  return { ...room, bounds, occupied: defaultRoomOccupancy(room.type) };
}
