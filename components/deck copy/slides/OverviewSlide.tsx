"use client";

import { motion } from "framer-motion";

import { useDeckMotionVariants } from "@/components/deck/motion";
import { SheetFrame } from "@/components/deck/SheetFrame";
import { deckOverviewView } from "@/lib/design/deck-content";
import type { DeckPayload, DeckSlideWithSheet } from "@/lib/design/deck";

export function OverviewSlide({ payload, slide }: { payload: DeckPayload; slide: DeckSlideWithSheet }) {
  const { item } = useDeckMotionVariants();
  const overview = deckOverviewView(payload);

  return (
    <SheetFrame payload={payload} sheetNumber={slide.sheetNumber} sheetTotal={slide.sheetTotal} subtitle={`${payload.scheme.name} — the selected parti, and why it won`} title="Project overview">
      <div className="grid h-full grid-cols-1 md:grid-cols-[7fr_5fr]">
        <motion.div className="flex min-h-0 flex-col justify-center gap-7 border-r border-[#8e5a31]/25 p-8 md:p-11" variants={item}>
          <p className="max-w-[58ch] font-[family-name:var(--font-display)] text-[1.35rem] leading-[1.5] text-[#fff6ea] [text-wrap:pretty]">{payload.scheme.rationale}</p>
          <div className="flex flex-col">
            {overview.evidence.map((line, index) => (
              <div className="flex gap-4 border-t border-[#8e5a31]/15 py-3 last:border-b" key={line}>
                <span className="shrink-0 font-[family-name:var(--font-display)] text-[0.95rem] text-[#c97940] [font-variant-numeric:tabular-nums]">{String(index + 1).padStart(2, "0")}</span>
                <p className="text-[0.84rem] leading-6 text-[#b5a697]">{line}</p>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div className="flex min-h-0 flex-col justify-center gap-6 p-8 md:p-11" variants={item}>
          <div>
            <p className="font-[family-name:var(--font-body)] text-[0.6rem] font-bold uppercase tracking-[0.14em] text-[#786d62]">Total scheduled area</p>
            <p className="mt-1 font-[family-name:var(--font-display)] text-[3.2rem] leading-none text-[#fff6ea] [font-variant-numeric:tabular-nums]">
              {overview.builtUpM2}<span className="ml-2 text-[1.4rem] text-[#b5a697]">m²</span>
            </p>
          </div>
          <dl className="flex flex-col border-t border-[#8e5a31]/25">
            {overview.stats.map((stat) => (
              <div className="flex items-baseline justify-between gap-4 border-b border-[#8e5a31]/15 py-2" key={stat.label}>
                <dt className="font-[family-name:var(--font-body)] text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[#786d62]">{stat.label}</dt>
                <dd className="text-right text-[0.88rem] text-[#fff6ea] [font-variant-numeric:tabular-nums]">{stat.value}</dd>
              </div>
            ))}
          </dl>
        </motion.div>
      </div>
    </SheetFrame>
  );
}
