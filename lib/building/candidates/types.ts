import type { FloorRequirement, FormStrategy, RoomRequirement } from "@/lib/building/requirements";
import type { Rectangle } from "@/lib/building/schema";

export type CandidateRoom = Pick<
  RoomRequirement,
  "id" | "name" | "type" | "floorId" | "minAreaMm2" | "targetAreaMm2" | "accessible"
> & {
  bounds: Rectangle;
  occupied: boolean;
};

export type FloorCandidate = {
  floor: FloorRequirement;
  cells: CandidateRoom[];
};

export type CandidateGeneratorOptions = {
  envelope: Rectangle;
  rooms: RoomRequirement[];
  floor: FloorRequirement;
  seed: number;
  variant: number;
  stairCore?: CandidateRoom;
  formStrategy?: FormStrategy;
};

export type CandidateGenerator = (options: CandidateGeneratorOptions) => FloorCandidate;

export function candidateRoom(room: RoomRequirement, bounds: Rectangle): CandidateRoom {
  return { ...room, bounds, occupied: !["balcony", "courtyard", "parking", "terrace"].includes(room.type) };
}
