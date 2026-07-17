"use client";

import { motion } from "framer-motion";

import { useDeckMotionVariants } from "@/components/deck/motion";
import { deckDate } from "@/lib/design/deck-content";
import type { DeckPayload, DeckSlideWithSheet } from "@/lib/design/deck";

const ROLE_GUIDANCE: Record<string, string> = {
  exterior_front: "Street presence — entry, massing and how the house meets the road.",
  exterior_collage: "Four angles in one plate — read the form as a whole before the details.",
  exterior_top: "The roofscape and court — how the plan breathes from above.",
  interior: "The furnished living space — light, proportion and material mood.",
};

/** Full-bleed concept render with a drafting caption plate. */
export function RenderSlide({ payload, slide, role, label }: { payload: DeckPayload; slide: DeckSlideWithSheet; role: string; label: string }) {
  const { container, item } = useDeckMotionVariants();
  const asset = payload.renders.assets.find((candidate) => candidate.role === role);
  const sheet = String(slide.sheetNumber).padStart(2, "0");

  return (
    <motion.div animate="show" className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#0b0a09]" initial="hidden" variants={container}>
      {asset ? (
        <motion.img
          alt={label}
          className="absolute inset-0 h-full w-full object-cover"
          initial={false}
          src={asset.url}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center">
          <span className="font-[family-name:var(--font-body)] text-[0.62rem] font-bold uppercase tracking-[0.12em] text-[#695d53]">
            {label} · {payload.renders.status === "failed" ? "unavailable" : "rendering"}
          </span>
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-[#090807]/95 via-[#090807]/40 to-transparent" />

      <motion.div className="relative z-10 mt-auto flex items-end justify-between gap-6 p-8 md:p-10" variants={item}>
        <div className="flex items-baseline gap-5">
          <span className="font-[family-name:var(--font-display)] text-[1.65rem] leading-none text-[#c97940] [font-variant-numeric:tabular-nums]">{sheet}</span>
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-[1.55rem] leading-tight tracking-[-0.015em] text-[#fff6ea]">{label}</h2>
            <p className="mt-0.5 text-[0.74rem] leading-5 text-[#b5a697]">{ROLE_GUIDANCE[role] ?? "Concept render."}</p>
          </div>
        </div>
        <span className="shrink-0 font-[family-name:var(--font-body)] text-[0.58rem] font-bold uppercase tracking-[0.14em] text-[#b5a697] [font-variant-numeric:tabular-nums]">
          {payload.title} · Sheet {sheet} / {slide.sheetTotal} · {deckDate(payload.generatedAt)}
        </span>
      </motion.div>
    </motion.div>
  );
}
