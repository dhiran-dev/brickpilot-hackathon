"use client";

import { motion } from "framer-motion";

import { useDeckMotionVariants } from "@/components/deck/motion";
import type { DeckPayload } from "@/lib/design/deck";

export function RationaleSlide({ payload, sheetLabel }: { payload: DeckPayload; sheetLabel: string }) {
  const { container, item } = useDeckMotionVariants();
  const concerns = payload.aiReview?.status === "reviewed" ? payload.aiReview.review.citedConcerns : [];

  return (
    <motion.div animate="show" className="flex flex-1 flex-col" initial="hidden" variants={container}>
      <motion.div className="p-8 pb-0 md:p-10 md:pb-0" variants={item}>
        <p className="font-[family-name:var(--font-body)] text-[0.66rem] font-bold uppercase tracking-[0.16em] text-[#c97940]">{sheetLabel} — Design Rationale</p>
        <h2 className="mt-1 font-[family-name:var(--font-display)] text-2xl text-[#fff6ea]">Why this scheme, in the architect's own reasoning</h2>
      </motion.div>
      <div className="grid flex-1 grid-cols-1 gap-0 md:grid-cols-2">
        <motion.div className="flex flex-col gap-4 p-8 md:p-10" variants={item}>
          <p className="max-w-[62ch] text-[0.95rem] leading-7 text-[#fff6ea]">{payload.scheme.rationale}</p>
          {payload.intentAssumptions.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {payload.intentAssumptions.map((assumption) => (
                <li className="relative pl-4 text-sm leading-6 text-[#b5a697] before:absolute before:left-0 before:content-['—'] before:text-[#c97940]" key={assumption}>{assumption}</li>
              ))}
            </ul>
          ) : null}
        </motion.div>
        <motion.div className="flex flex-col gap-3 border-t border-[#8e5a31]/35 p-8 md:border-l md:border-t-0 md:p-10" variants={item}>
          <h3 className="font-[family-name:var(--font-body)] text-[0.62rem] font-bold uppercase tracking-[0.12em] text-[#c97940]">Evidence considered</h3>
          <ul className="flex flex-col gap-2">
            {(concerns.length > 0 ? concerns.map((concern) => concern.recommendation) : payload.scheme.evidence).map((line) => (
              <li className="relative pl-4 text-sm leading-6 text-[#b5a697] before:absolute before:left-0 before:content-['—'] before:text-[#c97940]" key={line}>{line}</li>
            ))}
          </ul>
        </motion.div>
      </div>
    </motion.div>
  );
}
