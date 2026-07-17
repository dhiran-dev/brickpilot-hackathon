"use client";

import { motion, useReducedMotion } from "framer-motion";

import { useDeckMotionVariants } from "@/components/deck/motion";
import { SheetFrame } from "@/components/deck/SheetFrame";
import { deckValidationView } from "@/lib/design/deck-content";
import type { DeckPayload, DeckSlideWithSheet } from "@/lib/design/deck";

const ARC_LENGTH = Math.PI * 78; // path length of the M22,100 A78,78 0 0 1 178,100 semicircle

const SEVERITY_STYLE = {
  error: "border-[#e2665a] text-[#e2665a]",
  warning: "border-[#d9a856] text-[#d9a856]",
  info: "border-[#c97940] text-[#c97940]",
} as const;

export function ValidationSlide({ payload, slide }: { payload: DeckPayload; slide: DeckSlideWithSheet }) {
  const { item } = useDeckMotionVariants();
  const reduce = useReducedMotion();
  const view = deckValidationView(payload);
  const offset = ARC_LENGTH * (1 - view.score / 100);

  return (
    <SheetFrame
      payload={payload}
      sheetNumber={slide.sheetNumber}
      sheetTotal={slide.sheetTotal}
      subtitle={`Deterministic rule pack ${view.rulePackVersion} — run against the exact plan geometry, not a visual estimate`}
      title="Validation report"
    >
      <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[19rem_1fr]">
        <motion.div className="flex min-h-0 flex-col justify-center gap-5 border-r border-[#8e5a31]/25 p-8 md:p-10" variants={item}>
          <div className="flex flex-col items-center">
            <svg className="w-full max-w-[210px]" viewBox="0 0 200 150">
              <path d="M 22 100 A 78 78 0 0 1 178 100" fill="none" stroke="#8e5a31" strokeLinecap="round" strokeOpacity="0.28" strokeWidth="7" />
              <motion.path
                animate={{ strokeDashoffset: offset }}
                d="M 22 100 A 78 78 0 0 1 178 100"
                fill="none"
                initial={{ strokeDashoffset: ARC_LENGTH }}
                stroke="#ff4e00"
                strokeDasharray={ARC_LENGTH}
                strokeLinecap="round"
                strokeWidth="7"
                transition={{ duration: reduce ? 0 : 1.1, ease: "easeOut", delay: reduce ? 0 : 0.3 }}
              />
              <text fill="#fff6ea" fontFamily="Iowan Old Style, Palatino, serif" fontSize="42" textAnchor="middle" x="100" y="93">{view.score}</text>
              <text fill="#b5a697" fontFamily="Avenir Next, sans-serif" fontSize="10.5" letterSpacing="1.5" textAnchor="middle" x="100" y="113">OUT OF 100</text>
            </svg>
            <p className="-mt-2 font-[family-name:var(--font-body)] text-[0.6rem] font-bold uppercase tracking-[0.14em] text-[#b5a697]">Validation score</p>
          </div>
          <div className="grid grid-cols-3 gap-px bg-[#8e5a31]/25">
            {([
              ["Errors", view.counts.error, "border-t-[#e2665a]"],
              ["Warnings", view.counts.warning, "border-t-[#d9a856]"],
              ["Info", view.counts.info, "border-t-[#c97940]"],
            ] as const).map(([label, value, borderClass]) => (
              <div className={`border-t-2 bg-[#171512] p-3 text-center ${borderClass}`} key={label}>
                <div className="font-[family-name:var(--font-display)] text-[1.4rem] text-[#fff6ea] [font-variant-numeric:tabular-nums]">{value}</div>
                <div className="mt-0.5 font-[family-name:var(--font-body)] text-[0.52rem] font-bold uppercase tracking-[0.08em] text-[#b5a697]">{label}</div>
              </div>
            ))}
          </div>
          <p className="text-[0.72rem] leading-5 text-[#786d62]">
            A score of 100 means every deterministic check passed. Warnings mark spaces worth a human look before you brief an architect — not failures.
          </p>
        </motion.div>

        <motion.div className="flex min-h-0 flex-col overflow-y-auto" variants={item}>
          <div className="my-auto flex flex-col gap-4 p-8 md:p-10">
          {view.findings.length === 0 ? (
            <>
              <p className="font-[family-name:var(--font-body)] text-[0.6rem] font-bold uppercase tracking-[0.14em] text-[#b5a697]">What was checked</p>
              <div className="grid grid-cols-1 gap-px bg-[#8e5a31]/20 sm:grid-cols-2">
                {view.categories.map((category) => (
                  <div className="flex items-start gap-3 bg-[#171512] p-4" key={category.id}>
                    <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border text-[0.62rem] ${category.worst ? SEVERITY_STYLE[category.worst] : "border-[#38765a] text-[#7bc79e]"}`}>
                      {category.worst ? category.findings : "✓"}
                    </span>
                    <div>
                      <p className="text-[0.84rem] text-[#fff6ea]">{category.label}</p>
                      <p className="mt-0.5 text-[0.72rem] leading-5 text-[#786d62]">{category.blurb}</p>
                    </div>
                  </div>
                ))}
                <div className="flex items-start gap-3 bg-[#171512] p-4">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border border-[#38765a] text-[0.62rem] text-[#7bc79e]">✓</span>
                  <div>
                    <p className="text-[0.84rem] text-[#fff6ea]">No findings</p>
                    <p className="mt-0.5 text-[0.72rem] leading-5 text-[#786d62]">This plan passed every rule with no warnings.</p>
                  </div>
                </div>
              </div>
            </>
          ) : (
            view.findings.map((finding, index) => (
              <div className="flex gap-4 border-b border-[#8e5a31]/15 pb-4" key={`${finding.message}-${index}`}>
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center border font-[family-name:var(--font-display)] text-sm ${SEVERITY_STYLE[finding.severity]}`}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <span className={`border px-2 py-0.5 font-[family-name:var(--font-body)] text-[0.56rem] font-bold uppercase tracking-[0.09em] ${SEVERITY_STYLE[finding.severity]}`}>{finding.severity}</span>
                    <span className="font-[family-name:var(--font-body)] text-[0.6rem] uppercase tracking-[0.08em] text-[#786d62]">{finding.category}</span>
                  </div>
                  <p className="text-[0.86rem] leading-6 text-[#fff6ea]">{finding.message}</p>
                  {finding.action ? <p className="mt-1 text-[0.76rem] leading-5 text-[#b5a697]">Suggested: {finding.action}</p> : null}
                </div>
              </div>
            ))
          )}
          </div>
        </motion.div>
      </div>
    </SheetFrame>
  );
}
