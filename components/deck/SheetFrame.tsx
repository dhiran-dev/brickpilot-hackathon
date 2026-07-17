"use client";

import { motion } from "framer-motion";

import { useDeckMotionVariants } from "@/components/deck/motion";
import { deckDate } from "@/lib/design/deck-content";
import type { DeckPayload } from "@/lib/design/deck";

/**
 * The drafting-sheet frame every content slide shares: a title strip with the
 * sheet number, a quiet footer title block, and a content region between them.
 * Cover, render plates and the back cover opt out — they are full-bleed.
 */
export function SheetFrame({
  payload,
  sheetNumber,
  sheetTotal,
  title,
  subtitle,
  children,
  contentClassName = "",
}: {
  payload: DeckPayload;
  sheetNumber: number;
  sheetTotal: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  contentClassName?: string;
}) {
  const { container, item } = useDeckMotionVariants();
  const sheet = String(sheetNumber).padStart(2, "0");

  return (
    <motion.div animate="show" className="flex min-h-0 flex-1 flex-col" initial="hidden" variants={container}>
      <motion.header className="flex shrink-0 items-end justify-between gap-6 border-b border-[#8e5a31]/30 px-8 pb-4 pt-6 md:px-11" variants={item}>
        <div className="flex min-w-0 items-baseline gap-5">
          <span className="font-[family-name:var(--font-display)] text-[1.65rem] leading-none text-[#c97940] [font-variant-numeric:tabular-nums]">{sheet}</span>
          <div className="min-w-0">
            <h2 className="truncate font-[family-name:var(--font-display)] text-[1.55rem] leading-tight tracking-[-0.015em] text-[#fff6ea]">{title}</h2>
            {subtitle ? <p className="mt-0.5 truncate text-[0.72rem] leading-5 text-[#b5a697]">{subtitle}</p> : null}
          </div>
        </div>
        <span className="shrink-0 font-[family-name:var(--font-body)] text-[0.62rem] font-bold uppercase tracking-[0.14em] text-[#786d62] [font-variant-numeric:tabular-nums]">
          Sheet {sheet} / {sheetTotal}
        </span>
      </motion.header>

      <div className={`min-h-0 flex-1 ${contentClassName}`}>{children}</div>

      <motion.footer className="flex shrink-0 items-center justify-between gap-6 border-t border-[#8e5a31]/25 px-8 py-2.5 md:px-11" variants={item}>
        <span className="truncate font-[family-name:var(--font-body)] text-[0.58rem] font-bold uppercase tracking-[0.12em] text-[#786d62]">{payload.title}</span>
        <span className="hidden shrink-0 font-[family-name:var(--font-body)] text-[0.58rem] uppercase tracking-[0.12em] text-[#5d534b] md:block">Concept design deck · Not for construction</span>
        <span className="shrink-0 font-[family-name:var(--font-body)] text-[0.58rem] uppercase tracking-[0.12em] text-[#786d62]">{payload.location} · {deckDate(payload.generatedAt)}</span>
      </motion.footer>
    </motion.div>
  );
}
