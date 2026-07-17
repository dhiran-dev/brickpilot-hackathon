"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { Building } from "@/lib/building/schema";
import { entranceRoadSide } from "@/lib/building/topology";
import { buildMassingModel, MASSING_GRID_Y_M, type MassingPrimitiveKind } from "@/lib/render/massing";

export type MassingView = "front" | "rear" | "left" | "right" | "iso" | "top";
export type MassingCapture = { role: "massing_front" | "massing_collage" | "massing_top"; dataUri: string };

export const MASSING_CAPTURE_SIZE = { width: 1200, height: 800 } as const;
export const MASSING_CAPTURE_LABELS = {
  front: "SOURCE A · FRONT / ROAD · CAMERA LOCK",
  collage: "SOURCE B · COLLAGE · FOUR LOCKED VIEWS",
  top: "SOURCE C · HIGH 3/4 · FRONT + RIGHT · CAMERA LOCK",
} as const;

export const MASSING_VIEWER_CLASS_NAME = "relative h-full min-h-[34rem] w-full overflow-hidden touch-none";

export function configureMassingCanvas(canvas: Pick<HTMLCanvasElement, "style">) {
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
}

export function massingCanvasSizeChanged(width: number, height: number, lastWidth: number, lastHeight: number) {
  return width !== lastWidth || height !== lastHeight;
}

export function retargetMassingCamera(position: THREE.Vector3, previousTarget: THREE.Vector3, nextTarget: THREE.Vector3) {
  return nextTarget.clone().add(position.clone().sub(previousTarget));
}

export function cancelMassingViewAnimation(frame: number | null, cancel: (frame: number) => void = cancelAnimationFrame) {
  if (frame !== null) cancel(frame);
  return null;
}

export function massingVisibilityOptions(input: {
  showInteriorWalls: boolean;
  showColumns: boolean;
  showSlabs: boolean;
  showRoof: boolean;
  showSite: boolean;
}) {
  return {
    includeInteriorWalls: input.showInteriorWalls,
    includeColumns: input.showColumns,
    includeSlabs: input.showSlabs,
    includeRoof: input.showRoof,
    includeSite: input.showSite,
  };
}

export type MassingViewerHandle = {
  setView: (view: MassingView) => void;
  fit: () => void;
  captureReferenceViews: () => Promise<MassingCapture[]>;
};

type MassingViewerProps = {
  building: Building;
  visibleFloorIds: string[];
  explodeM: number;
  showInteriorWalls: boolean;
  showColumns: boolean;
  showSlabs: boolean;
  showRoof: boolean;
  showSite: boolean;
  onReadyChange?: (ready: boolean) => void;
  onError?: (message: string) => void;
};

type Runtime = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  root: THREE.Group;
  animationFrame: number;
  viewAnimationFrame: number | null;
  modelRadius: number;
  hasFramedModel: boolean;
};

const MATERIALS: Record<MassingPrimitiveKind, { color: number; edge: number }> = {
  site: { color: 0x11100e, edge: 0x8e5a31 },
  slab: { color: 0x7a6a5c, edge: 0xc97940 },
  roof: { color: 0x8d7c6e, edge: 0xff9a58 },
  exterior_wall: { color: 0xd8cec0, edge: 0x5b3a22 },
  interior_wall: { color: 0xa39486, edge: 0x6f533e },
  column: { color: 0xc9c0b2, edge: 0x4a4038 },
  stair: { color: 0xb96834, edge: 0x4b2a18 },
};

// Smaller polygon-offset units win when intentional box intersections share a
// plane. The semantic order keeps columns legible, preserves continuous floor
// plates, and lets exterior walls close internal junctions.
const MASSING_SURFACE_DEPTH_UNITS: Record<MassingPrimitiveKind, number> = {
  column: 1,
  roof: 2,
  slab: 2,
  stair: 3,
  exterior_wall: 4,
  interior_wall: 5,
  site: 6,
};

export function massingSurfaceStyle(kind: MassingPrimitiveKind) {
  const polygonOffsetUnits = MASSING_SURFACE_DEPTH_UNITS[kind];
  return {
    transparent: false as const,
    opacity: 1,
    polygonOffset: true as const,
    polygonOffsetFactor: 1,
    polygonOffsetUnits,
    renderOrder: 100 - polygonOffsetUnits,
  };
}

export const MASSING_EDGE_DEPTH_STYLE = {
  depthTest: true,
  depthWrite: false,
} as const;

export function massingEdgeStyle(kind: MassingPrimitiveKind) {
  return {
    ...MASSING_EDGE_DEPTH_STYLE,
    // Transparent outlines draw from low to high order. Mirror the surface
    // priority so a column or floor edge cannot trade colours with a wall edge.
    renderOrder: 200 - MASSING_SURFACE_DEPTH_UNITS[kind],
  };
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose());
    }
  });
}

function frontVector(facing: Building["site"]["facing"]) {
  if (facing === "north") return new THREE.Vector3(0, 0, -1);
  if (facing === "south") return new THREE.Vector3(0, 0, 1);
  if (facing === "east") return new THREE.Vector3(1, 0, 0);
  return new THREE.Vector3(-1, 0, 0);
}

export function massingViewVector(view: MassingView, facing: Building["site"]["facing"]) {
  const front = frontVector(facing).normalize();
  const right = new THREE.Vector3(-front.z, 0, front.x).normalize();
  if (view === "front") return front.clone().addScaledVector(right, 0.42).setY(0.3).normalize();
  if (view === "rear") return front.clone().multiplyScalar(-1).addScaledVector(right, -0.35).setY(0.3).normalize();
  if (view === "left") return right.clone().multiplyScalar(-1).addScaledVector(front, 0.2).setY(0.28).normalize();
  if (view === "right") return right.clone().addScaledVector(front, 0.2).setY(0.28).normalize();
  if (view === "top") return front.clone().addScaledVector(right, 0.68).setY(1.08).normalize();
  return front.clone().addScaledVector(right, 0.75).setY(0.72).normalize();
}

const CAPTURE_WIDTH = MASSING_CAPTURE_SIZE.width;
const CAPTURE_HEIGHT = MASSING_CAPTURE_SIZE.height;

function drawSourceLabel(context: CanvasRenderingContext2D, label: string, width: number) {
  context.save();
  context.font = "700 18px Arial, sans-serif";
  context.textBaseline = "middle";
  const badgeWidth = Math.min(width - 40, Math.ceil(context.measureText(label).width) + 32);
  context.fillStyle = "rgba(8, 8, 7, 0.9)";
  context.fillRect(20, 20, badgeWidth, 40);
  context.strokeStyle = "rgba(255, 141, 73, 0.9)";
  context.strokeRect(20.5, 20.5, badgeWidth - 1, 39);
  context.fillStyle = "#fff6ea";
  context.fillText(label, 36, 40);
  context.restore();
}

function labeledDataUri(source: HTMLCanvasElement, label: string) {
  const canvas = document.createElement("canvas");
  canvas.width = CAPTURE_WIDTH;
  canvas.height = CAPTURE_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to prepare the reference capture.");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  drawSourceLabel(context, label, canvas.width);
  let dataUri = canvas.toDataURL("image/webp", 0.82);
  if (dataUri.length > 1_250_000) dataUri = canvas.toDataURL("image/webp", 0.68);
  if (dataUri.length > 1_350_000) throw new Error("Reference capture is still too large after compression.");
  return dataUri;
}

function collageDataUri(panels: Array<{ source: HTMLCanvasElement; label: string }>) {
  const canvas = document.createElement("canvas");
  canvas.width = CAPTURE_WIDTH;
  canvas.height = CAPTURE_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to prepare the collage reference.");
  const cellWidth = CAPTURE_WIDTH / 2;
  const cellHeight = CAPTURE_HEIGHT / 2;
  panels.forEach((panel, index) => {
    const x = index % 2 * cellWidth;
    const y = Math.floor(index / 2) * cellHeight;
    context.drawImage(panel.source, x, y, cellWidth, cellHeight);
    context.fillStyle = "rgba(8, 8, 7, 0.88)";
    context.fillRect(x + 12, y + cellHeight - 40, Math.min(cellWidth - 24, 190), 28);
    context.fillStyle = "#fff6ea";
    context.font = "700 14px Arial, sans-serif";
    context.textBaseline = "middle";
    context.fillText(panel.label, x + 22, y + cellHeight - 26);
    context.strokeStyle = "#c97940";
    context.lineWidth = 2;
    context.strokeRect(x + 1, y + 1, cellWidth - 2, cellHeight - 2);
  });
  drawSourceLabel(context, MASSING_CAPTURE_LABELS.collage, canvas.width);
  let dataUri = canvas.toDataURL("image/webp", 0.82);
  if (dataUri.length > 1_250_000) dataUri = canvas.toDataURL("image/webp", 0.68);
  if (dataUri.length > 1_350_000) throw new Error("Collage reference is still too large after compression.");
  return dataUri;
}

export const MassingViewer = forwardRef<MassingViewerHandle, MassingViewerProps>(function MassingViewer({
  building,
  visibleFloorIds,
  explodeM,
  showInteriorWalls,
  showColumns,
  showSlabs,
  showRoof,
  showSite,
  onReadyChange,
  onError,
}, forwardedRef) {
  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const facingRef = useRef(entranceRoadSide(building.site));

  function setView(view: MassingView, animate = true) {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.viewAnimationFrame = cancelMassingViewAnimation(runtime.viewAnimationFrame);
    const target = runtime.controls.target.clone();
    const distance = Math.max(8, runtime.modelRadius * 2.25);
    const destination = target.clone().add(massingViewVector(view, facingRef.current).multiplyScalar(distance));
    if (!animate) {
      runtime.camera.position.copy(destination);
      runtime.controls.update();
      return;
    }
    const start = runtime.camera.position.clone();
    const started = performance.now();
    const duration = 360;
    const move = (now: number) => {
      const raw = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - raw, 3);
      runtime.camera.position.lerpVectors(start, destination, eased);
      runtime.controls.update();
      if (raw < 1) runtime.viewAnimationFrame = requestAnimationFrame(move);
      else runtime.viewAnimationFrame = null;
    };
    runtime.viewAnimationFrame = requestAnimationFrame(move);
  }

  function fit() {
    setView("iso");
  }

  useImperativeHandle(forwardedRef, () => ({
    setView,
    fit,
    async captureReferenceViews() {
      const runtime = runtimeRef.current;
      if (!runtime) throw new Error("The 3D model is not ready yet.");
      runtime.viewAnimationFrame = cancelMassingViewAnimation(runtime.viewAnimationFrame);
      const originalPosition = runtime.camera.position.clone();
      const originalTarget = runtime.controls.target.clone();
      const originalSize = runtime.renderer.getSize(new THREE.Vector2());
      const originalPixelRatio = runtime.renderer.getPixelRatio();
      const originalAspect = runtime.camera.aspect;
      const snapshots = new Map<MassingView, HTMLCanvasElement>();
      try {
        runtime.renderer.setPixelRatio(1);
        runtime.renderer.setSize(CAPTURE_WIDTH, CAPTURE_HEIGHT, false);
        runtime.camera.aspect = CAPTURE_WIDTH / CAPTURE_HEIGHT;
        runtime.camera.updateProjectionMatrix();
        for (const view of ["front", "rear", "right", "top"] as const) {
          setView(view, false);
          runtime.renderer.render(runtime.scene, runtime.camera);
          const snapshot = document.createElement("canvas");
          snapshot.width = CAPTURE_WIDTH;
          snapshot.height = CAPTURE_HEIGHT;
          const context = snapshot.getContext("2d");
          if (!context) throw new Error("Unable to prepare the fixed camera reference.");
          context.drawImage(runtime.renderer.domElement, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
          snapshots.set(view, snapshot);
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        const front = snapshots.get("front")!;
        const top = snapshots.get("top")!;
        return [
          { role: "massing_front", dataUri: labeledDataUri(front, MASSING_CAPTURE_LABELS.front) },
          {
            role: "massing_collage",
            dataUri: collageDataUri([
              { source: front, label: "FRONT / ROAD" },
              { source: snapshots.get("rear")!, label: "REAR" },
              { source: snapshots.get("right")!, label: "RIGHT SIDE" },
              { source: top, label: "HIGH 3/4" },
            ]),
          },
          { role: "massing_top", dataUri: labeledDataUri(top, MASSING_CAPTURE_LABELS.top) },
        ];
      } finally {
        runtime.renderer.setPixelRatio(originalPixelRatio);
        runtime.renderer.setSize(originalSize.x, originalSize.y, false);
        runtime.camera.aspect = originalAspect;
        runtime.camera.updateProjectionMatrix();
        runtime.camera.position.copy(originalPosition);
        runtime.controls.target.copy(originalTarget);
        runtime.controls.update();
      }
    },
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    onReadyChange?.(false);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    } catch {
      onError?.("WebGL is unavailable in this browser, so camera-locked render sources cannot be prepared.");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    configureMassingCanvas(renderer.domElement);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x14120f);
    scene.fog = new THREE.Fog(0x14120f, 32, 70);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 250);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.minPolarAngle = 0.08;
    controls.maxPolarAngle = Math.PI / 2.03;
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    controls.touches.ONE = THREE.TOUCH.ROTATE;
    controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;

    scene.add(new THREE.HemisphereLight(0xfff1df, 0x3d362e, 2.3));
    const key = new THREE.DirectionalLight(0xffe3c4, 3.4);
    key.position.set(-12, 22, 10);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 80;
    key.shadow.camera.left = -24;
    key.shadow.camera.right = 24;
    key.shadow.camera.top = 24;
    key.shadow.camera.bottom = -24;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xc97940, 1.2);
    rim.position.set(14, 10, -16);
    scene.add(rim);

    const root = new THREE.Group();
    scene.add(root);
    const runtime: Runtime = { scene, camera, renderer, controls, root, animationFrame: 0, viewAnimationFrame: null, modelRadius: 12, hasFramedModel: false };
    runtimeRef.current = runtime;

    let lastWidth = 0;
    let lastHeight = 0;
    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      if (!massingCanvasSizeChanged(width, height, lastWidth, lastHeight)) return;
      lastWidth = width;
      lastHeight = height;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    const render = () => {
      controls.update();
      renderer.render(scene, camera);
      runtime.animationFrame = requestAnimationFrame(render);
    };
    render();
    onReadyChange?.(true);

    return () => {
      onReadyChange?.(false);
      observer.disconnect();
      cancelAnimationFrame(runtime.animationFrame);
      runtime.viewAnimationFrame = cancelMassingViewAnimation(runtime.viewAnimationFrame);
      controls.dispose();
      disposeObject(root);
      renderer.dispose();
      renderer.domElement.remove();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const entranceSide = entranceRoadSide(building.site);
    if (entranceSide !== building.site.facing) {
      console.info(`[massing] Front camera follows entrance road side "${entranceSide}"; site facing "${building.site.facing}" has no road edge.`);
    }
    facingRef.current = entranceSide;
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.viewAnimationFrame = cancelMassingViewAnimation(runtime.viewAnimationFrame);
    const previousTarget = runtime.controls.target.clone();
    const previousCameraPosition = runtime.camera.position.clone();
    disposeObject(runtime.root);
    runtime.root.clear();
    const model = buildMassingModel(building, {
      visibleFloorIds,
      explodeM,
      ...massingVisibilityOptions({ showInteriorWalls, showColumns, showSlabs, showRoof, showSite }),
    });
    for (const primitive of model.primitives) {
      const geometry = new THREE.BoxGeometry(...primitive.size);
      const style = MATERIALS[primitive.kind];
      const surfaceStyle = massingSurfaceStyle(primitive.kind);
      const material = new THREE.MeshStandardMaterial({
        color: style.color,
        roughness: primitive.kind === "site" ? 0.95 : 0.72,
        metalness: 0.02,
        transparent: surfaceStyle.transparent,
        opacity: surfaceStyle.opacity,
        polygonOffset: surfaceStyle.polygonOffset,
        polygonOffsetFactor: surfaceStyle.polygonOffsetFactor,
        polygonOffsetUnits: surfaceStyle.polygonOffsetUnits,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = primitive.id;
      mesh.position.set(...primitive.center);
      mesh.renderOrder = surfaceStyle.renderOrder;
      mesh.castShadow = primitive.kind !== "site";
      mesh.receiveShadow = true;
      runtime.root.add(mesh);
      if (primitive.kind !== "site") {
        const edgeStyle = massingEdgeStyle(primitive.kind);
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry, 25),
          new THREE.LineBasicMaterial({
            color: style.edge,
            transparent: true,
            opacity: 0.72,
            depthTest: edgeStyle.depthTest,
            depthWrite: edgeStyle.depthWrite,
          }),
        );
        edges.position.copy(mesh.position);
        edges.renderOrder = edgeStyle.renderOrder;
        runtime.root.add(edges);
      }
    }
    if (showSite) {
      const grid = new THREE.GridHelper(Math.max(model.widthM, model.depthM) * 1.2, 24, 0x8e5a31, 0x2c241d);
      grid.position.y = MASSING_GRID_Y_M;
      (grid.material as THREE.Material).transparent = true;
      (grid.material as THREE.Material).opacity = 0.34;
      runtime.root.add(grid);
    }
    const buildingPrimitives = model.primitives.filter((primitive) => primitive.kind !== "site");
    if (buildingPrimitives.length > 0) {
      const min = new THREE.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
      const max = new THREE.Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
      for (const primitive of buildingPrimitives) {
        const centre = new THREE.Vector3(...primitive.center);
        const half = new THREE.Vector3(...primitive.size).multiplyScalar(0.5);
        min.min(centre.clone().sub(half));
        max.max(centre.clone().add(half));
      }
      const size = max.clone().sub(min);
      const centre = min.clone().add(max).multiplyScalar(0.5);
      runtime.modelRadius = Math.max(4, size.length() / 2);
      runtime.controls.target.set(centre.x, min.y + size.y * 0.45, centre.z);
    } else {
      runtime.modelRadius = Math.max(6, Math.hypot(model.widthM, model.depthM, model.heightM) / 2);
      runtime.controls.target.set(...model.centre);
    }
    runtime.controls.minDistance = Math.max(3, runtime.modelRadius * 0.42);
    runtime.controls.maxDistance = runtime.modelRadius * 5;
    if (runtime.hasFramedModel) {
      runtime.camera.position.copy(retargetMassingCamera(previousCameraPosition, previousTarget, runtime.controls.target));
      runtime.controls.update();
    } else {
      runtime.hasFramedModel = true;
      setView("iso", false);
    }
  }, [building, explodeM, showColumns, showInteriorWalls, showRoof, showSite, showSlabs, visibleFloorIds.join("|")]);

  return <div className={MASSING_VIEWER_CLASS_NAME} ref={containerRef} role="img" aria-label="Interactive deterministic three-dimensional massing model. Drag to rotate, use the mouse wheel to zoom and right-drag to pan." />;
});
