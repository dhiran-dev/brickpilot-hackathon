"use client";

import { motion, useReducedMotion } from "framer-motion";

import { useDeckMotionVariants } from "@/components/deck/motion";
import type { DeckPayload } from "@/lib/design/deck";

const ARC_LENGTH = Math.PI * 78; // path length of the M22,100 A78,78 0 0 1 178,100 semicircle

export function ValidationSlide({ payload, sheetLabel }: { payload: DeckPayload; sheetLabel: string }) {
  const { container, item } = useDeckMotionVariants();
  const reduce = useReducedMotion();
  const { validation } = payload;
  const offset = ARC_LENGTH * (1 - validation.score / 100);
  const warnings = validation.findings.filter((finding) => finding.severity === "warning");
  const infos = validation.findings.filter((finding) => finding.severity === "info");
  const ordered = [...warnings, ...infos];

  return (
    <motion.div animate="show" className="flex flex-1 flex-col" initial="hidden" variants={container}>
      <motion.div className="p-8 pb-0 md:p-10 md:pb-0" variants={item}>
        <p className="font-[family-name:var(--font-body)] text-[0.66rem] font-bold uppercase tracking-[0.16em] text-[#c97940]">{sheetLabel} — Validation Report</p>
        <h2 className="mt-1 font-[family-name:var(--font-display)] text-2xl text-[#fff6ea]">Deterministic checks against the plan geometry</h2>
      </motion.div>
      <div className="grid flex-1 grid-cols-1 md:grid-cols-[320px_1fr]">
        <motion.div className="flex flex-col gap-6 border-r border-[#8e5a31]/35 p-8 md:p-10" variants={item}>
          <div className="flex flex-col items-center">
            <svg className="w-full max-w-[220px]" viewBox="0 0 200 150">
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
            <p className="-mt-2 font-[family-name:var(--font-body)] text-[0.6rem] font-bold uppercase tracking-[0.14em] text-[#b5a697]">Validation score</p>
          </div>
          <div className="grid grid-cols-3 gap-px bg-[#8e5a31]/25">
            {[
              ["Errors", validation.counts.error, "border-t-[#e2665a]"],
              ["Warnings", validation.counts.warning, "border-t-[#d9a856]"],
              ["Info", validation.counts.info, "border-t-[#c97940]"],
            ].map(([label, value, borderClass]) => (
              <div className={`border-t-2 bg-[#171512] p-3 text-center ${borderClass}`} key={label as string}>
                <div className="font-[family-name:var(--font-display)] text-2xl text-[#fff6ea] [font-variant-numeric:tabular-nums]">{value}</div>
                <div className="mt-1 font-[family-name:var(--font-body)] text-[0.55rem] font-bold uppercase tracking-[0.08em] text-[#b5a697]">{label}</div>
              </div>
            ))}
          </div>
          <p className="border-t border-[#8e5a31]/25 pt-4 text-[0.76rem] leading-6 text-[#b5a697]">
            Rule pack {validation.rulePackVersion} — geometry, egress, topology, vertical &amp; planning checks run against the exact plan geometry, not a visual estimate.
          </p>
        </motion.div>
        <div className="flex flex-col overflow-auto p-8 md:p-10">
          {ordered.length === 0 ? (
            <motion.p className="text-sm text-[#b5a697]" variants={item}>No findings — this plan passed every rule with no warnings.</motion.p>
          ) : ordered.map((finding, index) => (
            <motion.div className="flex gap-4 border-b border-[#8e5a31]/15 py-4 last:border-b-0" key={`${finding.ruleId}-${index}`} variants={item}>
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center border font-[family-name:var(--font-display)] text-sm ${finding.severity === "warning" ? "border-[#d9a856] text-[#d9a856]" : "border-[#8e5a31] text-[#b5a697]"}`}>
                {String(index + 1).padStart(2, "0")}
              </div>
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <span className={`border px-2 py-0.5 font-[family-name:var(--font-body)] text-[0.58rem] font-bold uppercase tracking-[0.09em] ${finding.severity === "warning" ? "border-[#d9a856] text-[#d9a856]" : "border-[#c97940] text-[#c97940]"}`}>
                    {finding.severity === "warning" ? "Warning" : "Info"}
                  </span>
                  <span className="font-[family-name:var(--font-body)] text-[0.62rem] uppercase tracking-[0.08em] text-[#b5a697]">{finding.category}</span>
                </div>
                <p className="text-[0.9rem] leading-6 text-[#fff6ea]">{finding.message}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
