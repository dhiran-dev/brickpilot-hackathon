"use client";

import { motion } from "framer-motion";
import { BadgeCheck, CircleAlert } from "lucide-react";

import { useDeckMotionVariants } from "@/components/deck/motion";
import { FooterFact, SlideFooter, SlideHeader } from "@/components/deck/slides/chrome";
import type { DeckPayload } from "@/lib/design/deck";

export function RationaleSlide({ payload, sheetLabel }: { payload: DeckPayload; sheetLabel: string }) {
  const { container, item } = useDeckMotionVariants();
  const review = payload.aiReview?.status === "reviewed" ? payload.aiReview.review : null;
  const concerns = review?.citedConcerns ?? [];

  return (
    <motion.div animate="show" className="flex min-h-0 flex-1 flex-col" initial="hidden" variants={container}>
      <SlideHeader
        eyebrow={`${sheetLabel} — Design Rationale`}
        title="Why this scheme, in the architect's own reasoning"
        aside={review ? (
          <span className={`inline-flex items-center gap-2 border px-2.5 py-1.5 font-[family-name:var(--font-body)] text-[0.6rem] font-bold uppercase tracking-[0.1em] ${review.concurs ? "border-[#38765a]/60 text-[#7bc79e]" : "border-[#d9a856]/60 text-[#d9a856]"}`}>
            {review.concurs ? <BadgeCheck className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}
            AI review · {review.concurs ? "concurs" : "raises concerns"} · {review.confidence}
          </span>
        ) : null}
      />

      <div className="mt-2 grid min-h-0 flex-1 grid-cols-1 gap-0 md:grid-cols-2">
        <motion.div className="flex min-h-0 flex-col gap-6 overflow-auto px-10 py-7 md:px-12" variants={item}>
          <p className="max-w-[56ch] font-[family-name:var(--font-display)] text-[1.35rem] leading-[1.5] tracking-[-0.01em] text-[#e9dccb]">{payload.scheme.rationale}</p>
          {payload.intentAssumptions.length > 0 ? (
            <div>
              <p className="font-[family-name:var(--font-body)] text-[0.58rem] font-bold uppercase tracking-[0.16em] text-[#c97940]">Brief assumptions</p>
              <ul className="mt-3 flex flex-col gap-2.5">
                {payload.intentAssumptions.map((assumption) => (
                  <li className="relative pl-5 text-[0.82rem] leading-6 text-[#a99a8d] before:absolute before:left-0 before:content-['—'] before:text-[#c97940]" key={assumption}>{assumption}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </motion.div>

        <motion.div className="flex min-h-0 flex-col gap-3 overflow-auto border-l border-[#8e5a31]/30 px-10 py-7 md:px-12" variants={item}>
          <p className="font-[family-name:var(--font-body)] text-[0.58rem] font-bold uppercase tracking-[0.16em] text-[#c97940]">
            {concerns.length > 0 ? "What to watch, and what it saves" : "Evidence considered"}
          </p>
          {concerns.length > 0 ? (
            <div className="flex flex-col gap-4">
              {concerns.slice(0, 4).map((concern, index) => (
                <div className="border-l-2 border-[#c97940]/60 pl-4" key={`${concern.topic}-${index}`}>
                  <p className="text-[0.86rem] font-semibold leading-6 text-[#fff6ea]">{concern.whyItMatters}</p>
                  <p className="mt-1 text-[0.78rem] leading-6 text-[#a99a8d]">{concern.recommendation}</p>
                  <p className="mt-1 text-[0.72rem] leading-5 text-[#7bc79e]">What it saves: {concern.whatItSaves}</p>
                </div>
              ))}
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {payload.scheme.evidence.map((line) => (
                <li className="relative pl-5 text-[0.84rem] leading-6 text-[#a99a8d] before:absolute before:left-0 before:content-['—'] before:text-[#c97940]" key={line}>{line}</li>
              ))}
            </ul>
          )}
        </motion.div>
      </div>

      <SlideFooter>
        <FooterFact label="Parti" value={payload.scheme.partiId.replaceAll("_", " ")} />
        <FooterFact label="Relaxation rung" value={`Rung ${payload.scheme.ladderRung} · deterministic ladder`} />
        <FooterFact label="Status" value="Advisory concept review — not licensed-architect approval" />
      </SlideFooter>
    </motion.div>
  );
}
