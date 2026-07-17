"use client";

import { motion } from "framer-motion";

import { useDeckMotionVariants } from "@/components/deck/motion";
import type { DeckPayload } from "@/lib/design/deck";

export function BackCoverSlide({ payload }: { payload: DeckPayload }) {
  const { container, item } = useDeckMotionVariants();
  const hero = payload.renders.assets.find((asset) => asset.role === "exterior_collage")?.url
    ?? payload.renders.assets.find((asset) => asset.role === "exterior_front")?.url;

  return (
    <motion.div animate="show" className="relative flex flex-1 flex-col items-center justify-center gap-6 overflow-hidden p-10 text-center" initial="hidden" variants={container}>
      {hero ? <img alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover opacity-[0.14] blur-sm" src={hero} /> : null}
      <div className="absolute inset-0 bg-gradient-to-b from-[#090807]/60 via-[#090807]/85 to-[#090807]" />
      <motion.p className="relative font-[family-name:var(--font-display)] text-5xl tracking-[-0.02em] text-[#fff6ea]" variants={item}>BrickPilot</motion.p>
      <motion.div className="relative h-px w-20 bg-[#c97940]" variants={item} />
      <motion.p className="relative max-w-lg font-[family-name:var(--font-body)] text-[1rem] leading-8 text-[#cbbcab]" variants={item}>
        Catch the expensive mistakes on screen, not on the slab. A dimensionally-accurate plan, a validation report and a build-cost band — generated in one sitting.
      </motion.p>
      <motion.p className="relative font-[family-name:var(--font-body)] text-[0.72rem] uppercase tracking-[0.12em] text-[#8f8275]" variants={item}>
        {payload.title} · {payload.location}
      </motion.p>
      <motion.p className="absolute bottom-6 font-[family-name:var(--font-body)] text-[0.58rem] font-bold uppercase tracking-[0.14em] text-[#786d62]" variants={item}>
        Generated {new Date(payload.generatedAt).toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" })} · Concept design deck · Not for construction
      </motion.p>
    </motion.div>
  );
}
