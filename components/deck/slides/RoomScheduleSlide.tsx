"use client";

import { motion } from "framer-motion";
import { useMemo } from "react";

import { useDeckMotionVariants } from "@/components/deck/motion";
import { buildDrawing } from "@/lib/drawing/build-drawing";
import type { RoomZone } from "@/lib/drawing/schema";
import type { DeckPayload } from "@/lib/design/deck";

const ZONE_LABEL: Record<RoomZone, string> = {
  social: "Social", private: "Private", kitchen: "Wet", wet: "Wet", circulation: "Circulation",
  outdoor: "Outdoor", utility: "Utility", work: "Work", sacred: "Sacred",
};

const ZONE_CLASS: Record<RoomZone, string> = {
  social: "bg-[#fff6ea]/10 text-[#fff6ea]",
  private: "bg-[#b5a697]/15 text-[#b5a697]",
  kitchen: "bg-[#c97940]/20 text-[#c97940]",
  wet: "bg-[#c97940]/20 text-[#c97940]",
  circulation: "bg-[#8e5a31]/20 text-[#8e5a31]",
  outdoor: "bg-[#38765a]/20 text-[#7bc79e]",
  utility: "bg-[#8e5a31]/20 text-[#8e5a31]",
  work: "bg-[#b5a697]/15 text-[#b5a697]",
  sacred: "bg-[#c97940]/20 text-[#c97940]",
};

export function RoomScheduleSlide({ payload, sheetLabel }: { payload: DeckPayload; sheetLabel: string }) {
  const { container, item } = useDeckMotionVariants();
  const drawing = useMemo(() => buildDrawing(payload.building, { scheme: { name: payload.scheme.name, partiId: payload.scheme.partiId, style: payload.requirements.architecture.style } }), [payload]);
  const rows = drawing.floors.flatMap((floor) => floor.rooms.map((room) => ({ ...room, floorLabel: floor.floorLabel })));

  return (
    <motion.div animate="show" className="flex flex-1 flex-col" initial="hidden" variants={container}>
      <motion.div className="p-8 pb-4 md:p-10 md:pb-5" variants={item}>
        <p className="font-[family-name:var(--font-body)] text-[0.66rem] font-bold uppercase tracking-[0.16em] text-[#c97940]">{sheetLabel} — Consolidated Room Schedule</p>
        <h2 className="mt-1 font-[family-name:var(--font-display)] text-2xl text-[#fff6ea]">Every space, both floors, one table</h2>
      </motion.div>
      <div className="flex-1 overflow-auto px-8 pb-8 md:px-10 md:pb-10">
        <table className="w-full min-w-[36rem] border-collapse text-left text-[0.86rem]">
          <thead>
            <tr className="border-b border-[#8e5a31]/50 text-[0.6rem] font-bold uppercase tracking-[0.1em] text-[#b5a697]">
              <th className="px-3 py-2">Room</th>
              <th className="px-3 py-2">Floor</th>
              <th className="px-3 py-2">Zone</th>
              <th className="px-3 py-2 text-right">Area</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((room) => (
              <motion.tr className="border-b border-[#8e5a31]/15 text-[#fff6ea]" key={room.id} variants={item}>
                <td className="px-3 py-2.5">{room.name}</td>
                <td className="px-3 py-2.5 text-[#b5a697]">{room.floorLabel}</td>
                <td className="px-3 py-2.5"><span className={`px-2 py-0.5 font-[family-name:var(--font-body)] text-[0.58rem] font-bold uppercase tracking-[0.06em] ${ZONE_CLASS[room.zone]}`}>{ZONE_LABEL[room.zone]}</span></td>
                <td className="px-3 py-2.5 text-right [font-variant-numeric:tabular-nums]">{(room.areaMm2 / 1_000_000).toFixed(1)} m²</td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
