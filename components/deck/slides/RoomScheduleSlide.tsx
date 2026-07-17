"use client";

import { motion } from "framer-motion";
import { useMemo } from "react";

import { useDeckMotionVariants } from "@/components/deck/motion";
import { FooterFact, SlideFooter, SlideHeader } from "@/components/deck/slides/chrome";
import { buildDrawing } from "@/lib/drawing/build-drawing";
import type { RoomZone } from "@/lib/drawing/schema";
import type { DeckPayload } from "@/lib/design/deck";

const ZONE_LABEL: Record<RoomZone, string> = {
  social: "Social", private: "Private", kitchen: "Kitchen", wet: "Wet", circulation: "Circulation",
  outdoor: "Outdoor", utility: "Utility", work: "Work", sacred: "Sacred",
};

const ZONE_DOT: Record<RoomZone, string> = {
  social: "bg-[#fff6ea]", private: "bg-[#b5a697]", kitchen: "bg-[#c97940]", wet: "bg-[#c97940]",
  circulation: "bg-[#8e5a31]", outdoor: "bg-[#7bc79e]", utility: "bg-[#8e5a31]", work: "bg-[#b5a697]", sacred: "bg-[#e2a876]",
};

export function RoomScheduleSlide({ payload, sheetLabel }: { payload: DeckPayload; sheetLabel: string }) {
  const { container, item } = useDeckMotionVariants();
  const drawing = useMemo(() => buildDrawing(payload.building, { scheme: { name: payload.scheme.name, partiId: payload.scheme.partiId, style: payload.requirements.architecture.style } }), [payload]);

  const floors = drawing.floors.map((floor) => ({
    label: floor.floorLabel,
    rooms: floor.rooms,
    totalM2: floor.rooms.reduce((sum, room) => sum + room.areaMm2, 0) / 1_000_000,
  }));
  const totalM2 = floors.reduce((sum, floor) => sum + floor.totalM2, 0);
  const zoneTotals = new Map<RoomZone, number>();
  for (const floor of drawing.floors) {
    for (const room of floor.rooms) zoneTotals.set(room.zone, (zoneTotals.get(room.zone) ?? 0) + room.areaMm2 / 1_000_000);
  }
  const zones = [...zoneTotals.entries()].sort((a, b) => b[1] - a[1]);
  const roomCount = floors.reduce((sum, floor) => sum + floor.rooms.length, 0);

  return (
    <motion.div animate="show" className="flex min-h-0 flex-1 flex-col" initial="hidden" variants={container}>
      <SlideHeader
        eyebrow={`${sheetLabel} — Consolidated Room Schedule`}
        title={<>Every space, measured <span className="text-[#8f8275]">· {roomCount} rooms · {totalM2.toFixed(1)} m²</span></>}
      />

      <div className="mt-4 grid min-h-0 flex-1 grid-cols-1 border-t border-[#8e5a31]/30 md:grid-cols-[1fr_15rem]">
        <div className="min-h-0 overflow-auto px-10 py-5 md:px-12">
          {floors.map((floor) => (
            <div className="mb-5 last:mb-0" key={floor.label}>
              <div className="flex items-baseline justify-between border-b border-[#c97940]/50 pb-1.5">
                <p className="font-[family-name:var(--font-body)] text-[0.6rem] font-bold uppercase tracking-[0.16em] text-[#c97940]">{floor.label}</p>
                <p className="text-[0.72rem] text-[#b5a697] [font-variant-numeric:tabular-nums]">{floor.totalM2.toFixed(1)} m² · {floor.rooms.length} rooms</p>
              </div>
              <div className="grid grid-cols-1 gap-x-10 sm:grid-cols-2">
                {floor.rooms.map((room) => (
                  <motion.div className="flex items-center justify-between gap-3 border-b border-[#8e5a31]/12 py-[0.4rem]" key={room.id} variants={item}>
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 ${ZONE_DOT[room.zone]}`} />
                      <span className="truncate text-[0.8rem] text-[#e9dccb]">{room.name}</span>
                      <span className="shrink-0 font-[family-name:var(--font-body)] text-[0.55rem] font-bold uppercase tracking-[0.08em] text-[#786d62]">{ZONE_LABEL[room.zone]}</span>
                    </span>
                    <span className="shrink-0 text-[0.8rem] text-[#fff6ea] [font-variant-numeric:tabular-nums]">{(room.areaMm2 / 1_000_000).toFixed(1)} m²</span>
                  </motion.div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <motion.aside className="flex min-h-0 flex-col gap-4 overflow-auto border-l border-[#8e5a31]/30 bg-[#0c0b09] px-5 py-5" variants={item}>
          <div>
            <h3 className="font-[family-name:var(--font-body)] text-[0.56rem] font-bold uppercase tracking-[0.16em] text-[#c97940]">Area by zone</h3>
            <div className="mt-3 flex flex-col gap-2.5">
              {zones.map(([zone, areaM2]) => (
                <div key={zone}>
                  <div className="flex items-baseline justify-between text-[0.72rem]">
                    <span className="text-[#cbbcab]">{ZONE_LABEL[zone]}</span>
                    <span className="text-[#fff6ea] [font-variant-numeric:tabular-nums]">{areaM2.toFixed(1)} m²</span>
                  </div>
                  <div className="mt-1 h-[3px] w-full bg-[#8e5a31]/20">
                    <div className="h-full bg-[#c97940]" style={{ width: `${Math.max(3, (areaM2 / totalM2) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-auto border-t border-[#8e5a31]/25 pt-3 text-[0.62rem] leading-5 text-[#786d62]">
            Areas are net room polygons from the validated plan geometry, including verandahs and open courts.
          </p>
        </motion.aside>
      </div>

      <SlideFooter>
        <FooterFact label="Largest space" value={(() => { const all = floors.flatMap((f) => f.rooms); const max = all.reduce((a, b) => (a.areaMm2 > b.areaMm2 ? a : b), all[0]); return `${max.name} · ${(max.areaMm2 / 1_000_000).toFixed(1)} m²`; })()} />
        <FooterFact label="Private / social split" value={(() => { const priv = (zoneTotals.get("private") ?? 0) + (zoneTotals.get("wet") ?? 0); const soc = zoneTotals.get("social") ?? 0; return `${Math.round((priv / totalM2) * 100)}% / ${Math.round((soc / totalM2) * 100)}%`; })()} />
        <FooterFact label="Outdoor + courts" value={`${((zoneTotals.get("outdoor") ?? 0)).toFixed(1)} m²`} />
        <FooterFact label="Circulation" value={`${((zoneTotals.get("circulation") ?? 0)).toFixed(1)} m²`} />
      </SlideFooter>
    </motion.div>
  );
}
