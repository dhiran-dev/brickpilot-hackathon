"use client";

import { motion } from "framer-motion";

import { useDeckMotionVariants } from "@/components/deck/motion";
import type { DeckPayload } from "@/lib/design/deck";

export function RenderSlide({ payload, role, label, sheetLabel }: { payload: DeckPayload; role: string; label: string; sheetLabel: string }) {
  const { container, item } = useDeckMotionVariants();
  const asset = payload.renders.assets.find((candidate) => candidate.role === role);

  return (
    <motion.div animate="show" className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#0a0908]" initial="hidden" variants={container}>
      {asset ? (
        <>
          <img alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl" src={asset.url} />
          <motion.div className="relative flex min-h-0 flex-1 items-center justify-center p-6 md:p-9" variants={item}>
            <img alt={label} className="max-h-full max-w-full object-contain shadow-[0_18px_60px_rgba(0,0,0,0.55)]" src={asset.url} />
          </motion.div>
        </>
      ) : (
        <div className="grid flex-1 place-items-center">
          <span className="font-[family-name:var(--font-body)] text-[0.62rem] font-bold uppercase tracking-[0.12em] text-[#695d53]">
            {label} · {payload.renders.status === "failed" ? "unavailable" : "rendering"}
          </span>
        </div>
      )}

      <motion.div className="pointer-events-none absolute left-0 right-0 top-0 flex items-start justify-between bg-gradient-to-b from-[#090908]/85 to-transparent px-10 pb-10 pt-6 md:px-12" variants={item}>
        <div>
          <p className="font-[family-name:var(--font-body)] text-[0.64rem] font-bold uppercase tracking-[0.18em] text-[#e2a876]">{sheetLabel} — Concept Render</p>
          <h2 className="mt-1.5 font-[family-name:var(--font-display)] text-[1.65rem] leading-tight tracking-[-0.02em] text-[#fff6ea]">{label}</h2>
        </div>
      </motion.div>

      <motion.div className="pointer-events-none absolute bottom-0 left-0 right-0 flex items-center justify-between bg-gradient-to-t from-[#090908]/85 to-transparent px-10 pb-5 pt-10 md:px-12" variants={item}>
        <p className="font-[family-name:var(--font-body)] text-[0.56rem] font-bold uppercase tracking-[0.14em] text-[#cbb59e]">
          Camera-locked to the canonical massing · materials, light and landscape are conceptual
        </p>
        <p className="font-[family-name:var(--font-body)] text-[0.56rem] font-bold uppercase tracking-[0.14em] text-[#8f8275]">{payload.scheme.name}</p>
      </motion.div>
    </motion.div>
  );
}
