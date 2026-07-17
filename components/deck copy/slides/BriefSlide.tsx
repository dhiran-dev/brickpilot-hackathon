"use client";

import { motion } from "framer-motion";

import { useDeckMotionVariants } from "@/components/deck/motion";
import { SheetFrame } from "@/components/deck/SheetFrame";
import { deckBriefView } from "@/lib/design/deck-content";
import type { DeckPayload, DeckSlideWithSheet } from "@/lib/design/deck";

export function BriefSlide({ payload, slide }: { payload: DeckPayload; slide: DeckSlideWithSheet }) {
  const { item } = useDeckMotionVariants();
  const brief = deckBriefView(payload);

  return (
    <SheetFrame payload={payload} sheetNumber={slide.sheetNumber} sheetTotal={slide.sheetTotal} subtitle="What the household asked for — the inputs every following sheet answers to" title="The brief">
      <div className="grid h-full grid-cols-1 md:grid-cols-[5fr_7fr]">
        <motion.div className="flex min-h-0 flex-col justify-start gap-6 border-r border-[#8e5a31]/25 p-8 pt-9 md:p-11 md:pt-10" variants={item}>
          <dl className="flex flex-col">
            {brief.facts.map((fact) => (
              <div className="flex items-baseline justify-between gap-4 border-b border-[#8e5a31]/15 py-2.5 last:border-b-0" key={fact.label}>
                <dt className="shrink-0 font-[family-name:var(--font-body)] text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[#786d62]">{fact.label}</dt>
                <dd className="text-right text-[0.86rem] text-[#fff6ea]">{fact.value}</dd>
              </div>
            ))}
          </dl>
          <div className="border border-[#8e5a31]/30 bg-[#0c0b09] p-4">
            <p className="font-[family-name:var(--font-body)] text-[0.58rem] font-bold uppercase tracking-[0.14em] text-[#c97940]">Design direction</p>
            <div className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1.5">
              {brief.direction.map((entry) => (
                <p className="text-[0.76rem] text-[#b5a697]" key={entry.label}>
                  <span className="text-[#5d534b]">{entry.label} · </span>{entry.value}
                </p>
              ))}
            </div>
          </div>
        </motion.div>

        <motion.div className="flex min-h-0 flex-col overflow-y-auto" variants={item}>
          <div className="my-auto flex flex-col gap-5 p-8 md:p-11">
          <p className="font-[family-name:var(--font-body)] text-[0.6rem] font-bold uppercase tracking-[0.14em] text-[#b5a697]">
            Rooms requested · {brief.roomsByFloor.reduce((sum, floor) => sum + floor.rooms.length, 0)} spaces
          </p>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {brief.roomsByFloor.map((floor) => (
              <div className="flex min-w-0 flex-col" key={floor.floorLabel}>
                <p className="border-b border-[#c97940]/60 pb-2 font-[family-name:var(--font-display)] text-[1.05rem] text-[#fff6ea]">{floor.floorLabel}</p>
                <dl className="flex flex-col">
                  {floor.rooms.map((room, index) => (
                    <div className="flex items-baseline justify-between gap-3 border-b border-[#8e5a31]/12 py-[0.4rem]" key={`${room.name}-${index}`}>
                      <dt className="truncate text-[0.78rem] text-[#b5a697]">{room.name}</dt>
                      <dd className="shrink-0 text-[0.78rem] text-[#fff6ea] [font-variant-numeric:tabular-nums]">{room.targetM2}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
          </div>
        </motion.div>
      </div>
    </SheetFrame>
  );
}
