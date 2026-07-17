"use client";

import { motion, useReducedMotion } from "framer-motion";
import { BadgeCheck, Ruler, ShieldCheck } from "lucide-react";

import { useDeckMotionVariants } from "@/components/deck/motion";
import { FooterFact, SlideFooter, SlideHeader } from "@/components/deck/slides/chrome";
import type { DeckPayload } from "@/lib/design/deck";

const ARC_LENGTH = Math.PI * 78; // path length of the M22,100 A78,78 0 0 1 178,100 semicircle

const CHECK_FAMILIES = [
  ["Geometry", "Room polygons, wall alignment and envelope containment verified against the exact plan."],
  ["Egress", "Every occupied room reaches a valid exit path through doors, openings and stairs."],
  ["Topology", "Requested adjacencies and direct connections are honoured in the solved plan."],
  ["Vertical", "Stair core alignment, floor stacking and plate continuity across levels."],
  ["Planning", "Area targets, setbacks, road access and orientation constraints."],
] as const;

export function ValidationSlide({ payload, sheetLabel }: { payload: DeckPayload; sheetLabel: string }) {
  const { container, item } = useDeckMotionVariants();
  const reduce = useReducedMotion();
  const { validation } = payload;
  const offset = ARC_LENGTH * (1 - validation.score / 100);
  const warnings = validation.findings.filter((finding) => finding.severity === "warning");
  const errors = validation.findings.filter((finding) => finding.severity === "error");
  const infos = validation.findings.filter((finding) => finding.severity === "info");
  const ordered = [...errors, ...warnings, ...infos];
  const structural = payload.building.structuralConcept;

  return (
    <motion.div animate="show" className="flex min-h-0 flex-1 flex-col" initial="hidden" variants={container}>
      <SlideHeader
        eyebrow={`${sheetLabel} — Validation Report`}
        title="Deterministic checks against the plan geometry"
        aside={<p className="font-[family-name:var(--font-body)] text-[0.62rem] font-bold uppercase tracking-[0.12em] text-[#8f8275]">Rule pack {validation.rulePackVersion}</p>}
      />

      <div className="mt-2 grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[19rem_1fr]">
        <motion.div className="flex flex-col items-center justify-center gap-6 px-10 md:px-8" variants={item}>
          <div className="relative">
            <svg className="w-full max-w-[200px]" viewBox="0 0 200 150">
              <path d="M 22 100 A 78 78 0 0 1 178 100" fill="none" stroke="#8e5a31" strokeLinecap="round" strokeOpacity="0.28" strokeWidth="7" />
              <motion.path
                animate={{ strokeDashoffset: offset }}
                d="M 22 100 A 78 78 0 0 1 178 100"
                fill="none"
                initial={{ strokeDashoffset: ARC_LENGTH }}
                stroke="#ff4e00"
                strokeDasharray={ARC_LENGTH}
                strokeLinecap="round"
                strokeWidth="7"
                transition={{ duration: reduce ? 0 : 1.1, ease: "easeOut", delay: reduce ? 0 : 0.3 }}
              />
              <text fill="#fff6ea" fontFamily="Iowan Old Style, Palatino, serif" fontSize="42" textAnchor="middle" x="100" y="93">{validation.score}</text>
              <text fill="#b5a697" fontFamily="Avenir Next, sans-serif" fontSize="10.5" letterSpacing="1.5" textAnchor="middle" x="100" y="113">OUT OF 100</text>
            </svg>
          </div>
          <div className="grid w-full grid-cols-3 gap-px bg-[#8e5a31]/25">
            {[
              ["Errors", validation.counts.error, errors.length > 0 ? "text-[#e2665a]" : "text-[#fff6ea]"],
              ["Warnings", validation.counts.warning, warnings.length > 0 ? "text-[#d9a856]" : "text-[#fff6ea]"],
              ["Info", validation.counts.info, "text-[#fff6ea]"],
            ].map(([label, value, valueClass]) => (
              <div className="bg-[#0c0b09] p-3 text-center" key={label as string}>
                <div className={`font-[family-name:var(--font-display)] text-2xl [font-variant-numeric:tabular-nums] ${valueClass}`}>{value}</div>
                <div className="mt-1 font-[family-name:var(--font-body)] text-[0.55rem] font-bold uppercase tracking-[0.1em] text-[#8f8275]">{label}</div>
              </div>
            ))}
          </div>
          {ordered.length === 0 ? (
            <p className="flex items-center gap-2 border border-[#38765a]/50 bg-[#0b1510] px-4 py-2.5 font-[family-name:var(--font-body)] text-[0.62rem] font-bold uppercase tracking-[0.12em] text-[#7bc79e]">
              <BadgeCheck className="h-4 w-4" /> All hard checks pass
            </p>
          ) : null}
        </motion.div>

        <div className="flex min-h-0 flex-col gap-5 overflow-auto border-l border-[#8e5a31]/30 px-10 py-6 md:px-12">
          {ordered.length === 0 ? (
            <>
              <motion.div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2" variants={item}>
                {CHECK_FAMILIES.map(([family, description]) => (
                  <div className="flex gap-3" key={family}>
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#7bc79e]" />
                    <div>
                      <p className="text-[0.84rem] font-semibold text-[#fff6ea]">{family}</p>
                      <p className="mt-1 text-[0.74rem] leading-5 text-[#8f8275]">{description}</p>
                    </div>
                  </div>
                ))}
              </motion.div>
              {structural ? (
                <motion.div className="flex items-start gap-4 border border-[#38765a]/40 bg-[#0b1510] p-4" variants={item}>
                  <Ruler className="mt-0.5 h-4 w-4 shrink-0 text-[#7bc79e]" />
                  <div>
                    <p className="font-[family-name:var(--font-body)] text-[0.6rem] font-bold uppercase tracking-[0.14em] text-[#7bc79e]">Preliminary pillar coordination passed</p>
                    <p className="mt-1.5 text-[0.8rem] leading-6 text-[#b8d1c1]">
                      {structural.columns.length} aligned conceptual pillar locations · {structural.axes.length} grid axes · continuous through {payload.building.floors.length} floor{payload.building.floors.length === 1 ? "" : "s"}.
                    </p>
                    <p className="mt-1 text-[0.68rem] leading-5 text-[#7c9a89]">Member sizes, loads, foundations and code compliance remain licensed-engineer scope.</p>
                  </div>
                </motion.div>
              ) : null}
            </>
          ) : (
            <div className="flex flex-col">
              {ordered.slice(0, 8).map((finding, index) => (
                <motion.div className="flex gap-4 border-b border-[#8e5a31]/15 py-3.5 last:border-b-0" key={`${finding.ruleId}-${index}`} variants={item}>
                  <div className={`flex h-7 w-7 shrink-0 items-center justify-center border font-[family-name:var(--font-display)] text-sm ${finding.severity === "error" ? "border-[#e2665a] text-[#e2665a]" : finding.severity === "warning" ? "border-[#d9a856] text-[#d9a856]" : "border-[#8e5a31] text-[#b5a697]"}`}>
                    {String(index + 1).padStart(2, "0")}
                  </div>
                  <div>
                    <div className="mb-1 flex items-center gap-2">
                      <span className={`border px-2 py-0.5 font-[family-name:var(--font-body)] text-[0.56rem] font-bold uppercase tracking-[0.09em] ${finding.severity === "error" ? "border-[#e2665a] text-[#e2665a]" : finding.severity === "warning" ? "border-[#d9a856] text-[#d9a856]" : "border-[#c97940] text-[#c97940]"}`}>
                        {finding.severity}
                      </span>
                      <span className="font-[family-name:var(--font-body)] text-[0.62rem] uppercase tracking-[0.08em] text-[#8f8275]">{finding.category}</span>
                    </div>
                    <p className="text-[0.86rem] leading-6 text-[#e9dccb]">{finding.message}</p>
                  </div>
                </motion.div>
              ))}
              {ordered.length > 8 ? <p className="pt-3 text-[0.7rem] text-[#8f8275]">+ {ordered.length - 8} further findings in the workspace record.</p> : null}
            </div>
          )}
        </div>
      </div>

      <SlideFooter>
        <FooterFact label="Checks run" value="Geometry · egress · topology · vertical · planning" />
        <FooterFact label="Basis" value="Exact plan geometry, not a visual estimate" />
        <FooterFact label="Result" value={validation.valid ? "Plan is buildable-concept valid" : "Plan has blocking findings"} />
      </SlideFooter>
    </motion.div>
  );
}
