"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BadgeCheck, Download, Info, Maximize2, Minus, Plus, Printer, Scan } from "lucide-react";

import { CadPlan } from "@/components/cad-plan";
import { LayerPanel } from "@/components/cad-workspace/LayerPanel";
import type { Building } from "@/lib/building/schema";
import { buildDrawing } from "@/lib/drawing/build-drawing";
import { DRAWING_PRESETS, visibilityForPreset, type DrawingAppearance, type DrawingFindingInput, type DrawingLayerId, type DrawingPreset, type LayerVisibility } from "@/lib/drawing/schema";

export type CadWorkspaceProps = {
  building: Building;
  projectName?: string;
  findings?: DrawingFindingInput[];
  highlightedObjectIds?: string[];
  initialFloorId?: string;
  storageKey?: string;
  className?: string;
};

type SavedPresentation = { version: 2; appearance: DrawingAppearance; layers: LayerVisibility; preset?: DrawingPreset; floorId?: string };
type ViewportState = { zoom: number; x: number; y: number };

function clampViewport(viewport: ViewportState, bounds: { width: number; depth: number }): ViewportState {
  const zoom = Math.min(3, Math.max(1, Number(viewport.zoom.toFixed(2))));
  const maxX = (bounds.width - bounds.width / zoom) / 2;
  const maxY = (bounds.depth - bounds.depth / zoom) / 2;
  return {
    zoom,
    x: zoom === 1 ? 0 : Math.min(maxX, Math.max(-maxX, viewport.x)),
    y: zoom === 1 ? 0 : Math.min(maxY, Math.max(-maxY, viewport.y)),
  };
}

export function CadWorkspace({ building, projectName = "Residential feasibility study", findings = [], highlightedObjectIds = [], initialFloorId, storageKey, className }: CadWorkspaceProps) {
  const drawing = useMemo(() => buildDrawing(building, { findings }), [building, findings]);
  const [floorId, setFloorId] = useState(initialFloorId ?? drawing.floors[0]?.floorId ?? "");
  const [appearance, setAppearance] = useState<DrawingAppearance>("cad-dark");
  const [layers, setLayers] = useState<LayerVisibility>(() => visibilityForPreset("architectural"));
  const [preset, setPreset] = useState<DrawingPreset | undefined>("architectural");
  const [controlsOpen, setControlsOpen] = useState(true);
  const [loadedStorageKey, setLoadedStorageKey] = useState<string | undefined>(undefined);
  const [viewport, setViewport] = useState<ViewportState>({ zoom: 1, x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; clientX: number; clientY: number; originX: number; originY: number } | null>(null);
  const artifact = drawing.floors.find((floor) => floor.floorId === floorId) ?? drawing.floors[0];

  useEffect(() => {
    if (!storageKey) { setLoadedStorageKey(undefined); return; }
    try {
      const stored = window.localStorage.getItem(`brickpilot:drawing:${storageKey}`);
      if (stored) {
        const saved = JSON.parse(stored) as Partial<SavedPresentation>;
        if (saved.appearance === "cad-dark" || saved.appearance === "paper-light") setAppearance(saved.appearance);
        if (saved.version === 2 && saved.layers) setLayers((current) => ({ ...current, ...saved.layers }));
        if (saved.preset && saved.preset in DRAWING_PRESETS) setPreset(saved.preset);
        if (saved.floorId && drawing.floors.some((floor) => floor.floorId === saved.floorId)) setFloorId(saved.floorId);
      }
    } catch {
      // A corrupt local preference must never prevent the canonical drawing from opening.
    }
    setLoadedStorageKey(storageKey);
  }, [drawing.floors, storageKey]);

  useEffect(() => {
    if (!storageKey || loadedStorageKey !== storageKey) return;
    const saved: SavedPresentation = { version: 2, appearance, layers, preset, floorId };
    window.localStorage.setItem(`brickpilot:drawing:${storageKey}`, JSON.stringify(saved));
  }, [appearance, floorId, layers, loadedStorageKey, preset, storageKey]);

  useEffect(() => {
    setViewport({ zoom: 1, x: 0, y: 0 });
    dragRef.current = null;
  }, [artifact?.floorId]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || !artifact) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const delta = event.deltaY < 0 ? 0.15 : -0.15;
      setViewport((current) => clampViewport({ ...current, zoom: current.zoom + delta }, artifact.viewBox));
    };
    panel.addEventListener("wheel", handleWheel, { passive: false });
    return () => panel.removeEventListener("wheel", handleWheel);
  }, [artifact]);

  function changeLayer(id: DrawingLayerId, visible: boolean) {
    setLayers((current) => ({ ...current, [id]: visible }));
    setPreset(undefined);
  }

  function applyPreset(next: DrawingPreset) {
    setPreset(next);
    setLayers(visibilityForPreset(next));
    setAppearance(DRAWING_PRESETS[next].appearance);
  }

  function setZoom(nextZoom: number) {
    if (!artifact) return;
    setViewport((current) => clampViewport({ ...current, zoom: nextZoom }, artifact.viewBox));
  }

  function fitDrawing() {
    dragRef.current = null;
    setViewport({ zoom: 1, x: 0, y: 0 });
  }

  function serializedSvg() {
    if (!svgRef.current || !artifact) return null;
    const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("viewBox", `${artifact.viewBox.x} ${artifact.viewBox.y} ${artifact.viewBox.width} ${artifact.viewBox.depth}`);
    clone.removeAttribute("class");
    return new XMLSerializer().serializeToString(clone);
  }

  function fileStem() {
    return `${projectName}-${artifact?.floorLabel ?? "floor"}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function exportSvg() {
    const source = serializedSvg();
    if (!source) return;
    const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${fileStem()}.svg`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function printSheet() {
    if (!svgRef.current || !artifact) return;
    const printWindow = window.open("", "_blank", "popup,width=1400,height=1000");
    if (!printWindow) return;
    printWindow.opener = null;
    printWindow.document.title = `${projectName} · ${artifact?.floorLabel ?? "Floor plan"}`;
    const style = printWindow.document.createElement("style");
    style.textContent = "@page{size:A3 portrait;margin:8mm}html,body{margin:0;background:#fff}svg{display:block;width:100%;height:auto;max-height:100vh}";
    printWindow.document.head.appendChild(style);
    const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("viewBox", `${artifact.viewBox.x} ${artifact.viewBox.y} ${artifact.viewBox.width} ${artifact.viewBox.depth}`);
    printWindow.document.body.appendChild(clone);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 100);
  }

  if (!artifact) return <div className="border border-[#ff4e00] bg-[#160d09] p-5 text-sm text-[#fff6ea]">No floor drawing is available for this building.</div>;

  const findingCounts = findings.reduce((counts, finding) => ({ ...counts, [finding.severity]: counts[finding.severity] + 1 }), { error: 0, warning: 0, info: 0 });
  const topologyFindings = findings.filter((finding) => /^(GEOMETRY|CIRCULATION|OPENING|PLANNING_MUST_CONNECT|VERTICAL)/.test(finding.ruleId) && finding.severity !== "info");
  const topologyBlocked = topologyFindings.some((finding) => finding.severity === "error");
  const visibleWidth = artifact.viewBox.width / viewport.zoom;
  const visibleDepth = artifact.viewBox.depth / viewport.zoom;
  const displayViewBox = {
    x: artifact.viewBox.x + (artifact.viewBox.width - visibleWidth) / 2 + viewport.x,
    y: artifact.viewBox.y + (artifact.viewBox.depth - visibleDepth) / 2 + viewport.y,
    width: visibleWidth,
    depth: visibleDepth,
  };
  const layerCounts: Record<DrawingLayerId, number> = {
    site: 2,
    zoning: artifact.rooms.length,
    circulation: artifact.routes.length,
    walls: artifact.walls.length + artifact.columns.length,
    openings: artifact.openings.length,
    furniture: artifact.furniture.length,
    labels: artifact.rooms.length,
    "dimensions-overall": artifact.dimensions.overall.length,
    "dimensions-internal": artifact.dimensions.internal.length,
    validation: artifact.findings.length,
    annotation: 1,
  };

  return (
    <section className={`overflow-hidden border border-[#8e5a31]/60 bg-[#11100e] text-[#fff6ea] shadow-[9px_10px_0_rgba(5,5,4,0.55)] ${className ?? ""}`}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#8e5a31]/50 bg-[#0b0a09] px-4 py-3">
        <div className="min-w-0"><p className="text-[0.61rem] font-extrabold uppercase tracking-[0.15em] text-[#c97940]">Canonical building · {building.algorithmVersion}</p><h2 className="truncate font-[family-name:var(--font-display)] text-2xl tracking-[-0.025em]">{projectName}</h2></div>
        <div className="flex items-center gap-2 text-[0.63rem] font-bold uppercase tracking-[0.1em]">
          {topologyBlocked ? <span className="inline-flex items-center gap-1.5 border border-[#ff5b45]/60 px-2.5 py-1.5 text-[#ff806f]"><AlertTriangle className="h-3 w-3" /> Topology blocked</span> : topologyFindings.length ? <span className="inline-flex items-center gap-1.5 border border-[#c28a2a]/50 px-2.5 py-1.5 text-[#e7b756]"><Info className="h-3 w-3" /> Topology review</span> : <span className="inline-flex items-center gap-1.5 border border-[#38765a]/60 px-2.5 py-1.5 text-[#7bc79e]"><BadgeCheck className="h-3 w-3" /> Topology passed</span>}
          {findingCounts.warning ? <span className="inline-flex items-center gap-1.5 border border-[#c28a2a]/50 px-2.5 py-1.5 text-[#e7b756]"><Info className="h-3 w-3" /> {findingCounts.warning} advisories</span> : null}
          <button className="inline-flex items-center gap-1.5 border border-[#8e5a31]/60 px-2.5 py-1.5 text-[#cdbdab] hover:bg-[#171512] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fff6ea]" onClick={exportSvg} type="button"><Download className="h-3 w-3" /> SVG</button>
          <button className="inline-flex items-center gap-1.5 border border-[#8e5a31]/60 px-2.5 py-1.5 text-[#cdbdab] hover:bg-[#171512] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fff6ea]" onClick={printSheet} type="button"><Printer className="h-3 w-3" /> Print / PDF</button>
          <button aria-expanded={controlsOpen} className="inline-flex items-center gap-1.5 border border-[#8e5a31]/60 px-2.5 py-1.5 text-[#cdbdab] hover:bg-[#171512] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fff6ea] xl:hidden" onClick={() => setControlsOpen((value) => !value)} type="button"><Maximize2 className="h-3 w-3" /> Layers</button>
        </div>
      </header>

      <div className="flex overflow-x-auto border-b border-[#8e5a31]/45 bg-[#0b0a09]" role="tablist" aria-label="Building floors">
        {drawing.floors.map((floor) => <button aria-controls={`cad-floor-${floor.floorId}`} aria-selected={floor.floorId === artifact.floorId} className={`min-w-24 border-r border-[#8e5a31]/35 px-4 py-3 text-[0.67rem] font-extrabold uppercase tracking-[0.12em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#fff6ea] ${floor.floorId === artifact.floorId ? "bg-[#25170f] text-[#ff9a58] shadow-[inset_0_-2px_#ff4e00]" : "text-[#8f8275] hover:bg-[#171512] hover:text-[#fff6ea]"}`} id={`cad-tab-${floor.floorId}`} key={floor.floorId} onClick={() => setFloorId(floor.floorId)} role="tab" type="button"><span className="block">{floor.floorLabel}</span><span className="mt-0.5 block text-[0.54rem] font-medium text-[#74685d]">Level {floor.floorLevel}</span></button>)}
        <span className="ml-auto hidden shrink-0 items-center px-4 text-[0.58rem] font-bold uppercase tracking-[0.1em] text-[#74685d] sm:flex">Theme + layers apply to every floor</span>
      </div>

      {topologyFindings.length ? <div className={`border-b px-4 py-3 ${topologyBlocked ? "border-[#ff5b45]/45 bg-[#1b0d09]" : "border-[#c28a2a]/40 bg-[#18140b]"}`} role="alert">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl"><p className={`text-[0.64rem] font-bold uppercase tracking-[0.13em] ${topologyBlocked ? "text-[#ff806f]" : "text-[#e7b756]"}`}>{topologyBlocked ? "Generation is not architecturally usable yet" : "Topology needs review before acceptance"}</p><p className="mt-1 text-xs leading-5 text-[#b9aa9a]">{topologyBlocked ? "Correct the requirements below and regenerate. The plan must not be used while a hard topology rule is failing." : "The plan was generated, but these conditions need correction or professional concurrence before you accept it."}</p></div>
          <p className="max-w-xl text-[0.67rem] leading-5 text-[#8f8275]">Typical corrections: reduce the room program, enlarge the plot or buildable envelope, adjust floor allocation, or change must-connect preferences.</p>
        </div>
        <ul className="mt-2 grid gap-1 text-xs text-[#d8c8b7] lg:grid-cols-2">{topologyFindings.slice(0, 4).map((finding) => <li className="border-l border-current/35 pl-2" key={`${finding.ruleId}-${finding.objectIds.join("-")}`}><span className="mr-2 font-mono text-[0.62rem] text-[#8f8275]">{finding.ruleId}</span>{finding.message}</li>)}</ul>
      </div> : null}

      <div className="grid xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div
          ref={panelRef}
          className={`relative h-[clamp(26rem,calc(100dvh-17rem),58rem)] min-w-0 touch-none overscroll-contain overflow-hidden p-3 sm:p-5 ${viewport.zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-default"} ${appearance === "cad-dark" ? "bg-[#080807]" : "bg-[#d5d0c7]"}`}
          id={`cad-floor-${artifact.floorId}`}
          role="tabpanel"
          aria-labelledby={`cad-tab-${artifact.floorId}`}
          onDoubleClick={fitDrawing}
          onPointerDown={(event) => {
            if (viewport.zoom === 1 || event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, originX: viewport.x, originY: viewport.y };
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            const panel = panelRef.current;
            if (!panel) return;
            const unitsPerPixelX = (artifact.viewBox.width / viewport.zoom) / panel.clientWidth;
            const unitsPerPixelY = (artifact.viewBox.depth / viewport.zoom) / panel.clientHeight;
            setViewport((current) => clampViewport({ ...current, x: drag.originX - (event.clientX - drag.clientX) * unitsPerPixelX, y: drag.originY - (event.clientY - drag.clientY) * unitsPerPixelY }, artifact.viewBox));
          }}
          onPointerUp={(event) => {
            if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => { dragRef.current = null; }}
        >
          <div className="absolute right-4 top-4 z-10 flex items-center border border-[#8e5a31]/60 bg-[#0b0a09]/95 text-[#cdbdab] shadow-[4px_5px_0_rgba(0,0,0,0.35)]" aria-label="Drawing zoom controls">
            <button aria-label="Zoom out" className="grid h-9 w-9 place-items-center border-r border-[#8e5a31]/45 hover:bg-[#211711] disabled:cursor-not-allowed disabled:opacity-35" disabled={viewport.zoom === 1} onClick={() => setZoom(viewport.zoom - 0.25)} type="button"><Minus className="h-3.5 w-3.5" /></button>
            <span className="min-w-14 px-2 text-center font-mono text-[0.64rem]" aria-live="polite">{Math.round(viewport.zoom * 100)}%</span>
            <button aria-label="Zoom in" className="grid h-9 w-9 place-items-center border-l border-[#8e5a31]/45 hover:bg-[#211711] disabled:cursor-not-allowed disabled:opacity-35" disabled={viewport.zoom === 3} onClick={() => setZoom(viewport.zoom + 0.25)} type="button"><Plus className="h-3.5 w-3.5" /></button>
            <button aria-label="Fit drawing to view" className="inline-flex h-9 items-center gap-1.5 border-l border-[#8e5a31]/45 px-3 text-[0.61rem] font-bold uppercase tracking-[0.08em] hover:bg-[#211711]" onClick={fitDrawing} type="button"><Scan className="h-3.5 w-3.5" /> Fit</button>
          </div>
          <div className="h-full w-full select-none"><CadPlan appearance={appearance} artifact={artifact} className="block h-full w-full drop-shadow-[0_20px_50px_rgba(0,0,0,0.32)]" displayViewBox={displayViewBox} highlightedObjectIds={highlightedObjectIds} layers={layers} projectName={projectName} ref={svgRef} /></div>
        </div>
        <div className={`${controlsOpen ? "block" : "hidden"} border-l border-[#8e5a31]/45 bg-[#0d0c0a] xl:block`}><LayerPanel activePreset={preset} appearance={appearance} floorCount={drawing.floors.length} layerCounts={layerCounts} layers={layers} onAppearanceChange={(next) => { setAppearance(next); setPreset(undefined); }} onLayerChange={changeLayer} onPresetChange={applyPreset} /></div>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[#8e5a31]/45 bg-[#0b0a09] px-4 py-2.5 text-[0.6rem] uppercase tracking-[0.1em] text-[#74685d]"><span>1 SVG unit = 1 canonical mm · geometry unchanged by appearance</span><span>Concept feasibility output · professional verification required</span></footer>
    </section>
  );
}
