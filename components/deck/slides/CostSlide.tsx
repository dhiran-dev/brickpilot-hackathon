"use client";

import { motion } from "framer-motion";

import { useDeckMotionVariants } from "@/components/deck/motion";
import { FooterFact, SlideFooter, SlideHeader } from "@/components/deck/slides/chrome";
import { formatCurrencyMinor } from "@/lib/cost/format";
import type { DeckPayload } from "@/lib/design/deck";

export function CostSlide({ payload, sheetLabel }: { payload: DeckPayload; sheetLabel: string }) {
  const { container, item } = useDeckMotionVariants();
  const { costEstimate } = payload;

  if (costEstimate.status === "unavailable") {
    return (
      <motion.div animate="show" className="flex min-h-0 flex-1 flex-col" initial="hidden" variants={container}>
        <SlideHeader eyebrow={`${sheetLabel} — Build Cost Estimate`} title="Cost estimate unavailable" />
        <motion.div className="flex-1 px-10 py-8 md:px-12" variants={item}>
          <p className="max-w-[60ch] text-[0.95rem] leading-7 text-[#b5a697]">
            {costEstimate.reason === "unsupported_region" ? "This region does not yet have a supported cost rate pack." : costEstimate.reason === "currency_mismatch" ? "The requested currency does not match any available rate pack." : "No matching rate pack was found for this study."}
          </p>
          <ul className="mt-5 flex flex-col gap-2.5">
            {costEstimate.improveConfidenceActions.map((action) => (
              <li className="border-l-2 border-[#c97940]/60 pl-3.5 text-[0.84rem] leading-6 text-[#cbbcab]" key={action}>{action}</li>
            ))}
          </ul>
        </motion.div>
      </motion.div>
    );
  }

  const { total, lineItems, currency, locale, confidence, selection, quantities, included, excluded, sources } = costEstimate;
  const range = total.highMinor - total.lowMinor;
  const expectedFraction = range === 0 ? 0.5 : (total.expectedMinor - total.lowMinor) / range;
  const markerX = 60 + expectedFraction * 280;
  const gfaM2 = quantities.grossFloorAreaMm2 / 1_000_000;
  const perM2 = gfaM2 > 0 ? Math.round(total.expectedMinor / gfaM2) : 0;
  const maxLine = Math.max(...lineItems.map((lineItem) => lineItem.amounts.expectedMinor), 1);

  return (
    <motion.div animate="show" className="flex min-h-0 flex-1 flex-col" initial="hidden" variants={container}>
      <SlideHeader
        eyebrow={`${sheetLabel} — Build Cost Estimate`}
        title="Quantity take-off priced on a regional rate pack"
        aside={
          <span className="inline-flex items-center gap-2 border border-[#c97940]/50 px-2.5 py-1.5 font-[family-name:var(--font-body)] text-[0.6rem] font-bold uppercase tracking-[0.1em] text-[#c97940]">
            Confidence {confidence} · {selection.match.replace("_", " ")}
          </span>
        }
      />

      <div className="mt-2 grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[19.5rem_1fr]">
        <motion.div className="flex flex-col justify-center gap-7 px-10 md:px-10" variants={item}>
          <div>
            <div className="font-[family-name:var(--font-display)] text-[2.6rem] leading-none tracking-[-0.02em] text-[#fff6ea]">{formatCurrencyMinor(total.expectedMinor, currency, locale)}</div>
            <div className="mt-2 font-[family-name:var(--font-body)] text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[#8f8275]">Expected total construction cost</div>
            <div className="mt-3 flex items-baseline gap-2 text-[0.78rem] text-[#b5a697]">
              <span className="font-[family-name:var(--font-display)] text-lg text-[#c97940] [font-variant-numeric:tabular-nums]">{formatCurrencyMinor(perM2, currency, locale)}</span>
              per m² · {gfaM2.toFixed(0)} m² gross floor area
            </div>
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
              <div className="flex flex-col gap-0.5"><span className="font-[family-name:var(--font-body)] text-[0.56rem] font-bold uppercase tracking-[0.08em] text-[#8f8275]">Low</span><span className="text-[0.82rem] text-[#e9dccb] [font-variant-numeric:tabular-nums]">{formatCurrencyMinor(total.lowMinor, currency, locale)}</span></div>
              <div className="flex flex-col gap-0.5 text-center"><span className="font-[family-name:var(--font-body)] text-[0.56rem] font-bold uppercase tracking-[0.08em] text-[#8f8275]">Expected</span><span className="text-[0.82rem] text-[#ff4e00] [font-variant-numeric:tabular-nums]">{formatCurrencyMinor(total.expectedMinor, currency, locale)}</span></div>
              <div className="flex flex-col gap-0.5 text-right"><span className="font-[family-name:var(--font-body)] text-[0.56rem] font-bold uppercase tracking-[0.08em] text-[#8f8275]">High</span><span className="text-[0.82rem] text-[#e9dccb] [font-variant-numeric:tabular-nums]">{formatCurrencyMinor(total.highMinor, currency, locale)}</span></div>
            </div>
          </div>
          <p className="text-[0.68rem] leading-5 text-[#786d62]">{selection.ratePackName} · effective {selection.effectiveDate}{selection.stale ? " · stale, refresh advised" : ""}</p>
        </motion.div>

        <div className="flex min-h-0 flex-col gap-4 overflow-auto border-l border-[#8e5a31]/30 px-10 py-5 md:px-12">
          <div className="flex flex-col gap-1">
            {lineItems.map((lineItem) => (
              <motion.div className="border-b border-[#8e5a31]/12 py-2.5" key={lineItem.id} variants={item}>
                <div className="flex items-baseline gap-3">
                  <span className="text-[0.88rem] text-[#fff6ea]">{lineItem.label}</span>
                  <span className="min-w-0 flex-1 truncate text-[0.68rem] text-[#786d62]">{lineItem.basis}</span>
                  <span className="shrink-0 text-[0.9rem] text-[#fff6ea] [font-variant-numeric:tabular-nums]">{formatCurrencyMinor(lineItem.amounts.expectedMinor, currency, locale)}</span>
                </div>
                <div className="mt-1.5 h-[3px] w-full bg-[#8e5a31]/15">
                  <div className="h-full bg-[#c97940]" style={{ width: `${Math.max(2, (lineItem.amounts.expectedMinor / maxLine) * 100)}%` }} />
                </div>
              </motion.div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-6">
            <motion.div variants={item}>
              <p className="font-[family-name:var(--font-body)] text-[0.56rem] font-bold uppercase tracking-[0.14em] text-[#7bc79e]">Included</p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {included.slice(0, 4).map((line) => <li className="text-[0.72rem] leading-5 text-[#a99a8d]" key={line}>· {line}</li>)}
              </ul>
            </motion.div>
            <motion.div variants={item}>
              <p className="font-[family-name:var(--font-body)] text-[0.56rem] font-bold uppercase tracking-[0.14em] text-[#d9a856]">Excluded</p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {excluded.slice(0, 4).map((line) => <li className="text-[0.72rem] leading-5 text-[#a99a8d]" key={line}>· {line}</li>)}
              </ul>
            </motion.div>
          </div>
        </div>
      </div>

      <SlideFooter>
        <FooterFact label="Basis" value={`${quantities.spaceCount} spaces · ${quantities.doorCount} doors · ${quantities.windowCount} windows measured`} />
        <FooterFact label="Sources" value={sources.slice(0, 2).map((source) => source.publisher).join(" · ") || "Regional rate pack"} />
        <FooterFact label="Scope" value="Feasibility band, not a contractor quotation" />
      </SlideFooter>
    </motion.div>
  );
}
