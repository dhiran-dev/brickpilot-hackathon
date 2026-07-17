"use client";

import { motion } from "framer-motion";

import { useDeckMotionVariants } from "@/components/deck/motion";
import { FooterFact, SlideFooter, SlideHeader, StatCell } from "@/components/deck/slides/chrome";
import { formatCurrencyMinor } from "@/lib/cost/format";
import { deriveQuantityTakeoff } from "@/lib/cost/quantity";
import type { DeckPayload } from "@/lib/design/deck";

export function OverviewSlide({ payload, sheetLabel }: { payload: DeckPayload; sheetLabel: string }) {
  const { container, item } = useDeckMotionVariants();
  const takeoff = deriveQuantityTakeoff(payload.building);
  const builtUpM2 = takeoff.grossFloorAreaMm2 / 1_000_000;
  const bedrooms = payload.requirements.rooms.filter((room) => room.type === "bedroom").length;
  const bathrooms = payload.requirements.rooms.filter((room) => room.type === "bathroom").length;
  const hero = payload.renders.assets.find((asset) => asset.role === "exterior_top")?.url
    ?? payload.renders.assets.find((asset) => asset.role === "exterior_front")?.url;
  const cost = payload.costEstimate.status === "available"
    ? formatCurrencyMinor(payload.costEstimate.total.expectedMinor, payload.costEstimate.currency, payload.costEstimate.locale)
    : "—";

  return (
    <motion.div animate="show" className="flex min-h-0 flex-1 flex-col" initial="hidden" variants={container}>
      <SlideHeader
        eyebrow={`${sheetLabel} — Project Overview`}
        title={payload.scheme.name}
        aside={
          <p className="max-w-[16rem] text-[0.72rem] leading-5 text-[#8f8275]">
            {payload.scheme.partiId.replaceAll("_", " ")} parti · relaxation rung {payload.scheme.ladderRung}
          </p>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 md:grid-cols-[1.05fr_0.95fr]">
        <motion.div className="flex min-h-0 flex-col justify-between gap-6 px-10 py-7 md:px-12" variants={item}>
          <p className="max-w-[58ch] text-[1.02rem] leading-[1.75] text-[#e9dccb]">{payload.scheme.rationale}</p>
          <div className="grid grid-cols-3 gap-x-6 gap-y-6">
            <StatCell label="Built-up area" unit="m²" value={builtUpM2.toFixed(0)} />
            <StatCell label="Plot" value={`${(payload.requirements.site.widthMm / 1000).toFixed(0)}×${(payload.requirements.site.depthMm / 1000).toFixed(0)}`} unit="m" />
            <StatCell label="Floors" value={takeoff.floorCount} />
            <StatCell label="Bed / bath" value={`${bedrooms} / ${bathrooms}`} />
            <StatCell label="Validation" tone={payload.validation.score >= 90 ? "accent" : "default"} value={`${payload.validation.score}`} unit="/ 100" />
            <StatCell label="Expected cost" value={cost} />
          </div>
        </motion.div>

        <motion.div className="flex min-h-0 flex-col gap-5 border-l border-[#8e5a31]/30 py-7 pl-8 pr-10 md:pr-12" variants={item}>
          {hero ? (
            <figure className="relative shrink-0 overflow-hidden border border-[#8e5a31]/45 shadow-[8px_9px_0_rgba(20,18,16,0.82)]">
              <img alt="Concept exterior" className="aspect-[16/10] w-full object-cover" src={hero} />
              <figcaption className="absolute bottom-0 left-0 bg-[#090908]/85 px-3 py-1.5 font-[family-name:var(--font-body)] text-[0.56rem] font-bold uppercase tracking-[0.12em] text-[#d8c9bc]">
                Concept visualization · materials indicative
              </figcaption>
            </figure>
          ) : null}
          <div className="flex min-h-0 flex-col gap-3 overflow-auto">
            <p className="font-[family-name:var(--font-body)] text-[0.58rem] font-bold uppercase tracking-[0.16em] text-[#c97940]">Why this scheme holds up</p>
            {payload.scheme.evidence.slice(0, 4).map((line) => (
              <p className="border-l-2 border-[#c97940]/60 pl-3.5 text-[0.82rem] leading-6 text-[#cbbcab]" key={line}>{line}</p>
            ))}
          </div>
        </motion.div>
      </div>

      <SlideFooter>
        <FooterFact label="Architecture" value={`${payload.requirements.architecture.style.replaceAll("_", " ")} · ${payload.requirements.architecture.formStrategy.replaceAll("_", " ")}`} />
        <FooterFact label="Site" value={`${payload.requirements.site.facing} facing · ${payload.requirements.site.roadEdges.join(" + ")} road`} />
        <FooterFact label="Rooms planned" value={`${payload.requirements.rooms.length} spaces`} />
        <FooterFact label="Finish tier" value={payload.requirements.budget.qualityTier} />
      </SlideFooter>
    </motion.div>
  );
}
