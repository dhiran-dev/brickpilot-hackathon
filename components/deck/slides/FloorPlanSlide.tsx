"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useMemo } from "react";

import { useDeckMotionVariants } from "@/components/deck/motion";
import { CadPlan } from "@/components/cad-plan/CadPlan";
import { areaLabel } from "@/lib/drawing/build-drawing";
import { buildDrawing } from "@/lib/drawing/build-drawing";
import { visibilityForPreset } from "@/lib/drawing/schema";
import type { DeckPayload } from "@/lib/design/deck";

export function FloorPlanSlide({ payload, floorId, sheetLabel }: { payload: DeckPayload; floorId: string; sheetLabel: string }) {
  const { container, item } = useDeckMotionVariants();
  const reduce = useReducedMotion();
  const drawing = useMemo(() => buildDrawing(payload.building, { scheme: { name: payload.scheme.name, partiId: payload.scheme.partiId, style: payload.requirements.architecture.style } }), [payload]);
  const artifact = drawing.floors.find((floor) => floor.floorId === floorId) ?? drawing.floors[0];
  const layers = useMemo(() => visibilityForPreset("presentation"), []);

  const totalAchievedM2 = artifact.rooms.reduce((sum, room) => sum + room.areaMm2, 0) / 1_000_000;
  const envelopeM2 = (artifact.envelope.width * artifact.envelope.depth) / 1_000_000;
  const efficiency = totalAchievedM2 > 0 && envelopeM2 > 0 ? Math.round((totalAchievedM2 / envelopeM2) * 100) : 0;
  const roomCount = artifact.rooms.length;
  const wallCount = artifact.walls.length;
  const openingCount = artifact.openings.length;

  return (
    <motion.div animate="show" className="flex min-h-0 flex-1 flex-col" initial="hidden" variants={container}>
      <motion.div className="shrink-0 p-6 pb-2 md:p-8 md:pb-3" variants={item}>
        <p className="font-[family-name:var(--font-body)] text-[0.66rem] font-bold uppercase tracking-[0.16em] text-[#c97940]">{sheetLabel} — Vector Floor Plan</p>
        <h2 className="mt-1 font-[family-name:var(--font-display)] text-2xl text-[#fff6ea]">{artifact.floorLabel} <span className="text-[#786d62]">·</span> <span className="text-[#b5a697]">{roomCount} rooms</span></h2>
      </motion.div>
      <div className="grid min-h-0 flex-1 grid-cols-1 border-t border-[#8e5a31]/35 md:grid-cols-[1fr_19rem]">
        <motion.div
          animate={{ opacity: 1 }}
          className="min-h-0 bg-[#090908]"
          initial={{ opacity: 0 }}
          transition={{ duration: reduce ? 0.2 : 0.6, delay: reduce ? 0 : 0.2, ease: "easeOut" }}
          variants={item}
        >
          <CadPlan artifact={artifact} appearance="cad-dark" className="h-full w-full" layers={layers} projectName={payload.title} />
        </motion.div>

        <motion.aside className="flex min-h-0 flex-col overflow-hidden border-l border-[#8e5a31]/35 bg-[#0c0b09]" variants={item}>
          <div className="flex items-baseline justify-between px-5 pb-3 pt-4">
            <div className="flex items-baseline gap-1.5">
              <span className="font-[family-name:var(--font-display)] text-3xl leading-none text-[#fff6ea] [font-variant-numeric:tabular-nums]">{totalAchievedM2.toFixed(1)}</span>
              <span className="text-[0.8rem] text-[#b5a697]">m²</span>
            </div>
            <span className="font-[family-name:var(--font-body)] text-[0.52rem] uppercase tracking-[0.08em] text-[#786d62] [font-variant-numeric:tabular-nums]">{efficiency}% eff</span>
          </div>

          <div className="grid grid-cols-3 gap-px border-y border-[#8e5a31]/25 bg-[#8e5a31]/25">
            {[["Rooms", roomCount], ["Walls", wallCount], ["Doors", openingCount]].map(([label, value]) => (
              <div className="bg-[#0c0b09] px-3 py-2" key={label as string}>
                <div className="font-[family-name:var(--font-display)] text-lg leading-tight text-[#fff6ea] [font-variant-numeric:tabular-nums]">{value}</div>
                <div className="font-[family-name:var(--font-body)] text-[0.5rem] font-bold uppercase tracking-[0.07em] text-[#786d62]">{label}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-col px-5 pt-3">
            <h3 className="font-[family-name:var(--font-body)] text-[0.54rem] font-bold uppercase tracking-[0.14em] text-[#c97940]">Area Schedule</h3>
            <div className="mt-1.5 flex flex-col">
              {artifact.areaSchedule.map((row) => (
                <div className="flex items-center justify-between gap-2 border-b border-[#8e5a31]/10 py-1" key={row.ref}>
                  <span className="truncate text-[0.76rem] text-[#fff6ea]">{row.name}</span>
                  <div className="flex shrink-0 items-baseline gap-1 [font-variant-numeric:tabular-nums]">
                    <span className={`text-[0.76rem] ${row.underTarget ? "text-[#d9a856]" : "text-[#fff6ea]"}`}>{areaLabel(row.achievedAreaMm2)}</span>
                    {row.targetAreaMm2 ? <span className="text-[0.6rem] text-[#5d534b]">/ {areaLabel(row.targetAreaMm2)}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {artifact.dimensions.overall.length > 0 ? (
            <div className="flex flex-col px-5 pt-3">
              <h3 className="font-[family-name:var(--font-body)] text-[0.54rem] font-bold uppercase tracking-[0.14em] text-[#c97940]">Dimensions</h3>
              <div className="mt-1.5 flex flex-col gap-1">
                {artifact.dimensions.overall.map((dim) => (
                  <div className="flex items-center gap-2" key={dim.id}>
                    <span className="w-16 font-[family-name:var(--font-body)] text-[0.54rem] uppercase tracking-[0.06em] text-[#786d62]">{dim.orientation}</span>
                    <span className="mb-0.5 flex-1 border-b border-dotted border-[#5d534b]/50" />
                    <span className="text-[0.76rem] text-[#fff6ea] [font-variant-numeric:tabular-nums]">{dim.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-auto px-5 pb-2 pt-2">
            <p className="font-[family-name:var(--font-body)] text-[0.5rem] uppercase tracking-[0.08em] text-[#5d534b]">{(artifact.envelope.width / 1000).toFixed(1)}×{(artifact.envelope.depth / 1000).toFixed(1)} m plate · Seed {artifact.metadata.seed}</p>
          </div>
        </motion.aside>
      </div>
    </motion.div>
  );
}
