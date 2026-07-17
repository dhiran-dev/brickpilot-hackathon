"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

import { useDeckMotionVariants } from "@/components/deck/motion";

/**
 * Shared chrome for deck content slides: a consistent header (eyebrow + title +
 * optional aside) and a thin fact strip that anchors the bottom of the sheet.
 * Keeps every sheet on one grid so nothing floats in empty space.
 */
export function SlideHeader({ eyebrow, title, aside }: { eyebrow: string; title: ReactNode; aside?: ReactNode }) {
  const { item } = useDeckMotionVariants();
  return (
    <motion.div className="flex shrink-0 items-end justify-between gap-6 px-10 pt-8 md:px-12" variants={item}>
      <div className="min-w-0">
        <p className="font-[family-name:var(--font-body)] text-[0.64rem] font-bold uppercase tracking-[0.18em] text-[#c97940]">{eyebrow}</p>
        <h2 className="mt-2 font-[family-name:var(--font-display)] text-[1.9rem] leading-[1.05] tracking-[-0.02em] text-[#fff6ea] [text-wrap:balance]">{title}</h2>
      </div>
      {aside ? <div className="shrink-0 pb-0.5 text-right">{aside}</div> : null}
    </motion.div>
  );
}

export function SlideFooter({ children }: { children: ReactNode }) {
  const { item } = useDeckMotionVariants();
  return (
    <motion.div className="mt-auto flex shrink-0 items-stretch justify-between gap-6 border-t border-[#8e5a31]/30 px-10 py-3.5 md:px-12" variants={item}>
      {children}
    </motion.div>
  );
}

export function FooterFact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col justify-center gap-0.5">
      <span className="font-[family-name:var(--font-body)] text-[0.55rem] font-bold uppercase tracking-[0.14em] text-[#786d62]">{label}</span>
      <span className="truncate text-[0.8rem] leading-tight text-[#e9dccb]">{value}</span>
    </div>
  );
}

export function StatCell({ label, value, unit, tone = "default" }: { label: string; value: ReactNode; unit?: string; tone?: "default" | "accent" }) {
  return (
    <div className="flex flex-col gap-1.5 border-l border-[#8e5a31]/35 pl-4 first:border-l-0 first:pl-0">
      <span className="font-[family-name:var(--font-body)] text-[0.56rem] font-bold uppercase tracking-[0.14em] text-[#8f8275]">{label}</span>
      <span className={`flex items-baseline gap-1 font-[family-name:var(--font-display)] text-[1.65rem] leading-none [font-variant-numeric:tabular-nums] ${tone === "accent" ? "text-[#ff4e00]" : "text-[#fff6ea]"}`}>
        {value}
        {unit ? <span className="font-[family-name:var(--font-body)] text-[0.72rem] text-[#b5a697]">{unit}</span> : null}
      </span>
    </div>
  );
}
