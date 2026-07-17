"use client";

import { motion } from "framer-motion";

import { useDeckMotionVariants } from "@/components/deck/motion";
import { deckDate } from "@/lib/design/deck-content";
import type { DeckPayload } from "@/lib/design/deck";

const NEXT_STEPS = [
  { title: "Walk the plan", body: "Take the floor sheets to the family and the plot. Room sizes read differently on the ground than on screen." },
  { title: "Brief a professional", body: "Hand this deck to a licensed architect or contractor. It is a dimensioned starting brief, not a sanction drawing." },
  { title: "Price it properly", body: "Commission a quantity-surveyor estimate from coordinated drawings before budgeting, finance or construction decisions." },
];

export function BackCoverSlide({ payload }: { payload: DeckPayload }) {
  const { container, item } = useDeckMotionVariants();
  return (
    <motion.div animate="show" className="relative flex flex-1 flex-col bg-gradient-to-b from-[#0c0a08] to-[#090807]" initial="hidden" variants={container}>
      <div className="flex flex-1 flex-col items-center justify-center gap-8 p-10">
        <motion.p className="font-[family-name:var(--font-display)] text-[2.6rem] text-[#fff6ea]" variants={item}>BrickPilot</motion.p>
        <motion.div className="h-px w-16 bg-[#c97940]" variants={item} />
        <motion.p className="max-w-lg text-center font-[family-name:var(--font-body)] text-[0.92rem] leading-7 text-[#b5a697]" variants={item}>
          Catch the expensive mistakes on screen, not on the slab. A dimensionally-accurate plan, a validation report and a build-cost band — generated in one sitting.
        </motion.p>
        <motion.div className="mt-2 grid w-full max-w-4xl grid-cols-1 gap-px border border-[#8e5a31]/35 bg-[#8e5a31]/35 sm:grid-cols-3" variants={item}>
          {NEXT_STEPS.map((step, index) => (
            <div className="flex flex-col gap-2 bg-[#0c0b09] p-5" key={step.title}>
              <span className="font-[family-name:var(--font-display)] text-[1.1rem] text-[#c97940] [font-variant-numeric:tabular-nums]">{String(index + 1).padStart(2, "0")}</span>
              <p className="text-[0.88rem] text-[#fff6ea]">{step.title}</p>
              <p className="text-[0.74rem] leading-5 text-[#b5a697]">{step.body}</p>
            </div>
          ))}
        </motion.div>
      </div>
      <motion.div className="flex items-center justify-between gap-6 border-t border-[#8e5a31]/25 px-8 py-3 md:px-11" variants={item}>
        <span className="font-[family-name:var(--font-body)] text-[0.56rem] font-bold uppercase tracking-[0.12em] text-[#786d62]">{payload.title} · {payload.location}</span>
        <span className="font-[family-name:var(--font-body)] text-[0.56rem] uppercase tracking-[0.12em] text-[#5d534b]">
          Generated {deckDate(payload.generatedAt)} · Rule pack {payload.validation.rulePackVersion} · Not for construction
        </span>
      </motion.div>
    </motion.div>
  );
}
