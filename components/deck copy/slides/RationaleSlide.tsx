"use client";

import { motion } from "framer-motion";

import { useDeckMotionVariants } from "@/components/deck/motion";
import { SheetFrame } from "@/components/deck/SheetFrame";
import { deckReviewView } from "@/lib/design/deck-content";
import type { DeckPayload, DeckSlideWithSheet } from "@/lib/design/deck";

const VERDICT_COPY = {
  concurs: "Architect review · concurs",
  concurs_with_conditions: "Architect review · concurs with conditions",
  unavailable: "Scheme rationale",
} as const;

export function RationaleSlide({ payload, slide }: { payload: DeckPayload; slide: DeckSlideWithSheet }) {
  const { item } = useDeckMotionVariants();
  const review = deckReviewView(payload);
  const rightColumn = review.concerns.length > 0 ? review.concerns : null;

  return (
    <SheetFrame payload={payload} sheetNumber={slide.sheetNumber} sheetTotal={slide.sheetTotal} subtitle="Why this scheme — the parti reasoning, then what an architect would still watch" title="Design rationale">
      <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-2">
        <motion.div className="flex min-h-0 flex-col justify-center gap-5 border-r border-[#8e5a31]/25 p-8 md:p-11" variants={item}>
          <span className="inline-flex w-fit items-center gap-2 border border-[#c97940]/50 px-2.5 py-1.5 font-[family-name:var(--font-body)] text-[0.6rem] font-bold uppercase tracking-[0.09em] text-[#c97940]">
            {VERDICT_COPY[review.verdict]}{review.confidence ? ` · ${review.confidence} confidence` : ""}
          </span>
          <p className="max-w-[56ch] font-[family-name:var(--font-display)] text-[1.2rem] leading-[1.55] text-[#fff6ea] [text-wrap:pretty]">{review.rationale}</p>
          {review.assumptions.length > 0 ? (
            <div>
              <p className="font-[family-name:var(--font-body)] text-[0.58rem] font-bold uppercase tracking-[0.12em] text-[#786d62]">Assumptions made reading the brief</p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {review.assumptions.map((assumption) => (
                  <li className="relative pl-4 text-[0.8rem] leading-6 text-[#b5a697] before:absolute before:left-0 before:content-['—'] before:text-[#c97940]" key={assumption}>{assumption}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </motion.div>

        <motion.div className="flex min-h-0 flex-col overflow-y-auto" variants={item}>
          <div className="my-auto flex flex-col gap-4 p-8 md:p-11">
          {rightColumn ? (
            <>
              <p className="font-[family-name:var(--font-body)] text-[0.6rem] font-bold uppercase tracking-[0.14em] text-[#b5a697]">Worth a human look before detailing</p>
              {rightColumn.map((concern, index) => (
                <div className="flex gap-4 border-b border-[#8e5a31]/15 pb-4 last:border-b-0" key={concern.recommendation}>
                  <span className="shrink-0 font-[family-name:var(--font-display)] text-[1.05rem] text-[#c97940] [font-variant-numeric:tabular-nums]">{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="border border-[#8e5a31]/60 px-2 py-0.5 font-[family-name:var(--font-body)] text-[0.54rem] font-bold uppercase tracking-[0.09em] text-[#b5a697]">{concern.topic}</span>
                    </div>
                    <p className="mt-1.5 text-[0.86rem] leading-6 text-[#fff6ea]">{concern.recommendation}</p>
                    <p className="mt-1 text-[0.74rem] leading-5 text-[#b5a697]">Why it matters: {concern.whyItMatters}</p>
                    <p className="mt-0.5 text-[0.74rem] leading-5 text-[#786d62]">What it saves: {concern.whatItSaves}</p>
                  </div>
                </div>
              ))}
            </>
          ) : (
            <>
              <p className="font-[family-name:var(--font-body)] text-[0.6rem] font-bold uppercase tracking-[0.14em] text-[#b5a697]">Evidence considered</p>
              {review.evidence.map((line, index) => (
                <div className="flex gap-4 border-b border-[#8e5a31]/15 pb-3 last:border-b-0" key={line}>
                  <span className="shrink-0 font-[family-name:var(--font-display)] text-[1.05rem] text-[#c97940] [font-variant-numeric:tabular-nums]">{String(index + 1).padStart(2, "0")}</span>
                  <p className="text-[0.84rem] leading-6 text-[#b5a697]">{line}</p>
                </div>
              ))}
            </>
          )}
          {review.deltas.length > 0 ? (
            <div className="border border-[#8e5a31]/30 bg-[#0c0b09] p-4">
              <p className="font-[family-name:var(--font-body)] text-[0.54rem] font-bold uppercase tracking-[0.12em] text-[#c97940]">Suggested brief changes</p>
              {review.deltas.map((delta) => (
                <p className="mt-1.5 text-[0.74rem] leading-5 text-[#b5a697]" key={delta}>{delta}</p>
              ))}
            </div>
          ) : null}
          </div>
        </motion.div>
      </div>
    </SheetFrame>
  );
}
