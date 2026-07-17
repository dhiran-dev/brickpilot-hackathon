"use client";

import { motion } from "framer-motion";

import { useDeckMotionVariants } from "@/components/deck/motion";
import type { DeckPayload } from "@/lib/design/deck";

const TILES: Array<{ role: string; label: string }> = [
  { role: "exterior_front", label: "Front / road perspective" },
  { role: "exterior_collage", label: "Four-view collage" },
  { role: "exterior_top", label: "High front-right perspective" },
  { role: "interior", label: "Furnished interior concept" },
];

export function RenderGallerySlide({ payload, sheetLabel }: { payload: DeckPayload; sheetLabel: string }) {
  const { container, item } = useDeckMotionVariants();
  const assetsByRole = new Map(payload.renders.assets.map((asset) => [asset.role, asset]));

  return (
    <motion.div animate="show" className="flex flex-1 flex-col" initial="hidden" variants={container}>
      <motion.div className="p-8 pb-4 md:p-10 md:pb-5" variants={item}>
        <p className="font-[family-name:var(--font-body)] text-[0.66rem] font-bold uppercase tracking-[0.16em] text-[#c97940]">{sheetLabel} — Concept Renders</p>
        <h2 className="mt-1 font-[family-name:var(--font-display)] text-2xl text-[#fff6ea]">Camera-locked exterior &amp; interior studies</h2>
      </motion.div>
      <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-px bg-[#8e5a31]/30">
        {TILES.map(({ role, label }) => {
          const asset = assetsByRole.get(role);
          return (
            <motion.div className="relative overflow-hidden bg-[#0b0a09]" key={role} variants={item}>
              {asset ? (
                <img alt={label} className="h-full w-full object-cover" src={asset.url} />
              ) : (
                <div className="grid h-full place-items-center">
                  <span className="font-[family-name:var(--font-body)] text-[0.62rem] font-bold uppercase tracking-[0.12em] text-[#695d53]">
                    {label} · {payload.renders.status === "failed" ? "unavailable" : "rendering"}
                  </span>
                </div>
              )}
              <span className="absolute left-3 top-3 bg-[#090908]/90 px-2 py-1 font-[family-name:var(--font-body)] text-[0.56rem] font-bold uppercase tracking-[0.09em] text-[#fff6ea]">{label}</span>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
