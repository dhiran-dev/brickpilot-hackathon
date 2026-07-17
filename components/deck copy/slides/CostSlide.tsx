"use client";

import { motion } from "framer-motion";

import { useDeckMotionVariants } from "@/components/deck/motion";
import { SheetFrame } from "@/components/deck/SheetFrame";
import { deckCostView } from "@/lib/design/deck-content";
import type { DeckPayload, DeckSlideWithSheet } from "@/lib/design/deck";

export function CostSlide({ payload, slide }: { payload: DeckPayload; slide: DeckSlideWithSheet }) {
  const { item } = useDeckMotionVariants();
  const cost = deckCostView(payload);

  if (cost.status === "unavailable") {
    return (
      <SheetFrame payload={payload} sheetNumber={slide.sheetNumber} sheetTotal={slide.sheetTotal} subtitle="Why no band is shown, and how to get one" title="Build cost estimate">
        <motion.div className="flex h-full flex-col justify-center gap-4 p-8 md:p-11" variants={item}>
          <p className="max-w-[60ch] font-[family-name:var(--font-display)] text-[1.3rem] leading-[1.5] text-[#fff6ea]">{cost.reason}</p>
          <ul className="flex flex-col gap-2">
            {cost.actions.map((action) => (
              <li className="relative pl-4 text-[0.84rem] leading-6 text-[#b5a697] before:absolute before:left-0 before:content-['—'] before:text-[#c97940]" key={action}>{action}</li>
            ))}
          </ul>
        </motion.div>
      </SheetFrame>
    );
  }

  const markerX = 60 + cost.bandFraction * 280;

  return (
    <SheetFrame
      payload={payload}
      sheetNumber={slide.sheetNumber}
      sheetTotal={slide.sheetTotal}
      subtitle={`${cost.packName} · ${cost.packVersion} · effective ${cost.effectiveDate}${cost.stale ? " · stale — refresh before budgeting" : ""}`}
      title="Build cost estimate"
    >
      <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[19rem_1fr]">
        <motion.div className="flex min-h-0 flex-col justify-center gap-5 border-r border-[#8e5a31]/25 p-8 md:p-10" variants={item}>
          <span className="inline-flex w-fit items-center gap-2 border border-[#c97940]/50 px-2.5 py-1.5 font-[family-name:var(--font-body)] text-[0.6rem] font-bold uppercase tracking-[0.09em] text-[#c97940]">
            Confidence {cost.confidence} · {cost.match}
          </span>
          <div>
            <div className="font-[family-name:var(--font-display)] text-[2.1rem] leading-tight text-[#fff6ea] [font-variant-numeric:tabular-nums]">{cost.expected}</div>
            <div className="mt-1 font-[family-name:var(--font-body)] text-[0.58rem] font-bold uppercase tracking-[0.1em] text-[#b5a697]">Expected total construction cost</div>
            <div className="mt-0.5 text-[0.72rem] text-[#786d62]">{cost.ratePerM2} of gross floor area</div>
          </div>
          <div>
            <svg className="w-full" viewBox="0 0 400 60">
              <line stroke="#8e5a31" strokeWidth="1.4" x1="60" x2="340" y1="30" y2="30" />
              <line stroke="#8e5a31" strokeWidth="1.4" x1="60" x2="60" y1="22" y2="38" />
              <line stroke="#8e5a31" strokeWidth="1.4" x1="340" x2="340" y1="22" y2="38" />
              <line stroke="#ff4e00" strokeWidth="1.4" x1={markerX} x2={markerX} y1="14" y2="46" />
              <rect fill="#ff4e00" height="9" transform={`rotate(45 ${markerX} 30)`} width="9" x={markerX - 4.5} y="25.5" />
            </svg>
            <div className="mt-1 flex justify-between gap-2">
              <div className="flex flex-col gap-0.5"><span className="font-[family-name:var(--font-body)] text-[0.54rem] font-bold uppercase tracking-[0.08em] text-[#b5a697]">Low</span><span className="text-[0.78rem] text-[#fff6ea] [font-variant-numeric:tabular-nums]">{cost.low}</span></div>
              <div className="flex flex-col gap-0.5"><span className="font-[family-name:var(--font-body)] text-[0.54rem] font-bold uppercase tracking-[0.08em] text-[#b5a697]">Expected</span><span className="text-[0.78rem] text-[#ff4e00] [font-variant-numeric:tabular-nums]">{cost.expected}</span></div>
              <div className="flex flex-col gap-0.5"><span className="font-[family-name:var(--font-body)] text-[0.54rem] font-bold uppercase tracking-[0.08em] text-[#b5a697]">High</span><span className="text-[0.78rem] text-[#fff6ea] [font-variant-numeric:tabular-nums]">{cost.high}</span></div>
            </div>
          </div>
          {cost.improveActions.length > 0 ? (
            <div className="border-t border-[#8e5a31]/25 pt-3">
              <p className="font-[family-name:var(--font-body)] text-[0.54rem] font-bold uppercase tracking-[0.12em] text-[#c97940]">Sharpen this estimate</p>
              {cost.improveActions.slice(0, 3).map((action) => (
                <p className="mt-1.5 text-[0.72rem] leading-5 text-[#b5a697]" key={action}>{action}</p>
              ))}
            </div>
          ) : null}
        </motion.div>

        <motion.div className="flex min-h-0 flex-col overflow-y-auto" variants={item}>
          <div className="my-auto flex flex-col gap-4 p-8 md:p-10">
          <div className="flex flex-col">
            {cost.lines.map((line) => (
              <div className="flex items-baseline gap-3 border-b border-[#8e5a31]/15 py-2" key={line.label}>
                <span className="shrink-0 text-[0.86rem] text-[#fff6ea]">{line.label}</span>
                <span className="mb-1 min-w-0 flex-1 truncate border-b border-dotted border-[#b5a697]/30 pb-0 text-[0.66rem] text-[#786d62]">{line.basis}</span>
                <span className="shrink-0 text-[0.88rem] text-[#fff6ea] [font-variant-numeric:tabular-nums]">{line.amount}</span>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-3 border-t border-[#c97940] pt-3">
              <span className="font-[family-name:var(--font-body)] text-[0.62rem] font-bold uppercase tracking-[0.1em] text-[#b5a697]">Estimated total</span>
              <span className="font-[family-name:var(--font-display)] text-[1.3rem] text-[#fff6ea] [font-variant-numeric:tabular-nums]">{cost.expected}</span>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {([
              ["Included", cost.included],
              ["Not included", cost.excluded],
              ["Assumed", cost.assumptions],
            ] as const).map(([heading, entries]) => (
              <div key={heading}>
                <p className="border-b border-[#8e5a31]/30 pb-1.5 font-[family-name:var(--font-body)] text-[0.54rem] font-bold uppercase tracking-[0.12em] text-[#c97940]">{heading}</p>
                {entries.slice(0, 4).map((entry) => (
                  <p className="mt-1.5 text-[0.7rem] leading-4.5 text-[#b5a697]" key={entry}>{entry}</p>
                ))}
              </div>
            ))}
          </div>
          <p className="text-[0.68rem] italic leading-5 text-[#786d62]">{cost.disclaimer}</p>
          </div>
        </motion.div>
      </div>
    </SheetFrame>
  );
}
