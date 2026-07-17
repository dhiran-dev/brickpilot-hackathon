"use client";

import { motion } from "framer-motion";

import { useDeckMotionVariants } from "@/components/deck/motion";
import type { DeckPayload } from "@/lib/design/deck";

export function BackCoverSlide({ payload }: { payload: DeckPayload }) {
  const { container, item } = useDeckMotionVariants();
  return (
    <motion.div animate="show" className="relative flex flex-1 flex-col items-center justify-center gap-5 bg-gradient-to-b from-[#0c0a08] to-[#090807] p-10 text-center" initial="hidden" variants={container}>
      <motion.p className="font-[family-name:var(--font-display)] text-4xl text-[#fff6ea]" variants={item}>BrickPilot</motion.p>
      <motion.div className="h-px w-16 bg-[#c97940]" variants={item} />
      <motion.p className="max-w-md font-[family-name:var(--font-body)] text-[0.95rem] leading-7 text-[#b5a697]" variants={item}>
        Catch the expensive mistakes on screen, not on the slab. A dimensionally-accurate plan, a validation report and a build-cost band — generated in one sitting.
      </motion.p>
      <motion.p className="absolute bottom-6 font-[family-name:var(--font-body)] text-[0.6rem] font-bold uppercase tracking-[0.14em] text-[#786d62]" variants={item}>
        Generated {new Date(payload.generatedAt).toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" })} · Concept design deck · Not for construction
      </motion.p>
    </motion.div>
  );
}
