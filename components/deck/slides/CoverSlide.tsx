"use client";

import { motion } from "framer-motion";

import { useDeckMotionVariants } from "@/components/deck/motion";
import type { DeckPayload } from "@/lib/design/deck";

function floorSummary(payload: DeckPayload) {
  const floorCount = payload.building.floors.length;
  return floorCount <= 1 ? "Ground only" : `G+${floorCount - 1}`;
}

export function CoverSlide({ payload }: { payload: DeckPayload }) {
  const { container, item } = useDeckMotionVariants();
  const hero = payload.renders.assets.find((asset) => asset.role === "exterior_front")?.url;

  return (
    <motion.div animate="show" className="relative flex flex-1 flex-col justify-end overflow-hidden" initial="hidden" variants={container}>
      <div className="absolute inset-0">
        {hero ? (
          <img alt="" className="h-full w-full object-cover opacity-70" src={hero} />
        ) : (
          <div className="h-full w-full bg-gradient-to-b from-[#171310] via-[#100d0a] to-[#090807]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#090807] via-[#090807]/55 to-[#090807]/10" />
      </div>
      <div className="relative z-10 flex flex-col gap-6 p-10 md:p-14">
        <motion.p className="font-[family-name:var(--font-body)] text-[0.68rem] font-bold uppercase tracking-[0.22em] text-[#c97940]" variants={item}>
          Concept Design Deck · Residential Feasibility Study
        </motion.p>
        <motion.h1 className="max-w-3xl font-[family-name:var(--font-display)] text-5xl leading-[0.95] tracking-[-0.03em] text-[#fff6ea] [text-wrap:balance] md:text-7xl" variants={item}>
          {payload.title}
        </motion.h1>
        <motion.div className="flex flex-wrap gap-8 border-t border-[#8e5a31]/50 pt-4" variants={item}>
          <div className="flex flex-col gap-1">
            <span className="font-[family-name:var(--font-body)] text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[#b5a697]">Configuration</span>
            <span className="text-[0.95rem] text-[#fff6ea]">{floorSummary(payload)}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-[family-name:var(--font-body)] text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[#b5a697]">Location</span>
            <span className="text-[0.95rem] text-[#fff6ea]">{payload.location}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-[family-name:var(--font-body)] text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[#b5a697]">Plot</span>
            <span className="text-[0.95rem] text-[#fff6ea]">{(payload.requirements.site.widthMm / 1000).toFixed(1)}m × {(payload.requirements.site.depthMm / 1000).toFixed(1)}m · {payload.requirements.site.facing} facing</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-[family-name:var(--font-body)] text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[#b5a697]">Prepared</span>
            <span className="text-[0.95rem] text-[#fff6ea]">{new Date(payload.generatedAt).toLocaleDateString("en-US", { day: "2-digit", month: "long", year: "numeric" })}</span>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
