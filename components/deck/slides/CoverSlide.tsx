"use client";

import { motion } from "framer-motion";

import { useDeckMotionVariants } from "@/components/deck/motion";
import { deriveQuantityTakeoff } from "@/lib/cost/quantity";
import type { DeckPayload } from "@/lib/design/deck";

function floorSummary(payload: DeckPayload) {
  const floorCount = payload.building.floors.length;
  return floorCount <= 1 ? "Ground only" : `G+${floorCount - 1}`;
}

export function CoverSlide({ payload, sheetTotal }: { payload: DeckPayload; sheetTotal: number }) {
  const { container, item } = useDeckMotionVariants();
  const hero = payload.renders.assets.find((asset) => asset.role === "exterior_front")?.url;
  const builtUpM2 = deriveQuantityTakeoff(payload.building).grossFloorAreaMm2 / 1_000_000;

  return (
    <motion.div animate="show" className="relative flex flex-1 flex-col overflow-hidden" initial="hidden" variants={container}>
      <div className="absolute inset-0">
        {hero ? (
          <img alt="" className="h-full w-full object-cover opacity-75" src={hero} />
        ) : (
          <div className="h-full w-full bg-gradient-to-b from-[#171310] via-[#100d0a] to-[#090807]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#090807] via-[#090807]/60 to-[#090807]/15" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#090807]/55 via-transparent to-transparent" />
      </div>

      <div className="relative z-10 flex items-center justify-between px-10 pt-7 md:px-14">
        <motion.p className="font-[family-name:var(--font-display)] text-xl text-[#fff6ea]" variants={item}>
          BrickPilot
        </motion.p>
        <motion.p className="font-[family-name:var(--font-body)] text-[0.6rem] font-bold uppercase tracking-[0.18em] text-[#d8c9bc]" variants={item}>
          Concept design deck · {String(sheetTotal).padStart(2, "0")} sheets
        </motion.p>
      </div>

      <div className="relative z-10 mt-auto flex flex-col gap-7 px-10 pb-10 md:px-14 md:pb-12">
        <motion.p className="font-[family-name:var(--font-body)] text-[0.66rem] font-bold uppercase tracking-[0.24em] text-[#e2a876]" variants={item}>
          Residential feasibility study · {payload.scheme.name}
        </motion.p>
        <motion.h1 className="max-w-4xl font-[family-name:var(--font-display)] text-6xl leading-[0.95] tracking-[-0.03em] text-[#fff6ea] [text-wrap:balance]" variants={item}>
          {payload.title}
        </motion.h1>
        <motion.div className="grid grid-cols-2 gap-x-10 gap-y-5 border-t border-[#c9b8a6]/25 pt-5 sm:grid-cols-5" variants={item}>
          {[
            ["Configuration", floorSummary(payload)],
            ["Location", payload.location],
            ["Plot", `${(payload.requirements.site.widthMm / 1000).toFixed(1)}m × ${(payload.requirements.site.depthMm / 1000).toFixed(1)}m · ${payload.requirements.site.facing}`],
            ["Built-up", `${builtUpM2.toFixed(0)} m²`],
            ["Prepared", new Date(payload.generatedAt).toLocaleDateString("en-US", { day: "2-digit", month: "long", year: "numeric" })],
          ].map(([label, value]) => (
            <div className="flex min-w-0 flex-col gap-1.5" key={label}>
              <span className="font-[family-name:var(--font-body)] text-[0.56rem] font-bold uppercase tracking-[0.16em] text-[#cbb59e]">{label}</span>
              <span className="truncate text-[0.92rem] text-[#fff6ea]">{value}</span>
            </div>
          ))}
        </motion.div>
      </div>
    </motion.div>
  );
}
