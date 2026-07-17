"use client";

import { motion } from "framer-motion";

import { useDeckMotionVariants } from "@/components/deck/motion";
import { deriveQuantityTakeoff } from "@/lib/cost/quantity";
import type { DeckPayload } from "@/lib/design/deck";

export function OverviewSlide({ payload, sheetLabel }: { payload: DeckPayload; sheetLabel: string }) {
  const { container, item } = useDeckMotionVariants();
  const takeoff = deriveQuantityTakeoff(payload.building);
  const builtUpM2 = (takeoff.grossFloorAreaMm2 / 1_000_000).toFixed(1);

  return (
    <motion.div animate="show" className="flex min-h-0 flex-1 flex-col" initial="hidden" variants={container}>
      <motion.div className="p-8 pb-0 md:p-12 md:pb-0" variants={item}>
        <p className="font-[family-name:var(--font-body)] text-[0.66rem] font-bold uppercase tracking-[0.16em] text-[#c97940]">{sheetLabel} — Project Overview</p>
        <h2 className="mt-2 max-w-2xl font-[family-name:var(--font-display)] text-3xl leading-tight tracking-[-0.02em] text-[#fff6ea] [text-wrap:balance] md:text-4xl">
          {payload.scheme.name}
        </h2>
      </motion.div>
      <div className="grid flex-1 grid-cols-1 md:grid-cols-[1.1fr_0.9fr]">
        <motion.div className="flex flex-col justify-center gap-5 border-r border-[#8e5a31]/35 p-8 md:p-12" variants={item}>
          <p className="max-w-[62ch] text-[0.98rem] leading-7 text-[#fff6ea]">{payload.scheme.rationale}</p>
          <div className="grid grid-cols-2 gap-px bg-[#8e5a31]/30">
            {[
              ["Built-up area", `${builtUpM2} m²`],
              ["Bedrooms", String(payload.requirements.rooms.filter((room) => room.type === "bedroom").length)],
              ["Floors", `${takeoff.floorCount}`],
              ["Validation score", `${payload.validation.score} / 100`],
            ].map(([label, value]) => (
              <div className="bg-[#171512] p-4" key={label}>
                <div className="font-[family-name:var(--font-body)] text-[0.6rem] font-bold uppercase tracking-[0.1em] text-[#b5a697]">{label}</div>
                <div className="mt-1 font-[family-name:var(--font-display)] text-2xl text-[#fff6ea]">{value}</div>
              </div>
            ))}
          </div>
        </motion.div>
        <motion.div className="flex flex-col justify-center gap-3 p-8 md:p-12" variants={item}>
          {payload.scheme.evidence.slice(0, 4).map((line) => (
            <p className="border-l border-[#8e5a31]/50 pl-3 text-sm leading-6 text-[#b5a697]" key={line}>{line}</p>
          ))}
        </motion.div>
      </div>
    </motion.div>
  );
}
