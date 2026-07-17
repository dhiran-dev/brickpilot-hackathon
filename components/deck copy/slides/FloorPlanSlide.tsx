"use client";

import { motion } from "framer-motion";
import { useMemo } from "react";

import { useDeckMotionVariants } from "@/components/deck/motion";
import { DeckPlan } from "@/components/deck/DeckPlan";
import { SheetFrame } from "@/components/deck/SheetFrame";
import { areaLabel } from "@/lib/drawing/build-drawing";
import { buildDrawing } from "@/lib/drawing/build-drawing";
import type { DeckPayload, DeckSlideWithSheet } from "@/lib/design/deck";

export function FloorPlanSlide({ payload, slide, floorId }: { payload: DeckPayload; slide: DeckSlideWithSheet; floorId: string }) {
  const { item } = useDeckMotionVariants();
  const drawing = useMemo(() => buildDrawing(payload.building, { scheme: { name: payload.scheme.name, partiId: payload.scheme.partiId, style: payload.requirements.architecture.style } }), [payload]);
  const artifact = drawing.floors.find((floor) => floor.floorId === floorId) ?? drawing.floors[0];

  const scheduledM2 = artifact.areaSchedule.reduce((sum, row) => sum + row.achievedAreaMm2, 0) / 1_000_000;
  const envelopeM2 = (artifact.envelope.width * artifact.envelope.depth) / 1_000_000;
  const efficiency = scheduledM2 > 0 && envelopeM2 > 0 ? Math.round((scheduledM2 / envelopeM2) * 100) : 0;
  const doorCount = artifact.openings.filter((opening) => opening.kind === "door").length;
  const windowCount = artifact.openings.filter((opening) => opening.kind === "window").length;

  return (
    <SheetFrame
      payload={payload}
      sheetNumber={slide.sheetNumber}
      sheetTotal={slide.sheetTotal}
      subtitle={`${artifact.rooms.length} rooms · dimensioned vector plan, drawn from the same geometry as the exported PDF`}
      title={`${artifact.floorLabel} plan`}
    >
      <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[1fr_19rem]">
        <motion.div className="min-h-0 bg-[#0b0a09] p-2" variants={item}>
          <DeckPlan artifact={artifact} className="h-full w-full" />
        </motion.div>

        <motion.aside className="flex min-h-0 flex-col overflow-y-auto border-l border-[#8e5a31]/30 bg-[#0c0b09]" variants={item}>
          <div className="flex items-baseline justify-between px-5 pb-3 pt-4">
            <div className="flex items-baseline gap-1.5">
              <span className="font-[family-name:var(--font-display)] text-[1.9rem] leading-none text-[#fff6ea] [font-variant-numeric:tabular-nums]">{scheduledM2.toFixed(1)}</span>
              <span className="text-[0.78rem] text-[#b5a697]">m²</span>
            </div>
            <span className="font-[family-name:var(--font-body)] text-[0.52rem] uppercase tracking-[0.08em] text-[#786d62] [font-variant-numeric:tabular-nums]">{efficiency}% of plate</span>
          </div>

          <div className="grid grid-cols-3 gap-px border-y border-[#8e5a31]/25 bg-[#8e5a31]/25">
            {[["Rooms", artifact.rooms.length], ["Doors", doorCount], ["Windows", windowCount]].map(([label, value]) => (
              <div className="bg-[#0c0b09] px-3 py-2" key={label as string}>
                <div className="font-[family-name:var(--font-display)] text-[1.05rem] leading-tight text-[#fff6ea] [font-variant-numeric:tabular-nums]">{value}</div>
                <div className="font-[family-name:var(--font-body)] text-[0.5rem] font-bold uppercase tracking-[0.07em] text-[#786d62]">{label}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-col px-5 pt-3">
            <h3 className="font-[family-name:var(--font-body)] text-[0.54rem] font-bold uppercase tracking-[0.14em] text-[#c97940]">Area schedule · achieved / target</h3>
            <div className="mt-1.5 flex flex-col">
              {artifact.areaSchedule.map((row) => (
                <div className="flex items-center justify-between gap-2 border-b border-[#8e5a31]/10 py-[0.3rem]" key={row.ref}>
                  <span className="truncate text-[0.74rem] text-[#fff6ea]">{row.name}</span>
                  <div className="flex shrink-0 items-baseline gap-1 [font-variant-numeric:tabular-nums]">
                    <span className={`text-[0.74rem] ${row.underTarget ? "text-[#d9a856]" : "text-[#fff6ea]"}`}>{areaLabel(row.achievedAreaMm2)}</span>
                    {row.targetAreaMm2 ? <span className="text-[0.58rem] text-[#5d534b]">/ {areaLabel(row.targetAreaMm2)}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {artifact.dimensions.overall.length > 0 ? (
            <div className="flex flex-col px-5 pt-3">
              <h3 className="font-[family-name:var(--font-body)] text-[0.54rem] font-bold uppercase tracking-[0.14em] text-[#c97940]">Overall dimensions</h3>
              <div className="mt-1.5 flex flex-col gap-1">
                {artifact.dimensions.overall.map((dim) => (
                  <div className="flex items-baseline gap-2" key={dim.id}>
                    <span className="w-16 shrink-0 font-[family-name:var(--font-body)] text-[0.54rem] uppercase tracking-[0.06em] text-[#786d62]">{dim.orientation}</span>
                    <span className="mb-1 flex-1 border-b border-dotted border-[#5d534b]/50" />
                    <span className="text-[0.74rem] text-[#fff6ea] [font-variant-numeric:tabular-nums]">{dim.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-auto px-5 pb-2 pt-2">
            <p className="font-[family-name:var(--font-body)] text-[0.5rem] uppercase tracking-[0.08em] text-[#5d534b]">
              {(artifact.envelope.width / 1000).toFixed(1)}×{(artifact.envelope.depth / 1000).toFixed(1)} m plate · Seed {artifact.metadata.seed}
            </p>
          </div>
        </motion.aside>
      </div>
    </SheetFrame>
  );
}
