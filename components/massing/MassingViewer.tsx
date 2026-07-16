"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { Building } from "@/lib/building/schema";
import { buildMassingModel, type MassingPrimitiveKind } from "@/lib/render/massing";

export type MassingView = "front" | "rear" | "left" | "right" | "iso";
export type MassingCapture = { role: "massing_front" | "massing_rear" | "massing_iso"; dataUri: string };

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
  modelRadius: number;
};

const MATERIALS: Record<MassingPrimitiveKind, { color: number; opacity?: number; edge: number }> = {
  site: { color: 0x11100e, edge: 0x8e5a31 },
  slab: { color: 0x7a6a5c, edge: 0xc97940 },
  roof: { color: 0x8d7c6e, edge: 0xff9a58 },
  exterior_wall: { color: 0xd8cec0, edge: 0x5b3a22 },
  interior_wall: { color: 0xa39486, opacity: 0.84, edge: 0x6f533e },
  stair: { color: 0xb96834, edge: 0x4b2a18 },
};

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
  if (facing === "north") return new THREE.Vector3(-0.5, 0.42, -1);
  if (facing === "south") return new THREE.Vector3(0.5, 0.42, 1);
  if (facing === "east") return new THREE.Vector3(1, 0.42, 0.5);
  return new THREE.Vector3(-1, 0.42, -0.5);
}

function viewVector(view: MassingView, facing: Building["site"]["facing"]) {
  const front = frontVector(facing).normalize();
  if (view === "front") return front;
  if (view === "rear") return front.clone().multiplyScalar(-1).setY(0.48).normalize();
  if (view === "left") return new THREE.Vector3(-front.z, 0.28, front.x).normalize();
  if (view === "right") return new THREE.Vector3(front.z, 0.28, -front.x).normalize();
  return new THREE.Vector3(1, 0.9, 1).normalize();
}

function compressedDataUri(source: HTMLCanvasElement) {
  const limit = 1200;
  const ratio = Math.min(1, limit / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * ratio));
  canvas.height = Math.max(1, Math.round(source.height * ratio));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to prepare the reference capture.");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  let dataUri = canvas.toDataURL("image/webp", 0.82);
  if (dataUri.length > 1_250_000) dataUri = canvas.toDataURL("image/webp", 0.68);
  if (dataUri.length > 1_350_000) throw new Error("Reference capture is still too large after compression.");
  return dataUri;
}

export const MassingViewer = forwardRef<MassingViewerHandle, MassingViewerProps>(function MassingViewer({
  building,
  visibleFloorIds,
  explodeM,
  showInteriorWalls,
  showSlabs,
  showRoof,
  showSite,
  onReadyChange,
  onError,
}, forwardedRef) {
  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const facingRef = useRef(building.site.facing);

  function setView(view: MassingView, animate = true) {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const target = runtime.controls.target.clone();
    const distance = Math.max(8, runtime.modelRadius * 2.25);
    const destination = target.clone().add(viewVector(view, facingRef.current).multiplyScalar(distance));
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
      if (raw < 1) requestAnimationFrame(move);
    };
    requestAnimationFrame(move);
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
      const captures: MassingCapture[] = [];
      const views = [
        ["front", "massing_front"],
        ["rear", "massing_rear"],
        ["iso", "massing_iso"],
      ] as const;
      const originalPosition = runtime.camera.position.clone();
      const originalTarget = runtime.controls.target.clone();
      for (const [view, role] of views) {
        setView(view, false);
        runtime.renderer.render(runtime.scene, runtime.camera);
        captures.push({ role, dataUri: compressedDataUri(runtime.renderer.domElement) });
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      runtime.camera.position.copy(originalPosition);
      runtime.controls.target.copy(originalTarget);
      runtime.controls.update();
      return captures;
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
      onError?.("WebGL is unavailable in this browser. You can still use the marked-plan fallback.");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080807);
    scene.fog = new THREE.Fog(0x080807, 32, 70);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 250);
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

    scene.add(new THREE.HemisphereLight(0xfff1df, 0x17120f, 2.3));
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
    const runtime: Runtime = { scene, camera, renderer, controls, root, animationFrame: 0, modelRadius: 12 };
    runtimeRef.current = runtime;

    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
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
      controls.dispose();
      disposeObject(root);
      renderer.dispose();
      renderer.domElement.remove();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    facingRef.current = building.site.facing;
    const runtime = runtimeRef.current;
    if (!runtime) return;
    disposeObject(runtime.root);
    runtime.root.clear();
    const model = buildMassingModel(building, {
      visibleFloorIds,
      explodeM,
      includeInteriorWalls: showInteriorWalls,
      includeSlabs: showSlabs,
      includeRoof: showRoof,
      includeSite: showSite,
    });
    for (const primitive of model.primitives) {
      const geometry = new THREE.BoxGeometry(...primitive.size);
      const style = MATERIALS[primitive.kind];
      const material = new THREE.MeshStandardMaterial({
        color: style.color,
        roughness: primitive.kind === "site" ? 0.95 : 0.72,
        metalness: 0.02,
        transparent: style.opacity !== undefined,
        opacity: style.opacity ?? 1,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = primitive.id;
      mesh.position.set(...primitive.center);
      mesh.castShadow = primitive.kind !== "site";
      mesh.receiveShadow = true;
      runtime.root.add(mesh);
      if (primitive.kind !== "site") {
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry, 25),
          new THREE.LineBasicMaterial({ color: style.edge, transparent: true, opacity: 0.72 }),
        );
        edges.position.copy(mesh.position);
        runtime.root.add(edges);
      }
    }
    if (showSite) {
      const grid = new THREE.GridHelper(Math.max(model.widthM, model.depthM) * 1.2, 24, 0x8e5a31, 0x2c241d);
      grid.position.y = 0.006;
      (grid.material as THREE.Material).transparent = true;
      (grid.material as THREE.Material).opacity = 0.34;
      runtime.root.add(grid);
    }
    runtime.modelRadius = Math.max(6, Math.hypot(model.widthM, model.depthM, model.heightM) / 2);
    runtime.controls.target.set(...model.centre);
    runtime.controls.minDistance = Math.max(3, runtime.modelRadius * 0.42);
    runtime.controls.maxDistance = runtime.modelRadius * 5;
    setView("iso", false);
  }, [building, explodeM, showInteriorWalls, showRoof, showSite, showSlabs, visibleFloorIds.join("|")]);

  return <div className="h-full min-h-[34rem] w-full touch-none" ref={containerRef} role="img" aria-label="Interactive deterministic three-dimensional massing model. Drag to rotate, use the mouse wheel to zoom and right-drag to pan." />;
});
