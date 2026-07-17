"use client";

import { motion } from "framer-motion";

import { useDeckMotionVariants } from "@/components/deck/motion";
import { deckCoverView } from "@/lib/design/deck-content";
import type { DeckPayload } from "@/lib/design/deck";

export function CoverSlide({ payload }: { payload: DeckPayload }) {
  const { container, item } = useDeckMotionVariants();
  const cover = deckCoverView(payload);

  return (
    <motion.div animate="show" className="relative flex flex-1 flex-col justify-end overflow-hidden" initial="hidden" variants={container}>
      <div className="absolute inset-0">
        {cover.heroUrl ? (
          <img alt="" className="h-full w-full object-cover opacity-75" src={cover.heroUrl} />
        ) : (
          <div className="h-full w-full bg-gradient-to-b from-[#171310] via-[#100d0a] to-[#090807]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#090807] via-[#090807]/45 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#090807]/70 via-transparent to-transparent" />
      </div>

      <div className="relative z-10 flex flex-col gap-7 p-10 md:p-14">
        <motion.div className="flex items-center gap-3" variants={item}>
          <span className="h-px w-10 bg-[#c97940]" />
          <p className="font-[family-name:var(--font-body)] text-[0.66rem] font-bold uppercase tracking-[0.22em] text-[#c97940]">
            Concept design deck · Residential feasibility study
          </p>
        </motion.div>

        <motion.h1 className="max-w-4xl font-[family-name:var(--font-display)] text-[3.4rem] leading-[0.95] tracking-[-0.03em] text-[#fff6ea] [text-wrap:balance] md:text-[4.6rem]" variants={item}>
          {payload.title}
        </motion.h1>

        <motion.div className="flex flex-wrap items-stretch border-t border-[#8e5a31]/50" variants={item}>
          {cover.facts.map((fact, index) => (
            <div className={`flex flex-col gap-1.5 py-4 pr-8 ${index > 0 ? "border-l border-[#8e5a31]/35 pl-8" : ""}`} key={fact.label}>
              <span className="font-[family-name:var(--font-body)] text-[0.56rem] font-bold uppercase tracking-[0.14em] text-[#b5a697]">{fact.label}</span>
              <span className="text-[0.92rem] text-[#fff6ea]">{fact.value}</span>
            </div>
          ))}
        </motion.div>
      </div>
    </motion.div>
  );
}
