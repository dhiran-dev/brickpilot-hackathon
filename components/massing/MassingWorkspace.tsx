"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  ArrowLeft,
  BadgeCheck,
  Box,
  Camera,
  Check,
  CircleAlert,
  Clock3,
  Eye,
  EyeOff,
  Focus,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  MousePointer2,
  Move3d,
  RefreshCw,
  Rotate3d,
  Ruler,
  Scan,
  ZoomIn,
} from "lucide-react";

import { MassingViewer, type MassingCapture, type MassingViewerHandle, type MassingView } from "@/components/massing";
import type { BuildingRequirements } from "@/lib/building/requirements";
import type { Building } from "@/lib/building/schema";
import { massingMetrics } from "@/lib/render/massing";
import { buildReferencePlanSvg } from "@/lib/render/reference-plan";

type Study = {
  projectId: string;
  designId: string;
  version: number;
  title: string;
  status: string;
  requirements: BuildingRequirements;
  building: Building;
  validation: { valid: boolean; score: number; counts: { error: number; warning: number; info: number } };
};

type RenderState = {
  status: "idle" | "processing" | "partial" | "completed" | "failed";
  jobs: Array<{ id: string; purpose: "exterior_front" | "exterior_collage" | "exterior_top" | "interior" | null; status: string; failureReason: string | null; createdAt: string }>;
  assets: Array<{ id: string; role: "exterior_front" | "exterior_collage" | "exterior_top" | "interior" | string; url: string; contentType: string; index: number }>;
  sources: Array<{ id: string; role: string; url: string; contentType: string }>;
};

type PreparedReference = MassingCapture | { role: "plan_reference"; dataUri: string };

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function svgToWebp(svg: string) {
  const blobUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The marked plan board could not be rasterized."));
      image.src = blobUrl;
    });
    const ratio = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The marked plan board could not be prepared.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let result = canvas.toDataURL("image/webp", 0.82);
    if (result.length > 1_250_000) result = canvas.toDataURL("image/webp", 0.66);
    if (result.length > 1_350_000) throw new Error("The marked plan reference is too large after compression.");
    return result;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

function formatMetric(value: number, suffix: string, digits = 1) {
  return `${value.toFixed(digits)} ${suffix}`;
}

function markInteriorPlanSource(svg: string) {
  return svg.replace("</svg>", `<rect x="56" y="100" width="470" height="34" fill="#090908" stroke="#ff8d49"/><text x="72" y="122" fill="#fff6ea" font-family="Arial, sans-serif" font-size="15" font-weight="700">SOURCE D · INTERIOR · PLAN-DERIVED CAMERA</text></svg>`);
}

export function MassingWorkspace({ layoutVersionId, userName }: { layoutVersionId: string; userName: string }) {
  const viewerRef = useRef<MassingViewerHandle>(null);
  const [study, setStudy] = useState<Study | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [visibleFloorIds, setVisibleFloorIds] = useState<string[]>([]);
  const [explodePercent, setExplodePercent] = useState(0);
  const [showInteriorWalls, setShowInteriorWalls] = useState(true);
  const [showSlabs, setShowSlabs] = useState(true);
  const [showRoof, setShowRoof] = useState(true);
  const [showSite, setShowSite] = useState(true);
  const [selectedInteriorSpaceId, setSelectedInteriorSpaceId] = useState("");
  const [references, setReferences] = useState<PreparedReference[] | null>(null);
  const [referenceKey, setReferenceKey] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [renderState, setRenderState] = useState<RenderState>({ status: "idle", jobs: [], assets: [], sources: [] });

  const loadRenderState = useCallback(async () => {
    const response = await fetch(`/api/designs/${layoutVersionId}/renders`, { cache: "no-store" });
    if (!response.ok) return;
    setRenderState(await response.json() as RenderState);
  }, [layoutVersionId]);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(`/api/designs/${layoutVersionId}`, { cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error ?? "Unable to load this study.");
        return response.json() as Promise<Study>;
      }),
      fetch(`/api/designs/${layoutVersionId}/renders`, { cache: "no-store" }).then((response) => response.ok ? response.json() as Promise<RenderState> : null),
    ]).then(([loadedStudy, loadedRenders]) => {
      if (!active) return;
      setStudy(loadedStudy);
      setVisibleFloorIds(loadedStudy.building.floors.map((floor) => floor.id));
      const preferred = loadedStudy.building.floors.flatMap((floor) => floor.spaces)
        .find((space) => space.type === "living" || space.type === "dining" || space.type === "bedroom");
      setSelectedInteriorSpaceId(preferred?.id ?? loadedStudy.building.floors[0].spaces[0].id);
      if (loadedRenders) setRenderState(loadedRenders);
    }).catch((error) => {
      if (active) setLoadError(error instanceof Error ? error.message : "Unable to load this study.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [layoutVersionId]);

  useEffect(() => {
    if (renderState.status !== "processing") return;
    const timer = window.setTimeout(() => void loadRenderState(), document.visibilityState === "visible" ? 2500 : 7000);
    return () => window.clearTimeout(timer);
  }, [loadRenderState, renderState]);

  useEffect(() => {
    setReferences(null);
    setReferenceKey(null);
  }, [selectedInteriorSpaceId]);

  const floors = useMemo(() => study ? [...study.building.floors].sort((left, right) => left.level - right.level) : [], [study]);
  const eligibleInteriorSpaces = useMemo(() => floors.flatMap((floor) => floor.spaces.map((space) => ({ ...space, floorLabel: floor.label })))
    .filter((space) => space.occupied && !["parking", "circulation", "stair", "courtyard", "terrace", "balcony"].includes(space.type)), [floors]);
  const metrics = useMemo(() => study ? massingMetrics(study.building) : null, [study]);
  const currentReferenceKey = study ? `${study.building.candidate.geometryHash}:${selectedInteriorSpaceId}` : "";
  const referencesCurrent = references && referenceKey === currentReferenceKey;
  const assetsByRole = useMemo(() => new Map(renderState.assets.map((asset) => [asset.role, asset])), [renderState.assets]);
  const sourcesByRole = useMemo(() => new Map((renderState.sources ?? []).map((source) => [source.role, source])), [renderState.sources]);
  const layerControls = [
    { label: "Internal walls", checked: showInteriorWalls, setChecked: setShowInteriorWalls, Icon: Layers3 },
    { label: "Floor slabs", checked: showSlabs, setChecked: setShowSlabs, Icon: Box },
    { label: "Roof", checked: showRoof, setChecked: setShowRoof, Icon: Box },
    { label: "Site + grid", checked: showSite, setChecked: setShowSite, Icon: Ruler },
  ];

  function toggleFloor(floorId: string) {
    setVisibleFloorIds((current) => current.includes(floorId) ? current.filter((id) => id !== floorId) : [...current, floorId]);
  }

  async function prepareReferences() {
    if (!study) return;
    setPreparing(true);
    setActionError(null);
    const prior = { visibleFloorIds, explodePercent, showInteriorWalls, showSlabs, showRoof, showSite };
    try {
      if (!viewerReady || !viewerRef.current) throw new Error("The 3D viewer is required to prepare the camera-locked render sources.");
      flushSync(() => {
        setVisibleFloorIds(floors.map((floor) => floor.id));
        setExplodePercent(0);
        setShowInteriorWalls(false);
        setShowSlabs(true);
        setShowRoof(true);
        setShowSite(true);
      });
      await nextFrame();
      await nextFrame();
      const captures: MassingCapture[] = await viewerRef.current.captureReferenceViews();
      const planSvg = markInteriorPlanSource(buildReferencePlanSvg(study.building, { projectName: study.title, selectedSpaceId: selectedInteriorSpaceId }));
      const planDataUri = await svgToWebp(planSvg);
      setReferences([{ role: "plan_reference", dataUri: planDataUri }, ...captures]);
      setReferenceKey(currentReferenceKey);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to prepare the reference set.");
    } finally {
      flushSync(() => {
        setVisibleFloorIds(prior.visibleFloorIds);
        setExplodePercent(prior.explodePercent);
        setShowInteriorWalls(prior.showInteriorWalls);
        setShowSlabs(prior.showSlabs);
        setShowRoof(prior.showRoof);
        setShowSite(prior.showSite);
      });
      setPreparing(false);
    }
  }

  async function confirmAndGenerate() {
    if (!study || !referencesCurrent) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/designs/${layoutVersionId}/renders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          geometryHash: study.building.candidate.geometryHash,
          selectedInteriorSpaceId,
          references,
        }),
      });
      const payload = await response.json().catch(() => ({})) as RenderState & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to start the render package.");
      setRenderState(payload);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to start the render package.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <main className="grid min-h-screen place-items-center bg-[#090908] text-[#fff6ea]"><div className="flex items-center gap-3 text-xs uppercase tracking-[0.15em] text-[#c97940]"><LoaderCircle className="h-4 w-4 animate-spin" /> Loading canonical model</div></main>;
  if (!study || loadError) return <main className="grid min-h-screen place-items-center bg-[#090908] p-6 text-[#fff6ea]"><div className="max-w-lg border border-[#8e5a31]/60 bg-[#11100e] p-7"><CircleAlert className="h-6 w-6 text-[#ff806f]" /><h1 className="mt-4 font-[family-name:var(--font-display)] text-3xl">3D massing unavailable</h1><p className="mt-3 text-sm leading-6 text-[#b5a697]">{loadError ?? "This study could not be loaded."}</p><Link className="mt-6 inline-flex items-center gap-2 border border-[#c97940] px-4 py-3 text-xs font-bold uppercase tracking-[0.12em]" href="/workspace"><ArrowLeft className="h-4 w-4" /> Back to workspace</Link></div></main>;

  const explodeM = metrics ? metrics.heightM * explodePercent / 100 / Math.max(1, metrics.storeys - 1) : 0;

  return <main className="min-h-screen bg-[#090908] text-[#fff6ea]">
    <header className="border-b border-[#8e5a31]/50 bg-[#080807]">
      <div className="mx-auto flex w-full max-w-[112rem] items-center justify-between gap-6 px-5 py-4 lg:px-8">
        <div className="flex min-w-0 items-center gap-5"><Link className="font-[family-name:var(--font-display)] text-3xl tracking-[-0.035em] text-[#d6a06d]" href="/workspace">BrickPilot</Link><span className="hidden h-7 w-px bg-[#8e5a31]/45 sm:block" /><p className="hidden truncate text-[0.63rem] font-bold uppercase tracking-[0.13em] text-[#84786e] sm:block">{study.title} · immutable v{study.version}</p></div>
        <p className="hidden text-xs text-[#74695f] md:block">Signed in as {userName}</p>
      </div>
      <nav aria-label="Design workflow" className="mx-auto grid w-full max-w-[112rem] grid-cols-4 border-t border-[#8e5a31]/25 px-5 lg:px-8">
        {["Brief", "2D analysis", "3D massing", "Visualization"].map((label, index) => <div className={`flex items-center gap-2 border-r border-[#8e5a31]/25 py-3 text-[0.61rem] font-bold uppercase tracking-[0.13em] last:border-r-0 ${index === 2 ? "text-[#ff8d49]" : index < 2 ? "text-[#9f9183]" : renderState.status === "completed" ? "text-[#7bc79e]" : "text-[#574f48]"}`} key={label}><span className={`grid h-5 w-5 place-items-center border ${index === 2 ? "border-[#ff4e00]" : "border-[#8e5a31]/50"}`}>{index < 2 || (index === 3 && renderState.status === "completed") ? <Check className="h-3 w-3" /> : index + 1}</span>{label}</div>)}
      </nav>
    </header>

    <div className="mx-auto w-full max-w-[112rem] px-3 py-3 lg:px-5">
      <section className="overflow-hidden border border-[#8e5a31]/55 bg-[#0c0b09] shadow-[9px_10px_0_rgba(3,3,2,0.72)]">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#8e5a31]/45 bg-[#0b0a09] px-5 py-4">
          <div><p className="text-[0.59rem] font-extrabold uppercase tracking-[0.15em] text-[#ff8d49]">Massing model · deterministic</p><h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl tracking-[-0.03em]">{study.title}</h1></div>
          <div className="flex items-center gap-2"><span className="inline-flex items-center gap-2 border border-[#38765a]/60 px-3 py-2 text-[0.61rem] font-bold uppercase tracking-[0.1em] text-[#7bc79e]"><BadgeCheck className="h-3.5 w-3.5" /> Geometry verified</span><Link className="inline-flex items-center gap-2 border border-[#8e5a31]/60 px-3 py-2 text-[0.61rem] font-bold uppercase tracking-[0.1em] text-[#cdbdab] hover:bg-[#171512]" href="/workspace"><ArrowLeft className="h-3.5 w-3.5" /> Back to 2D</Link></div>
        </div>

        <div className="grid min-h-[44rem] min-[72rem]:grid-cols-[15.5rem_minmax(0,1fr)_20rem]">
          <aside className="border-b border-[#8e5a31]/45 bg-[#0d0c0a] p-5 min-[72rem]:border-b-0 min-[72rem]:border-r">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-[0.16em] text-[#c97940]">Floors</p>
            <div className="mt-4 border-t border-[#8e5a31]/45">
              <button className="flex w-full items-center gap-3 border-b border-[#8e5a31]/30 py-3 text-left text-[0.67rem] font-bold uppercase tracking-[0.12em]" onClick={() => setVisibleFloorIds(floors.map((floor) => floor.id))} type="button"><span className={`grid h-7 w-7 place-items-center border ${visibleFloorIds.length === floors.length ? "border-[#ff6a22] bg-[#d94608]" : "border-[#8e5a31]/65"}`}>{visibleFloorIds.length === floors.length ? <Check className="h-4 w-4" /> : null}</span>All floors</button>
              {floors.map((floor) => <button className="flex w-full items-center gap-3 border-b border-[#8e5a31]/30 py-3 text-left text-[0.67rem] font-bold uppercase tracking-[0.12em] text-[#cbbbad]" key={floor.id} onClick={() => toggleFloor(floor.id)} type="button"><span className={`grid h-7 w-7 place-items-center border ${visibleFloorIds.includes(floor.id) ? "border-[#c97940] bg-[#25170f] text-[#ff8d49]" : "border-[#8e5a31]/55 text-[#5f554d]"}`}>{visibleFloorIds.includes(floor.id) ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}</span><span><span className="block">{floor.label}</span><span className="mt-1 block text-[0.52rem] font-medium text-[#665c54]">+{(floor.elevationMm / 1000).toFixed(2)} m</span></span></button>)}
            </div>
            <label className="mt-6 block border-b border-[#8e5a31]/35 pb-5"><span className="flex items-center justify-between text-[0.62rem] font-bold uppercase tracking-[0.13em] text-[#c97940]"><span>Explode</span><span>{explodePercent}%</span></span><input aria-label="Explode floor stack" className="mt-4 w-full accent-[#ff4e00]" max="55" min="0" onChange={(event) => setExplodePercent(Number(event.target.value))} step="1" type="range" value={explodePercent} /></label>
            <div className="mt-5 space-y-2">
              {layerControls.map(({ label, checked, setChecked, Icon }) => <button aria-pressed={checked} className="flex w-full items-center justify-between border border-[#8e5a31]/35 px-3 py-2.5 text-[0.59rem] font-bold uppercase tracking-[0.1em] text-[#b5a697] hover:bg-[#171512]" key={label} onClick={() => setChecked(!checked)} type="button"><span className="flex items-center gap-2"><Icon className="h-3.5 w-3.5" />{label}</span><span className={`h-2.5 w-2.5 ${checked ? "bg-[#ff6a22]" : "border border-[#69594c]"}`} /></button>)}
            </div>
            <div className="mt-6 border-t border-[#8e5a31]/35 pt-4 text-[0.63rem] leading-5 text-[#786d62]"><p className="flex items-center gap-2"><Rotate3d className="h-3.5 w-3.5 text-[#c97940]" /> Drag to rotate</p><p className="mt-1 flex items-center gap-2"><ZoomIn className="h-3.5 w-3.5 text-[#c97940]" /> Wheel or pinch to zoom</p><p className="mt-1 flex items-center gap-2"><Move3d className="h-3.5 w-3.5 text-[#c97940]" /> Right-drag to pan</p></div>
          </aside>

          <div className="relative min-h-[44rem] overflow-hidden bg-[#080807]">
            <MassingViewer building={study.building} explodeM={explodeM} onError={setViewerError} onReadyChange={setViewerReady} ref={viewerRef} showInteriorWalls={showInteriorWalls} showRoof={showRoof} showSite={showSite} showSlabs={showSlabs} visibleFloorIds={visibleFloorIds} />
            <div className="absolute right-4 top-4 z-10 border border-[#8e5a31]/60 bg-[#0b0a09]/95 shadow-[4px_5px_0_rgba(0,0,0,0.4)]">
              <div className="grid grid-cols-4 border-b border-[#8e5a31]/45 text-[#cdbdab]">{[[Rotate3d, "Rotate"], [Move3d, "Pan"], [ZoomIn, "Zoom"], [Scan, "Fit"]].map(([Icon, label], index) => <button className="grid min-h-14 min-w-14 place-items-center border-r border-[#8e5a31]/35 px-2 text-[0.48rem] font-bold uppercase tracking-[0.08em] last:border-r-0 hover:bg-[#211711]" key={label as string} onClick={() => index === 3 && viewerRef.current?.fit()} type="button"><Icon className="h-4 w-4" /><span>{label as string}</span></button>)}</div>
              <div className="grid grid-cols-6 text-[#a99a8d]">{(["front", "rear", "left", "right", "iso", "top"] as MassingView[]).map((view) => <button className="border-r border-[#8e5a31]/35 px-2 py-2 text-[0.48rem] font-bold uppercase tracking-[0.08em] last:border-r-0 hover:bg-[#211711] hover:text-[#fff6ea]" key={view} onClick={() => viewerRef.current?.setView(view)} type="button">{view}</button>)}</div>
            </div>
            <div className="absolute bottom-4 left-4 z-10 flex items-end gap-3"><div className="relative h-16 w-16 border border-[#c97940]/65 bg-[#0b0a09]/90"><span className="absolute left-2 top-2 text-[0.5rem] text-[#c97940]">TOP</span><span className="absolute bottom-2 left-2 text-[0.5rem] text-[#fff6ea]">FRONT</span><span className="absolute bottom-2 right-2 text-[0.5rem] text-[#b5a697]">RIGHT</span></div><span className="text-[0.57rem] uppercase tracking-[0.09em] text-[#756a60]">Canonical mm → scene metres</span></div>
            {viewerError ? <div className="absolute inset-x-4 bottom-4 z-20 border border-[#c28a2a]/60 bg-[#18140b]/95 p-4 text-xs leading-5 text-[#e7b756]"><CircleAlert className="mr-2 inline h-4 w-4" />{viewerError}</div> : null}
          </div>

          <aside className="border-t border-[#8e5a31]/45 bg-[#0d0c0a] p-5 min-[72rem]:border-l min-[72rem]:border-t-0">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-[0.16em] text-[#c97940]">Model evidence</p>
            <div className="mt-4 flex items-center gap-2 border border-[#49755d]/65 px-3 py-3 text-[0.63rem] font-bold uppercase tracking-[0.12em] text-[#8ad0a7]"><BadgeCheck className="h-4 w-4" /> Geometry verified</div>
            {metrics ? <dl className="mt-4 border-t border-[#8e5a31]/35">{[
              [Layers3, String(metrics.storeys), "storeys"],
              [Ruler, formatMetric(metrics.heightM, "m"), "height"],
              [Focus, formatMetric(metrics.builtAreaM2, "m²"), "built area"],
              [Box, String(metrics.openingCount), "openings"],
              [BadgeCheck, metrics.stairAligned ? "Aligned" : "Review", "stair core"],
            ].map(([Icon, value, label]) => <div className="grid grid-cols-[1.5rem_1fr_auto] items-center gap-2 border-b border-[#8e5a31]/30 py-3" key={label as string}><Icon className="h-4 w-4 text-[#c97940]" /><dd className="font-[family-name:var(--font-display)] text-xl">{value as string}</dd><dt className="text-[0.54rem] font-bold uppercase tracking-[0.11em] text-[#8f8275]">{label as string}</dt></div>)}</dl> : null}
            <div className="mt-6"><div className="flex items-center justify-between"><p className="text-[0.61rem] font-extrabold uppercase tracking-[0.14em] text-[#c97940]">Reference captures</p>{referencesCurrent ? <span className="text-[0.53rem] font-bold uppercase tracking-[0.08em] text-[#7bc79e]">Local only</span> : null}</div>
              <div className="mt-3 grid grid-cols-3 gap-1.5">{(["massing_front", "massing_collage", "massing_top"] as const).map((role) => { const reference = references?.find((item) => item.role === role); return <div className="relative aspect-[3/2] border border-[#8e5a31]/45 bg-[#090908]" key={role}>{reference ? <img alt={`${role.replaceAll("_", " ")} local reference`} className="h-full w-full object-cover" src={reference.dataUri} /> : <div className="grid h-full place-items-center"><Camera className="h-4 w-4 text-[#574d45]" /></div>}<span className="absolute inset-x-0 bottom-0 bg-[#090908]/90 px-1 py-1 text-center text-[0.42rem] font-bold uppercase tracking-[0.06em] text-[#b5a697]">{role.replace("massing_", "")}</span>{reference ? <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center bg-[#1f5b3d]"><Check className="h-2.5 w-2.5" /></span> : null}</div>; })}</div>
              <button className="mt-3 inline-flex w-full items-center justify-center gap-2 border border-[#c97940]/70 px-3 py-2.5 text-[0.58rem] font-bold uppercase tracking-[0.1em] hover:bg-[#171512] disabled:opacity-45" disabled={preparing || !selectedInteriorSpaceId || !viewerReady} onClick={() => void prepareReferences()} type="button">{preparing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}{referencesCurrent ? "Refresh reference set" : "Prepare reference set"}</button>
            </div>
            <label className="mt-6 block"><span className="text-[0.61rem] font-extrabold uppercase tracking-[0.14em] text-[#c97940]">Interior source</span><select className="mt-3 w-full border border-[#8e5a31]/60 bg-[#090908] px-3 py-3 text-xs text-[#fff6ea] outline-none focus:border-[#ff4e00]" onChange={(event) => setSelectedInteriorSpaceId(event.target.value)} value={selectedInteriorSpaceId}>{eligibleInteriorSpaces.map((space) => <option key={space.id} value={space.id}>{space.name} · {space.floorLabel}</option>)}</select></label>
            <p className="mt-3 text-[0.61rem] leading-5 text-[#786d62]">The marked interior plan and three fixed 3:2 camera sources ground four separate image-edit jobs. References remain in this browser until confirmation.</p>
          </aside>
        </div>

        <div className="grid gap-4 border-t border-[#8e5a31]/50 bg-[#0a0908] p-5 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-center">
          <div className="flex items-start gap-4"><span className="grid h-12 w-12 shrink-0 place-items-center border border-[#8e5a31]/65"><LockKeyhole className="h-5 w-5 text-[#c97940]" /></span><div><p className="font-[family-name:var(--font-display)] text-xl">{renderState.status === "idle" ? "Nothing has been sent to GPT Image 2." : renderState.status === "processing" ? "GPT Image 2 is creating the grounded concepts." : renderState.status === "completed" ? "All four grounded concepts are ready." : "The massing remains available while renders are recovered."}</p><p className="mt-1 text-xs leading-5 text-[#8f8275]">{renderState.status === "idle" ? "Prepare and review the local reference set, then confirm explicitly." : renderState.status === "processing" ? "This page can be left and reopened; status is persisted and reconciled." : "Concept visualization only. Geometry remains authoritative in the 2D and massing views."}</p>{actionError ? <p className="mt-2 text-xs text-[#ff806f]">{actionError}</p> : null}</div></div>
          <div className="border-l border-[#8e5a31]/40 pl-5"><p className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.1em]"><Camera className="h-4 w-4 text-[#c97940]" /> Front + collage + top + interior</p><p className="mt-1 flex items-center gap-2 text-[0.61rem] text-[#8f8275]"><Clock3 className="h-3.5 w-3.5" /> Four camera-locked async edits</p></div>
          {renderState.status === "processing" ? <button className="inline-flex min-w-64 items-center justify-center gap-2 border border-[#8e5a31]/55 px-5 py-4 text-[0.66rem] font-bold uppercase tracking-[0.12em] text-[#b5a697]" disabled type="button"><LoaderCircle className="h-4 w-4 animate-spin" /> Rendering package</button> : renderState.status === "completed" ? <a className="inline-flex min-w-64 items-center justify-center gap-2 border border-[#38765a]/65 px-5 py-4 text-[0.66rem] font-bold uppercase tracking-[0.12em] text-[#7bc79e]" href="#render-gallery"><Eye className="h-4 w-4" /> View final concepts</a> : <button className="inline-flex min-w-64 items-center justify-center gap-2 bg-[#e94300] px-5 py-4 text-[0.66rem] font-extrabold uppercase tracking-[0.12em] text-[#fff6ea] transition hover:bg-[#ff4e00] disabled:cursor-not-allowed disabled:bg-[#4d2515] disabled:text-[#957461]" disabled={!referencesCurrent || submitting} onClick={() => void confirmAndGenerate()} type="button">{submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : renderState.status === "failed" || renderState.status === "partial" ? <RefreshCw className="h-4 w-4" /> : <MousePointer2 className="h-4 w-4" />}{renderState.status === "failed" || renderState.status === "partial" ? "Retry missing render" : "Confirm & generate 4 renders"}</button>}
        </div>
      </section>

      {renderState.status !== "idle" ? <section className="mt-8 border border-[#8e5a31]/55 bg-[#0c0b09] p-5" id="render-gallery"><div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#8e5a31]/40 pb-4"><div><p className="text-[0.61rem] font-extrabold uppercase tracking-[0.15em] text-[#c97940]">Visualization set</p><h2 className="mt-1 font-[family-name:var(--font-display)] text-3xl">Concept renders grounded in your plan</h2></div><p className="max-w-xl text-xs leading-5 text-[#786d62]">Materials, furnishing and lighting are generative assumptions. Floor count, footprint and openings are constrained by the canonical references.</p></div>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">{([
          ["exterior_front", "Front / road perspective"],
          ["exterior_collage", "Four-view collage"],
          ["exterior_top", "High front-right perspective"],
          ["interior", "Furnished interior concept"],
        ] as const).map(([role, label]) => { const asset = assetsByRole.get(role); const sourceRole = role === "exterior_front" ? "massing_front" : role === "exterior_collage" ? "massing_collage" : role === "exterior_top" ? "massing_top" : "plan_reference"; const source = sourcesByRole.get(sourceRole); return <article className="border border-[#8e5a31]/45 bg-[#090908]" key={role}><div className="relative aspect-[3/2] overflow-hidden">{asset ? <img alt={label} className="h-full w-full object-cover" loading="lazy" src={asset.url} /> : <div className="grid h-full place-items-center bg-[linear-gradient(120deg,#0b0a09,#17120f,#0b0a09)] bg-[length:220%_100%] animate-[pulse_2s_ease-in-out_infinite]"><span className="text-[0.61rem] font-bold uppercase tracking-[0.13em] text-[#695d53]">{label} · {renderState.status === "failed" ? "unavailable" : "rendering"}</span></div>}<span className="absolute left-3 top-3 bg-[#090908]/90 px-2 py-1 text-[0.52rem] font-bold uppercase tracking-[0.1em] text-[#fff6ea]">{label}</span></div><div className="grid grid-cols-[7rem_1fr] items-center gap-3 border-t border-[#8e5a31]/35 p-2.5">{source ? <img alt={`${label} exact submitted source`} className="aspect-[3/2] w-full border border-[#8e5a31]/35 object-cover" src={source.url} /> : <div className="grid aspect-[3/2] place-items-center border border-[#8e5a31]/25"><Camera className="h-3.5 w-3.5 text-[#574d45]" /></div>}<p className="text-[0.56rem] leading-4 text-[#756a60]"><strong className="block uppercase tracking-[0.09em] text-[#a99a8d]">Exact submitted source</strong>Camera and geometry are locked to this canonical reference; only materials, shallow elevation treatment, lighting and landscape may change.</p></div></article>; })}</div>
        {renderState.jobs.some((job) => job.failureReason) ? <div className="mt-4 border border-[#c28a2a]/50 bg-[#18140b] p-4 text-xs leading-5 text-[#d9a856]">{renderState.jobs.filter((job) => job.failureReason).map((job) => <p key={job.id}><strong className="uppercase">{job.purpose ?? "Render"}:</strong> {job.failureReason}</p>)}</div> : null}
      </section> : null}
    </div>
  </main>;
}
