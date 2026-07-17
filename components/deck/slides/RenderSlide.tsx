"use client";

import { motion } from "framer-motion";

import { useDeckMotionVariants } from "@/components/deck/motion";
import type { DeckPayload } from "@/lib/design/deck";

export function RenderSlide({ payload, role, label, sheetLabel }: { payload: DeckPayload; role: string; label: string; sheetLabel: string }) {
  const { container, item } = useDeckMotionVariants();
  const asset = payload.renders.assets.find((candidate) => candidate.role === role);

  return (
    <motion.div animate="show" className="flex min-h-0 flex-1 flex-col" initial="hidden" variants={container}>
      <motion.div className="shrink-0 p-8 pb-4 md:p-10 md:pb-5" variants={item}>
        <p className="font-[family-name:var(--font-body)] text-[0.66rem] font-bold uppercase tracking-[0.16em] text-[#c97940]">{sheetLabel} — Concept Render</p>
        <h2 className="mt-1 font-[family-name:var(--font-display)] text-2xl text-[#fff6ea]">{label}</h2>
      </motion.div>
      <motion.div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden border-t border-[#8e5a31]/35 bg-[#0b0a09]" variants={item}>
        {asset ? (
          <img alt={label} className="max-h-full max-w-full object-contain" src={asset.url} />
        ) : (
          <div className="grid h-full place-items-center">
            <span className="font-[family-name:var(--font-body)] text-[0.62rem] font-bold uppercase tracking-[0.12em] text-[#695d53]">
              {label} · {payload.renders.status === "failed" ? "unavailable" : "rendering"}
            </span>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
