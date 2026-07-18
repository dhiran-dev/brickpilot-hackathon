import { describe, expect, test } from "bun:test";

import {
  compareSchemeTopologyFingerprints,
  fingerprintSchemeTopology,
  type SchemeTopologyInput,
} from "@/lib/building/scheme-fingerprint";

function rectangle(x: number, y: number, width: number, depth: number) {
  return { points: [{ x, y }, { x, y: y + depth }, { x: x + width, y: y + depth }, { x: x + width, y }] };
}

function topology(offsetX = 0, offsetY = 0): SchemeTopologyInput {
  const rooms = [
    { id: "foyer", floorId: "F0", roomType: "foyer" as const, centroid: { x: offsetX + 5000, y: offsetY + 9000 } },
    { id: "living", floorId: "F0", roomType: "living" as const, centroid: { x: offsetX + 5000, y: offsetY + 6500 } },
    { id: "bed-a", floorId: "F0", roomType: "bedroom" as const, centroid: { x: offsetX + 2500, y: offsetY + 3000 } },
    { id: "bed-b", floorId: "F0", roomType: "bedroom" as const, centroid: { x: offsetX + 7500, y: offsetY + 3000 } },
  ];
  return {
    envelope: { x: offsetX, y: offsetY, width: 10000, depth: 10000 },
    primaryRoadSide: "south",
    rooms,
    adjacencyEdges: [["foyer", "living"], ["living", "bed-a"], ["living", "bed-b"]],
    mainEntry: { side: "south", targetRoomId: "foyer" },
    voids: [],
    wings: { count: 1, orientations: ["east"] },
    occupiedFootprintsByFloor: [{ floorId: "F0", polygons: [rectangle(offsetX, offsetY, 10000, 10000)] }],
  };
}

describe("scheme-topology-v1", () => {
  test("normalizes translation and room IDs but preserves road-relative orientation", () => {
    const original = topology();
    const translated = topology(3470, 9280);
    const renamed = {
      ...original,
      rooms: original.rooms.map((room) => ({ ...room, id: `renamed-${room.id}` })),
      adjacencyEdges: original.adjacencyEdges.map(([left, right]) => [`renamed-${left}`, `renamed-${right}`] as const),
      mainEntry: { ...original.mainEntry, targetRoomId: "renamed-foyer" },
    };
    expect(fingerprintSchemeTopology(translated).hash).toBe(fingerprintSchemeTopology(original).hash);
    expect(fingerprintSchemeTopology(renamed).hash).toBe(fingerprintSchemeTopology(original).hash);

    const changedRoadSide = { ...original, primaryRoadSide: "east" as const, mainEntry: { side: "east" as const, targetRoomId: "foyer" } };
    expect(fingerprintSchemeTopology(changedRoadSide).hash).not.toBe(fingerprintSchemeTopology(original).hash);
  });

  test("requires matching signatures, adjacency Jaccard >= 0.90, and footprint IoU >= 0.85", () => {
    const base = fingerprintSchemeTopology(topology());
    const close = fingerprintSchemeTopology({
      ...topology(),
      occupiedFootprintsByFloor: [{ floorId: "F0", polygons: [rectangle(0, 0, 9500, 10000)] }],
    });
    expect(compareSchemeTopologyFingerprints(base, close)).toMatchObject({ nearDuplicate: true, signaturesMatch: true });
    expect(compareSchemeTopologyFingerprints(base, close).footprintIoU).toBeGreaterThanOrEqual(0.85);

    const small = fingerprintSchemeTopology({
      ...topology(),
      occupiedFootprintsByFloor: [{ floorId: "F0", polygons: [rectangle(0, 0, 7000, 10000)] }],
    });
    expect(compareSchemeTopologyFingerprints(base, small).nearDuplicate).toBe(false);

    const differentWings = fingerprintSchemeTopology({ ...topology(), wings: { count: 2, orientations: ["north", "east"] } });
    expect(compareSchemeTopologyFingerprints(base, differentWings)).toMatchObject({ nearDuplicate: false, signaturesMatch: false });
  });

  test("quantizes coordinates to 100 mm without normalizing scale", () => {
    const base = fingerprintSchemeTopology(topology());
    const subGridNoise = topology();
    subGridNoise.rooms = subGridNoise.rooms.map((room) => ({ ...room, centroid: { x: room.centroid.x + 30, y: room.centroid.y + 30 } }));
    subGridNoise.occupiedFootprintsByFloor = [{ floorId: "F0", polygons: [rectangle(30, 30, 10000, 10000)] }];
    expect(fingerprintSchemeTopology(subGridNoise).hash).toBe(base.hash);

    const scaled = topology();
    scaled.envelope = { ...scaled.envelope, width: 12000, depth: 12000 };
    scaled.occupiedFootprintsByFloor = [{ floorId: "F0", polygons: [rectangle(0, 0, 12000, 12000)] }];
    expect(fingerprintSchemeTopology(scaled).hash).not.toBe(base.hash);
  });
});
