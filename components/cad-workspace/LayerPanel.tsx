"use client";

import { Eye, EyeOff, Layers3, Moon, Sun } from "lucide-react";

import { DRAWING_LAYER_DEFINITIONS, DRAWING_PRESETS, type DrawingAppearance, type DrawingLayerId, type DrawingPreset, type LayerVisibility } from "@/lib/drawing/schema";

export type LayerPanelProps = {
  appearance: DrawingAppearance;
  layers: LayerVisibility;
  activePreset?: DrawingPreset;
  onAppearanceChange: (appearance: DrawingAppearance) => void;
  onLayerChange: (id: DrawingLayerId, visible: boolean) => void;
  onPresetChange: (preset: DrawingPreset) => void;
  floorCount?: number;
  layerCounts?: Partial<Record<DrawingLayerId, number>>;
  compact?: boolean;
};

export function LayerPanel({ appearance, layers, activePreset, onAppearanceChange, onLayerChange, onPresetChange, floorCount = 1, layerCounts = {}, compact = false }: LayerPanelProps) {
  return (
    <section aria-label="Drawing controls" className="border border-[#8e5a31]/55 bg-[#0d0c0a] text-[#fff6ea]">
      <div className="flex items-center justify-between border-b border-[#8e5a31]/45 px-4 py-3">
        <div className="flex items-center gap-2"><Layers3 aria-hidden="true" className="h-4 w-4 text-[#c97940]" /><h2 className="text-[0.68rem] font-extrabold uppercase tracking-[0.14em]">Drawing layers</h2></div>
        <span className="border border-[#8e5a31]/45 px-2 py-1 text-[0.58rem] font-bold uppercase tracking-[0.1em] text-[#c9b9a7]">All {floorCount} {floorCount === 1 ? "floor" : "floors"}</span>
      </div>

      <div className="grid grid-cols-2 border-b border-[#8e5a31]/45 p-2" role="group" aria-label="Drawing appearance">
        <button aria-pressed={appearance === "cad-dark"} className={`flex items-center justify-center gap-2 px-3 py-2.5 text-[0.65rem] font-bold uppercase tracking-[0.11em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fff6ea] ${appearance === "cad-dark" ? "bg-[#fff6ea] text-[#11100e]" : "text-[#b5a697] hover:bg-[#171512] hover:text-[#fff6ea]"}`} onClick={() => onAppearanceChange("cad-dark")} type="button"><Moon className="h-3.5 w-3.5" /> CAD Dark</button>
        <button aria-pressed={appearance === "paper-light"} className={`flex items-center justify-center gap-2 px-3 py-2.5 text-[0.65rem] font-bold uppercase tracking-[0.11em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fff6ea] ${appearance === "paper-light" ? "bg-[#fff6ea] text-[#11100e]" : "text-[#b5a697] hover:bg-[#171512] hover:text-[#fff6ea]"}`} onClick={() => onAppearanceChange("paper-light")} type="button"><Sun className="h-3.5 w-3.5" /> Paper Light</button>
      </div>

      <div className="border-b border-[#8e5a31]/45 p-3">
        <p className="mb-2 px-1 text-[0.6rem] font-bold uppercase tracking-[0.13em] text-[#c97940]">Presets</p>
        <div className="grid grid-cols-2 gap-1.5">
          {(Object.entries(DRAWING_PRESETS) as [DrawingPreset, (typeof DRAWING_PRESETS)[DrawingPreset]][]).map(([id, preset]) => <button aria-pressed={activePreset === id} className={`border px-2 py-2 text-[0.62rem] font-bold uppercase tracking-[0.08em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fff6ea] ${activePreset === id ? "border-[#ff4e00] bg-[#2a160e] text-[#fff6ea]" : "border-[#8e5a31]/35 text-[#9f9183] hover:border-[#c97940] hover:text-[#fff6ea]"}`} key={id} onClick={() => onPresetChange(id)} type="button">{preset.label}</button>)}
        </div>
      </div>

      <div className={compact ? "grid grid-cols-2 p-2" : "p-2"}>
        {DRAWING_LAYER_DEFINITIONS.filter((layer) => layer.id !== "roof").map((layer) => {
          const visible = layers[layer.id];
          const itemCount = layerCounts[layer.id];
          return <button aria-label={`${layer.label}, applies to all floors${itemCount === undefined ? "" : `, ${itemCount} items on current floor`}`} aria-pressed={visible} className={`flex min-h-11 w-full items-center justify-between gap-3 border-b border-[#8e5a31]/25 px-2.5 py-2.5 text-left transition-colors last:border-b-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#fff6ea] ${visible ? "text-[#fff6ea]" : "text-[#9f9183] hover:text-[#d8c9bc]"}`} key={layer.id} onClick={() => onLayerChange(layer.id, !visible)} type="button"><span><span className="block text-[0.8125rem] font-semibold tracking-[0.02em]">{layer.label}</span>{itemCount === undefined ? null : <span className={`mt-0.5 block text-[0.8125rem] uppercase tracking-[0.08em] ${itemCount ? "text-[#9f9183]" : "text-[#c49a7a]"}`}>{itemCount ? `${itemCount} on this floor` : "None on this floor"}</span>}</span><span aria-hidden="true" className={`grid h-6 w-6 shrink-0 place-items-center border ${visible ? "border-[#c97940] bg-[#c97940]/15 text-[#f1b17d]" : "border-[#6e6258] text-[#9f9183]"}`}>{visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}</span></button>;
        })}
      </div>
    </section>
  );
}
