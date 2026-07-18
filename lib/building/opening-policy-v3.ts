import type { CurrentOpening, OpeningRole } from "@/lib/building/schema";
import type { RoomType } from "@/lib/building/requirements";
import {
  MAIN_ENTRY_MIN_CLEAR_WIDTH_MM,
  MAIN_ENTRY_TARGET_CLEAR_WIDTH_MM,
  VEHICLE_APERTURE_MIN_CLEAR_WIDTH_MM,
} from "@/lib/building/v3-constants";

export type V3OpeningPolicy = {
  role: OpeningRole;
  kind: CurrentOpening["kind"];
  usage: NonNullable<CurrentOpening["usage"]>;
  widthMm: number;
  heightMm: number;
  materialToken: string;
};

export type V3WindowPolicy = {
  targetWidthMm: number;
  minimumWidthMm: number;
  heightMm: number;
  sillHeightMm: number;
  materialToken: string;
};

/** Exterior-daylight openings are required only for enclosed occupiable/service rooms. */
export function v3WindowPolicy(roomType: RoomType): V3WindowPolicy | undefined {
  if (["parking", "balcony", "verandah", "courtyard", "terrace", "circulation", "stair"].includes(roomType)) return undefined;
  if (roomType === "living" || roomType === "dining") return { targetWidthMm: 1_800, minimumWidthMm: 1_200, heightMm: 1_500, sillHeightMm: 750, materialToken: "window.living.large" };
  if (roomType === "bedroom" || roomType === "study") return { targetWidthMm: 1_500, minimumWidthMm: 1_000, heightMm: 1_350, sillHeightMm: 900, materialToken: "window.private.standard" };
  if (roomType === "kitchen") return { targetWidthMm: 1_200, minimumWidthMm: 900, heightMm: 1_050, sillHeightMm: 1_050, materialToken: "window.kitchen.worktop" };
  if (roomType === "bathroom") return { targetWidthMm: 750, minimumWidthMm: 600, heightMm: 600, sillHeightMm: 1_500, materialToken: "window.service.privacy" };
  if (roomType === "utility" || roomType === "store") return { targetWidthMm: 900, minimumWidthMm: 600, heightMm: 900, sillHeightMm: 1_200, materialToken: "window.service.standard" };
  return { targetWidthMm: 1_000, minimumWidthMm: 700, heightMm: 1_050, sillHeightMm: 1_050, materialToken: "window.general.standard" };
}

export function v3OpeningPolicy(role: OpeningRole, accessible = false, requestedMainWidthMm = MAIN_ENTRY_TARGET_CLEAR_WIDTH_MM): V3OpeningPolicy {
  if (role === "main_entry") return {
    role,
    kind: "door",
    usage: "pedestrian",
    widthMm: Math.max(MAIN_ENTRY_MIN_CLEAR_WIDTH_MM, requestedMainWidthMm),
    heightMm: 2400,
    materialToken: "door.main-entry.warm-wood",
  };
  if (role === "vehicle_entry") return { role, kind: "open_connection", usage: "vehicle", widthMm: VEHICLE_APERTURE_MIN_CLEAR_WIDTH_MM, heightMm: 2400, materialToken: "aperture.vehicle.dark-metal" };
  if (role === "service_entry") return { role, kind: "door", usage: "pedestrian", widthMm: accessible ? 1000 : 900, heightMm: 2100, materialToken: "door.service.muted-metal" };
  if (role === "secondary_entry") return { role, kind: "door", usage: "pedestrian", widthMm: accessible ? 1000 : 900, heightMm: 2100, materialToken: "door.secondary.wood" };
  if (role === "open_passage") return { role, kind: "open_connection", usage: "pedestrian", widthMm: accessible ? 1000 : 900, heightMm: 2100, materialToken: "opening.interior.pass-through" };
  return { role, kind: "door", usage: "pedestrian", widthMm: accessible ? 1000 : 800, heightMm: 2100, materialToken: accessible ? "door.interior.accessible" : "door.interior.standard" };
}
