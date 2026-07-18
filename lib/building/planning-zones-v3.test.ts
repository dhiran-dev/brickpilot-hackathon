import { describe, expect, test } from "bun:test";

import type { ResolvedRoomAreaPolicy } from "@/lib/building/area-policy-v3";
import {
  attachedBathroomBedroomPairs,
  createPlanningConstraints,
  createPlanningRoomClusters,
  isInteriorRelayRoomType,
  planningZoneClass,
} from "@/lib/building/planning-zones-v3";
import {
  roomTypeSchema,
  type CurrentBuildingRequirements,
  type RoomRequirement,
  type RoomType,
} from "@/lib/building/requirements";

const EXPECTED_ZONE: Readonly<Record<RoomType, ReturnType<typeof planningZoneClass>>> = {
  foyer: "interior_relay",
  circulation: "interior_relay",
  living: "interior_relay",
  dining: "interior_relay",
  stair: "interior_relay",
  bedroom: "interior_destination",
  bathroom: "interior_destination",
  kitchen: "interior_destination",
  utility: "interior_destination",
  study: "interior_destination",
  pooja: "interior_destination",
  store: "interior_destination",
  parking: "covered_outdoor",
  balcony: "covered_outdoor",
  verandah: "covered_outdoor",
  courtyard: "open_to_sky",
  terrace: "open_to_sky",
};

function room(id: string, type: RoomType): RoomRequirement {
  return {
    id,
    name: id,
    type,
    floorId: "F0",
    minAreaMm2: 4_000_000,
    targetAreaMm2: 6_000_000,
    privacy: type === "bedroom" || type === "bathroom" ? "private" : "semi_private",
    preferredZone: "any",
    mustBeExterior: false,
    accessible: false,
  };
}

function policy(value: RoomRequirement): ResolvedRoomAreaPolicy {
  return {
    requirementId: value.id,
    roomType: value.type,
    flexibilityClass: value.type === "bathroom" ? "fixed_service" : "normal",
    minimumAreaMm2: value.minAreaMm2,
    effectiveTargetAreaMm2: value.targetAreaMm2,
    warningMaximumAreaMm2: 8_000_000,
    hardMaximumAreaMm2: 10_000_000,
  };
}

describe("planning zone v3 contracts", () => {
  test("maps every current RoomType exactly once", () => {
    expect(Object.keys(EXPECTED_ZONE).sort()).toEqual([...roomTypeSchema.options].sort());
    for (const type of roomTypeSchema.options) expect(planningZoneClass(type)).toBe(EXPECTED_ZONE[type]);
  });

  test("never treats private, service, covered-outdoor or open-to-sky rooms as relays", () => {
    const prohibited: RoomType[] = [
      "bedroom",
      "bathroom",
      "kitchen",
      "utility",
      "study",
      "pooja",
      "store",
      "parking",
      "balcony",
      "verandah",
      "courtyard",
      "terrace",
    ];
    expect(prohibited.filter(isInteriorRelayRoomType)).toEqual([]);
    expect(roomTypeSchema.options.filter(isInteriorRelayRoomType).sort()).toEqual(
      ["circulation", "dining", "foyer", "living", "stair"],
    );
  });

  test("clusters explicit attached bathrooms with their bedrooms deterministically", () => {
    const rooms = [
      room("bedroom-2", "bedroom"),
      room("bathroom-2b", "bathroom"),
      room("living", "living"),
      room("bathroom-2a", "bathroom"),
      room("bathroom-common", "bathroom"),
    ];
    const relationships: CurrentBuildingRequirements["relationships"] = [
      { type: "must_connect", fromRoomId: "bathroom-2b", toRoomId: "bedroom-2" },
      { type: "prefer_near", fromRoomId: "bathroom-common", toRoomId: "living" },
      { type: "must_connect", fromRoomId: "bedroom-2", toRoomId: "bathroom-2a" },
    ];
    expect([...attachedBathroomBedroomPairs({ rooms, relationships })]).toEqual([
      ["bathroom-2a", "bedroom-2"],
      ["bathroom-2b", "bedroom-2"],
    ]);
    const clusters = createPlanningRoomClusters({
      floorId: "F0",
      rooms,
      policies: rooms.map(policy),
      relationships,
    });
    expect(clusters.find((cluster) => cluster.primaryRoomId === "bedroom-2")).toMatchObject({
      id: "cluster-suite-bedroom-2",
      kind: "attached_suite",
      zoneClass: "interior_destination",
      memberIds: ["bedroom-2", "bathroom-2a", "bathroom-2b"],
      attachedBathroomIds: ["bathroom-2a", "bathroom-2b"],
    });
    expect(clusters.find((cluster) => cluster.primaryRoomId === "bathroom-common")?.kind).toBe("single");
    expect(clusters.find((cluster) => cluster.primaryRoomId === "living")?.kind).toBe("relay");
  });

  test("emits hard area, zone, privacy and coverage constraints plus soft targets", () => {
    const bedroom = room("bedroom", "bedroom");
    const bathroom = room("bathroom", "bathroom");
    const constraints = createPlanningConstraints({
      floorId: "F0",
      rooms: [bedroom, bathroom],
      policies: [policy(bedroom), policy(bathroom)],
      relationships: [{ type: "must_connect", fromRoomId: bathroom.id, toRoomId: bedroom.id }],
    });
    expect(constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "area-min:bedroom", hardness: "hard", required: 4_000_000 }),
      expect.objectContaining({ id: "area-target:bedroom", hardness: "soft", required: 6_000_000 }),
      expect.objectContaining({ id: "zone:bathroom:interior_destination", hardness: "hard" }),
      expect.objectContaining({ id: "privacy:bathroom:bedroom", kind: "privacy", hardness: "hard" }),
      expect.objectContaining({ id: "coverage:F0", kind: "coverage", hardness: "hard" }),
    ]));
  });
});
