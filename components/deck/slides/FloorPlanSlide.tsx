"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useMemo } from "react";

import { useDeckMotionVariants } from "@/components/deck/motion";
import { SlideHeader } from "@/components/deck/slides/chrome";
import { CadPlan } from "@/components/cad-plan/CadPlan";
import { areaLabel } from "@/lib/drawing/build-drawing";
import { buildDrawing } from "@/lib/drawing/build-drawing";
import { visibilityForPreset } from "@/lib/drawing/schema";
import { planCropViewBox, type DeckPayload } from "@/lib/design/deck";

export function FloorPlanSlide({ payload, floorId, sheetLabel }: { payload: DeckPayload; floorId: string; sheetLabel: string }) {
  const { container, item } = useDeckMotionVariants();
  const reduce = useReducedMotion();
  const drawing = useMemo(() => buildDrawing(payload.building, { scheme: { name: payload.scheme.name, partiId: payload.scheme.partiId, style: payload.requirements.architecture.style } }), [payload]);
  const artifact = drawing.floors.find((floor) => floor.floorId === floorId) ?? drawing.floors[0];
  const layers = useMemo(() => {
    const preset = visibilityForPreset("presentation");
    return { ...preset, annotation: false };
  }, []);
  const crop = useMemo(() => planCropViewBox(artifact), [artifact]);

  const totalAchievedM2 = artifact.rooms.reduce((sum, room) => sum + room.areaMm2, 0) / 1_000_000;
  const envelopeM2 = (artifact.envelope.width * artifact.envelope.depth) / 1_000_000;
  const efficiency = totalAchievedM2 > 0 && envelopeM2 > 0 ? Math.round((totalAchievedM2 / envelopeM2) * 100) : 0;

  return (
    <motion.div animate="show" className="flex min-h-0 flex-1 flex-col" initial="hidden" variants={container}>
      <SlideHeader
        eyebrow={`${sheetLabel} — Vector Floor Plan`}
        title={<>{artifact.floorLabel} <span className="text-[#8f8275]">· {artifact.rooms.length} rooms · {totalAchievedM2.toFixed(1)} m²</span></>}
        aside={
          <div className="flex items-center gap-5 font-[family-name:var(--font-body)] text-[0.62rem] font-bold uppercase tracking-[0.12em] text-[#8f8275]">
            <span>{efficiency}% plate efficiency</span>
            <span className="text-[#c97940]">{artifact.walls.length} walls · {artifact.openings.length} openings</span>
          </div>
        }
      />

      <div className="mt-4 grid min-h-0 flex-1 grid-cols-1 border-t border-[#8e5a31]/30 md:grid-cols-[1fr_17.5rem]">
        <motion.div
          animate={{ opacity: 1 }}
          className="min-h-0 bg-[#0a0908] p-3"
          initial={{ opacity: 0 }}
          transition={{ duration: reduce ? 0.2 : 0.6, delay: reduce ? 0 : 0.2, ease: "easeOut" }}
        >
          <CadPlan artifact={artifact} appearance="cad-dark" className="h-full w-full" displayViewBox={crop} layers={layers} projectName={payload.title} />
        </motion.div>

        <motion.aside className="flex min-h-0 flex-col overflow-hidden border-l border-[#8e5a31]/30 bg-[#0c0b09]" variants={item}>
          <div className="shrink-0 px-5 pb-3 pt-4">
            <h3 className="font-[family-name:var(--font-body)] text-[0.56rem] font-bold uppercase tracking-[0.16em] text-[#c97940]">Area schedule</h3>
            <p className="mt-1 text-[0.66rem] leading-4 text-[#786d62]">Achieved vs target, per room</p>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-auto px-5">
            {artifact.areaSchedule.map((row) => (
              <div className="flex items-center justify-between gap-2 border-b border-[#8e5a31]/12 py-[0.45rem]" key={row.ref}>
                <span className="truncate text-[0.78rem] text-[#e9dccb]">{row.name}</span>
                <div className="flex shrink-0 items-baseline gap-1.5 [font-variant-numeric:tabular-nums]">
                  <span className={`text-[0.78rem] ${row.underTarget ? "text-[#d9a856]" : "text-[#fff6ea]"}`}>{areaLabel(row.achievedAreaMm2)}</span>
                  {row.targetAreaMm2 ? <span className="text-[0.62rem] text-[#5d534b]">/ {areaLabel(row.targetAreaMm2)}</span> : null}
                </div>
              </div>
            ))}
          </div>

          {artifact.dimensions.overall.length > 0 ? (
            <div className="shrink-0 border-t border-[#8e5a31]/25 px-5 py-3">
              <h3 className="font-[family-name:var(--font-body)] text-[0.56rem] font-bold uppercase tracking-[0.16em] text-[#c97940]">Plate dimensions</h3>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
                {artifact.dimensions.overall.map((dim) => (
                  <div className="flex items-baseline justify-between gap-2" key={dim.id}>
                    <span className="font-[family-name:var(--font-body)] text-[0.54rem] uppercase tracking-[0.08em] text-[#786d62]">{dim.orientation === "horizontal" ? "Width" : "Depth"}</span>
                    <span className="text-[0.78rem] text-[#fff6ea] [font-variant-numeric:tabular-nums]">{dim.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="shrink-0 border-t border-[#8e5a31]/25 px-5 py-2.5">
            <p className="font-[family-name:var(--font-body)] text-[0.52rem] uppercase tracking-[0.1em] text-[#5d534b]">{(artifact.envelope.width / 1000).toFixed(1)}×{(artifact.envelope.depth / 1000).toFixed(1)} m plate · Seed {artifact.metadata.seed}</p>
          </div>
        </motion.aside>
      </div>
    </motion.div>
  );
}
