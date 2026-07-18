import type { RoomRequirement } from "@/lib/building/requirements";
import type { DerivedAllocatedSpace } from "@/lib/building/candidates/v3-allocation";

export type V3SpaceSemanticRole =
  | "interior_access_spine"
  | "protected_gallery"
  | "outdoor_verandah"
  | "parking"
  | "arrival_court"
  | "destination";

export type V3SpaceAccessSemantics = {
  role: V3SpaceSemanticRole;
  pedestrianDestination: boolean;
  mayRelayPedestrianAccess: boolean;
  vehicleArrival: boolean;
  openExterior: boolean;
};

const INTERIOR_SPINE_TYPES = new Set<RoomRequirement["type"]>(["foyer", "circulation", "living", "dining", "stair"]);

/** V3-only access semantics. Legacy verandah behavior remains frozen in space-semantics.ts. */
export function v3SpaceAccessSemantics(
  space: Pick<DerivedAllocatedSpace, "id" | "type">,
  options: { protectedGallerySpaceIds?: ReadonlySet<string> } = {},
): V3SpaceAccessSemantics {
  if (space.type === "parking") return { role: "parking", pedestrianDestination: false, mayRelayPedestrianAccess: false, vehicleArrival: true, openExterior: true };
  if (space.type === "verandah") return { role: "outdoor_verandah", pedestrianDestination: true, mayRelayPedestrianAccess: false, vehicleArrival: false, openExterior: true };
  if (space.type === "courtyard" || space.type === "terrace") return { role: "arrival_court", pedestrianDestination: true, mayRelayPedestrianAccess: false, vehicleArrival: false, openExterior: true };
  if (options.protectedGallerySpaceIds?.has(space.id) && space.type === "circulation") {
    return { role: "protected_gallery", pedestrianDestination: true, mayRelayPedestrianAccess: true, vehicleArrival: false, openExterior: false };
  }
  if (INTERIOR_SPINE_TYPES.has(space.type)) return { role: "interior_access_spine", pedestrianDestination: true, mayRelayPedestrianAccess: true, vehicleArrival: false, openExterior: false };
  return { role: "destination", pedestrianDestination: true, mayRelayPedestrianAccess: false, vehicleArrival: false, openExterior: false };
}

export function isV3PrivateDestination(type: RoomRequirement["type"]) {
  return type === "bedroom" || type === "bathroom" || type === "pooja";
}
