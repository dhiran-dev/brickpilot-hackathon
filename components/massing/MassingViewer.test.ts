import { describe, expect, test } from "bun:test";
import * as THREE from "three";

import {
  cancelMassingViewAnimation,
  configureMassingCanvas,
  MASSING_CAPTURE_LABELS,
  MASSING_CAPTURE_LAYER_STATE,
  MASSING_CAPTURE_SIZE,
  MASSING_EDGE_DEPTH_STYLE,
  MASSING_VIEWER_CLASS_NAME,
  massingCanvasSizeChanged,
  massingEdgeStyle,
  massingSurfaceStyle,
  massingVisibilityOptions,
  massingViewVector,
  retargetMassingCamera,
} from "@/components/massing/MassingViewer";
import { entranceRoadSide } from "@/lib/building/topology";

const roadVectors = {
  north: new THREE.Vector3(0, 0, -1),
  south: new THREE.Vector3(0, 0, 1),
  east: new THREE.Vector3(1, 0, 0),
  west: new THREE.Vector3(-1, 0, 0),
} as const;

describe("fixed render source cameras", () => {
  test("takes the WebGL canvas out of layout flow to prevent resize feedback", () => {
    const canvas = { style: {} } as unknown as HTMLCanvasElement;
    configureMassingCanvas(canvas);
    expect(canvas.style.position).toBe("absolute");
    expect(canvas.style.inset).toBe("0");
    expect(canvas.style.display).toBe("block");
    expect(canvas.style.width).toBe("100%");
    expect(canvas.style.height).toBe("100%");
    expect(MASSING_VIEWER_CLASS_NAME.split(" ")).toContain("relative");
    expect(MASSING_VIEWER_CLASS_NAME.split(" ")).toContain("overflow-hidden");
  });

  test("skips duplicate ResizeObserver measurements", () => {
    expect(massingCanvasSizeChanged(887, 729, 887, 729)).toBe(false);
    expect(massingCanvasSizeChanged(888, 729, 887, 729)).toBe(true);
    expect(massingCanvasSizeChanged(887, 730, 887, 729)).toBe(true);
  });

  test("preserves the user's orbit when the rebuilt model changes target", () => {
    const position = new THREE.Vector3(9, 7, -4);
    const previousTarget = new THREE.Vector3(1, 2, 3);
    const nextTarget = new THREE.Vector3(-2, 5, 8);
    const retargeted = retargetMassingCamera(position, previousTarget, nextTarget);

    expect(retargeted.clone().sub(nextTarget).toArray()).toEqual(position.clone().sub(previousTarget).toArray());
    expect(retargeted.distanceTo(nextTarget)).toBeCloseTo(position.distanceTo(previousTarget), 8);
  });

  test("cancels stale preset animation frames before a rebuild or capture", () => {
    const cancelled: number[] = [];
    expect(cancelMassingViewAnimation(42, (frame) => cancelled.push(frame))).toBeNull();
    expect(cancelled).toEqual([42]);
    expect(cancelMassingViewAnimation(null, (frame) => cancelled.push(frame))).toBeNull();
    expect(cancelled).toEqual([42]);
  });

  test("maps the column toggle independently from walls, slabs and roof", () => {
    expect(massingVisibilityOptions({
      showInteriorWalls: true,
      showColumns: false,
      showSlabs: true,
      showRoof: true,
      showSite: true,
    })).toEqual({
      includeInteriorWalls: true,
      includeColumns: false,
      includeSlabs: true,
      includeRoof: true,
      includeSite: true,
    });
    expect(massingVisibilityOptions({
      showInteriorWalls: false,
      showColumns: true,
      showSlabs: false,
      showRoof: false,
      showSite: false,
    })).toEqual({
      includeInteriorWalls: false,
      includeColumns: true,
      includeSlabs: false,
      includeRoof: false,
      includeSite: false,
    });
  });

  test("assigns stable depth layers to coplanar massing surfaces and outlines", () => {
    const kinds = ["site", "slab", "roof", "exterior_wall", "interior_wall", "column", "stair"] as const;
    const slab = massingSurfaceStyle("slab");
    const exteriorWall = massingSurfaceStyle("exterior_wall");
    const interiorWall = massingSurfaceStyle("interior_wall");
    const column = massingSurfaceStyle("column");

    for (const kind of kinds) {
      const style = massingSurfaceStyle(kind);
      expect(style.transparent).toBe(false);
      expect(style.opacity).toBe(1);
      expect(style.polygonOffset).toBe(true);
      expect(style.polygonOffsetFactor).toBeGreaterThan(0);
    }
    expect(slab.polygonOffset).toBe(true);
    expect(column.polygonOffsetUnits).toBeLessThan(slab.polygonOffsetUnits);
    expect(column.polygonOffsetUnits).toBeLessThan(exteriorWall.polygonOffsetUnits);
    expect(slab.polygonOffsetUnits).toBeLessThan(exteriorWall.polygonOffsetUnits);
    expect(exteriorWall.polygonOffsetUnits).toBeLessThan(interiorWall.polygonOffsetUnits);
    expect(MASSING_EDGE_DEPTH_STYLE.depthTest).toBe(true);
    expect(MASSING_EDGE_DEPTH_STYLE.depthWrite).toBe(false);
    expect(massingEdgeStyle("column").renderOrder).toBeGreaterThan(massingEdgeStyle("slab").renderOrder);
    expect(massingEdgeStyle("slab").renderOrder).toBeGreaterThan(massingEdgeStyle("exterior_wall").renderOrder);
    expect(massingEdgeStyle("exterior_wall").renderOrder).toBeGreaterThan(massingEdgeStyle("interior_wall").renderOrder);
    expect(massingEdgeStyle("interior_wall").renderOrder).toBeGreaterThan(column.renderOrder);
  });

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

  test("front camera follows entrance road side when facing has no road", () => {
    const side = entranceRoadSide({ facing: "north", roadEdges: ["south"] });
    expect(side).toBe("south");
    const front = massingViewVector("front", side);
    expect(new THREE.Vector3(front.x, 0, front.z).normalize().dot(roadVectors.south)).toBeGreaterThan(0.85);
  });

  test("renders fill kinds per the transparent depth discipline", () => {
    const glass = massingSurfaceStyle("window_glass");
    expect(glass.transparent).toBe(true);
    expect(glass.opacity).toBeLessThan(1);
    expect(glass.depthWrite).toBe(false);
    expect(glass.polygonOffsetUnits).toBe(massingSurfaceStyle("exterior_wall").polygonOffsetUnits);

    const leaf = massingSurfaceStyle("door_leaf");
    expect(leaf.transparent).toBe(false);
    expect(leaf.opacity).toBe(1);
    expect(leaf.depthWrite).toBe(true);
  });

  test("capture layer contract suppresses scale references in GPT sources", () => {
    expect(MASSING_CAPTURE_LAYER_STATE.showScaleReferences).toBe(false); // prompts.ts forbids people/cars
    expect(MASSING_CAPTURE_LAYER_STATE.showInteriorWalls).toBe(false);
    expect(MASSING_CAPTURE_LAYER_STATE.showColumns).toBe(true);
    expect(MASSING_CAPTURE_LAYER_STATE.showSlabs).toBe(true);
    expect(MASSING_CAPTURE_LAYER_STATE.showRoof).toBe(true);
    expect(MASSING_CAPTURE_LAYER_STATE.showSite).toBe(true);
  });
});
