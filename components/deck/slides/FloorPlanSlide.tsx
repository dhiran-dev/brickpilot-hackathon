"use client";

import { motion } from "framer-motion";
import { useMemo } from "react";

import { DrawnFloorPlan } from "@/components/deck/DrawnFloorPlan";
import { useDeckMotionVariants } from "@/components/deck/motion";
import { buildDrawing } from "@/lib/drawing/build-drawing";
import type { DeckPayload } from "@/lib/design/deck";

export function FloorPlanSlide({ payload, floorId, sheetLabel }: { payload: DeckPayload; floorId: string; sheetLabel: string }) {
  const { container, item } = useDeckMotionVariants();
  const drawing = useMemo(() => buildDrawing(payload.building, { scheme: { name: payload.scheme.name, partiId: payload.scheme.partiId, style: payload.requirements.architecture.style } }), [payload]);
  const artifact = drawing.floors.find((floor) => floor.floorId === floorId) ?? drawing.floors[0];

  return (
    <motion.div animate="show" className="flex flex-1 flex-col" initial="hidden" variants={container}>
      <motion.div className="p-8 pb-3 md:p-10 md:pb-4" variants={item}>
        <p className="font-[family-name:var(--font-body)] text-[0.66rem] font-bold uppercase tracking-[0.16em] text-[#c97940]">{sheetLabel} — Vector Floor Plan</p>
        <h2 className="mt-1 font-[family-name:var(--font-display)] text-2xl text-[#fff6ea]">{artifact.floorLabel} · {payload.requirements.rooms.filter((room) => room.floorId === artifact.floorId).length} rooms</h2>
      </motion.div>
      <motion.div className="flex-1 border-t border-[#8e5a31]/35 bg-[#0b0a09]" variants={item}>
        <DrawnFloorPlan artifact={artifact} />
      </motion.div>
    </motion.div>
  );
}
