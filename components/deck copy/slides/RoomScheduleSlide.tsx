"use client";

import { motion } from "framer-motion";

import { useDeckMotionVariants } from "@/components/deck/motion";
import { SheetFrame } from "@/components/deck/SheetFrame";
import { deckScheduleView } from "@/lib/design/deck-content";
import type { DeckPayload, DeckSlideWithSheet } from "@/lib/design/deck";

export function RoomScheduleSlide({ payload, slide }: { payload: DeckPayload; slide: DeckSlideWithSheet }) {
  const { item } = useDeckMotionVariants();
  const schedule = deckScheduleView(payload);
  const roomCount = schedule.floors.reduce((sum, floor) => sum + floor.rows.length, 0);

  return (
    <SheetFrame
      payload={payload}
      sheetNumber={slide.sheetNumber}
      sheetTotal={slide.sheetTotal}
      subtitle={`${roomCount} spaces across ${schedule.floors.length} ${schedule.floors.length === 1 ? "floor" : "floors"} — achieved area against the brief's target`}
      title="Room schedule"
    >
      <div className="flex h-full min-h-0 flex-col p-8 md:px-11 md:py-8">
        <motion.div className={`grid min-h-0 flex-1 gap-8 ${schedule.floors.length === 1 ? "grid-cols-2" : schedule.floors.length === 2 ? "grid-cols-2" : "grid-cols-3"}`} variants={item}>
          {schedule.floors.map((floor) => (
            <div className="flex min-h-0 min-w-0 flex-col" key={floor.floorLabel}>
              <div className="flex items-baseline justify-between border-b border-[#c97940]/60 pb-2">
                <h3 className="font-[family-name:var(--font-display)] text-[1.05rem] text-[#fff6ea]">{floor.floorLabel}</h3>
                <span className="font-[family-name:var(--font-body)] text-[0.62rem] font-bold uppercase tracking-[0.1em] text-[#b5a697] [font-variant-numeric:tabular-nums]">{floor.totalM2} m²</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {floor.rows.map((row, index) => (
                  <div className="flex items-baseline justify-between gap-3 border-b border-[#8e5a31]/12 py-[0.42rem]" key={`${row.name}-${index}`}>
                    <span className="truncate text-[0.78rem] text-[#fff6ea]">{row.name}</span>
                    <span className="flex shrink-0 items-baseline gap-1.5 [font-variant-numeric:tabular-nums]">
                      <span className={`text-[0.78rem] ${row.underTarget ? "text-[#d9a856]" : "text-[#b5a697]"}`}>{row.achievedM2}</span>
                      {row.targetM2 ? <span className="text-[0.6rem] text-[#5d534b]">/ {row.targetM2}</span> : null}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </motion.div>

        <motion.div className="mt-5 flex shrink-0 items-center justify-between border-t border-[#8e5a31]/30 pt-3" variants={item}>
          <p className="font-[family-name:var(--font-body)] text-[0.58rem] font-bold uppercase tracking-[0.12em] text-[#786d62]">
            Areas in m² · amber flags a space more than 15% under its target
          </p>
          <p className="text-[0.82rem] text-[#fff6ea] [font-variant-numeric:tabular-nums]">
            Grand total <span className="font-[family-name:var(--font-display)] text-[1.1rem]">{schedule.grandTotalM2} m²</span>
          </p>
        </motion.div>
      </div>
    </SheetFrame>
  );
}
