"use client";

import { motion } from "framer-motion";

import { useDeckMotionVariants } from "@/components/deck/motion";
import { formatCurrencyMinor } from "@/lib/cost/format";
import type { DeckPayload } from "@/lib/design/deck";

export function CostSlide({ payload, sheetLabel }: { payload: DeckPayload; sheetLabel: string }) {
  const { container, item } = useDeckMotionVariants();
  const { costEstimate } = payload;

  if (costEstimate.status === "unavailable") {
    return (
      <motion.div animate="show" className="flex flex-1 flex-col" initial="hidden" variants={container}>
        <motion.div className="p-8 md:p-10" variants={item}>
          <p className="font-[family-name:var(--font-body)] text-[0.66rem] font-bold uppercase tracking-[0.16em] text-[#c97940]">{sheetLabel} — Build Cost Estimate</p>
          <h2 className="mt-1 font-[family-name:var(--font-display)] text-2xl text-[#fff6ea]">Cost estimate unavailable</h2>
        </motion.div>
        <motion.div className="flex-1 p-8 md:p-10" variants={item}>
          <p className="max-w-[60ch] text-[0.95rem] leading-7 text-[#b5a697]">
            {costEstimate.reason === "unsupported_region" ? "This region does not yet have a supported cost rate pack." : costEstimate.reason === "currency_mismatch" ? "The requested currency does not match any available rate pack." : "No matching rate pack was found for this study."}
          </p>
          <ul className="mt-4 flex flex-col gap-2">
            {costEstimate.improveConfidenceActions.map((action) => (
              <li className="border-l border-[#8e5a31]/50 pl-3 text-sm text-[#b5a697]" key={action}>{action}</li>
            ))}
          </ul>
        </motion.div>
      </motion.div>
    );
  }

  const { total, lineItems, currency, locale, confidence, selection } = costEstimate;
  const range = total.highMinor - total.lowMinor;
  const expectedFraction = range === 0 ? 0.5 : (total.expectedMinor - total.lowMinor) / range;
  const markerX = 60 + expectedFraction * 280;

  return (
    <motion.div animate="show" className="flex flex-1 flex-col" initial="hidden" variants={container}>
      <motion.div className="p-8 pb-0 md:p-10 md:pb-0" variants={item}>
        <p className="font-[family-name:var(--font-body)] text-[0.66rem] font-bold uppercase tracking-[0.16em] text-[#c97940]">{sheetLabel} — Build Cost Estimate</p>
        <h2 className="mt-1 font-[family-name:var(--font-display)] text-2xl text-[#fff6ea]">Regional rate pack, quantity take-off &amp; bands</h2>
      </motion.div>
      <div className="grid flex-1 grid-cols-1 md:grid-cols-[340px_1fr]">
        <motion.div className="flex flex-col gap-6 border-r border-[#8e5a31]/35 p-8 md:p-10" variants={item}>
          <span className="inline-flex w-fit items-center gap-2 border border-[#c97940]/50 px-2.5 py-1.5 font-[family-name:var(--font-body)] text-[0.62rem] font-bold uppercase tracking-[0.09em] text-[#c97940]">
            Confidence {confidence} · {selection.match.replace("_", " ")}
          </span>
          <div>
            <div className="font-[family-name:var(--font-display)] text-4xl text-[#fff6ea]">{formatCurrencyMinor(total.expectedMinor, currency, locale)}</div>
            <div className="mt-1 font-[family-name:var(--font-body)] text-[0.6rem] font-bold uppercase tracking-[0.1em] text-[#b5a697]">Expected total construction cost</div>
          </div>
          <div>
            <svg className="w-full" viewBox="0 0 400 60">
              <line stroke="#8e5a31" strokeWidth="1.4" x1="60" x2="340" y1="30" y2="30" />
              <line stroke="#8e5a31" strokeWidth="1.4" x1="60" x2="60" y1="22" y2="38" />
              <line stroke="#8e5a31" strokeWidth="1.4" x1="340" x2="340" y1="22" y2="38" />
              <line stroke="#ff4e00" strokeWidth="1.4" x1={markerX} x2={markerX} y1="14" y2="46" />
              <rect fill="#ff4e00" height="9" transform={`rotate(45 ${markerX} 30)`} width="9" x={markerX - 4.5} y="25.5" />
            </svg>
            <div className="mt-1 flex justify-between">
              <div className="flex flex-col gap-0.5"><span className="font-[family-name:var(--font-body)] text-[0.56rem] font-bold uppercase tracking-[0.08em] text-[#b5a697]">Low</span><span className="text-[0.82rem] text-[#fff6ea] [font-variant-numeric:tabular-nums]">{formatCurrencyMinor(total.lowMinor, currency, locale)}</span></div>
              <div className="flex flex-col gap-0.5"><span className="font-[family-name:var(--font-body)] text-[0.56rem] font-bold uppercase tracking-[0.08em] text-[#b5a697]">Expected</span><span className="text-[0.82rem] text-[#ff4e00] [font-variant-numeric:tabular-nums]">{formatCurrencyMinor(total.expectedMinor, currency, locale)}</span></div>
              <div className="flex flex-col gap-0.5"><span className="font-[family-name:var(--font-body)] text-[0.56rem] font-bold uppercase tracking-[0.08em] text-[#b5a697]">High</span><span className="text-[0.82rem] text-[#fff6ea] [font-variant-numeric:tabular-nums]">{formatCurrencyMinor(total.highMinor, currency, locale)}</span></div>
            </div>
          </div>
        </motion.div>
        <div className="flex flex-col overflow-auto p-8 md:p-10">
          {lineItems.map((lineItem) => (
            <motion.div className="flex items-baseline gap-3 border-b border-[#8e5a31]/15 py-2.5" key={lineItem.id} variants={item}>
              <span className="shrink-0 text-[0.92rem] text-[#fff6ea]">{lineItem.label}</span>
              <span className="shrink-0 text-[0.7rem] text-[#b5a697]">{lineItem.basis}</span>
              <span className="mb-1 flex-1 border-b border-dotted border-[#b5a697]/35" />
              <span className="shrink-0 text-[0.94rem] text-[#fff6ea] [font-variant-numeric:tabular-nums]">{formatCurrencyMinor(lineItem.amounts.expectedMinor, currency, locale)}</span>
            </motion.div>
          ))}
          <motion.div className="mt-2 flex items-baseline gap-3 border-t border-[#c97940] pt-4" variants={item}>
            <span className="font-[family-name:var(--font-body)] text-[0.68rem] font-bold uppercase tracking-[0.1em] text-[#b5a697]">Estimated total</span>
            <span className="mb-1 flex-1" />
            <span className="font-[family-name:var(--font-display)] text-2xl text-[#fff6ea]">{formatCurrencyMinor(total.expectedMinor, currency, locale)}</span>
          </motion.div>
          <motion.p className="mt-4 text-[0.76rem] italic leading-6 text-[#b5a697]" variants={item}>{costEstimate.disclaimer}</motion.p>
        </div>
      </div>
    </motion.div>
  );
}
