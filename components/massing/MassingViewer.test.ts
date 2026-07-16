import { describe, expect, test } from "bun:test";
import * as THREE from "three";

import { MASSING_CAPTURE_LABELS, MASSING_CAPTURE_SIZE, massingViewVector } from "@/components/massing/MassingViewer";

const roadVectors = {
  north: new THREE.Vector3(0, 0, -1),
  south: new THREE.Vector3(0, 0, 1),
  east: new THREE.Vector3(1, 0, 0),
  west: new THREE.Vector3(-1, 0, 0),
} as const;

describe("fixed render source cameras", () => {
  test("uses a fixed landscape 3:2 capture contract with burned-in labels", () => {
    expect(MASSING_CAPTURE_SIZE.width / MASSING_CAPTURE_SIZE.height).toBe(1.5);
    expect(MASSING_CAPTURE_LABELS.front).toContain("FRONT / ROAD");
    expect(MASSING_CAPTURE_LABELS.collage).toContain("FOUR LOCKED VIEWS");
    expect(MASSING_CAPTURE_LABELS.top).toContain("HIGH 3/4");
  });

  test("keeps front and top cameras road-relative for every facing", () => {
    for (const facing of ["north", "south", "east", "west"] as const) {
      const front = massingViewVector("front", facing);
      const top = massingViewVector("top", facing);
      expect(new THREE.Vector3(front.x, 0, front.z).normalize().dot(roadVectors[facing])).toBeGreaterThan(0.85);
      expect(new THREE.Vector3(top.x, 0, top.z).normalize().dot(roadVectors[facing])).toBeGreaterThan(0.75);
      expect(top.y).toBeGreaterThan(front.y);
    }
  });
});
