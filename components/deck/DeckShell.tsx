"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { slideDirectionVariants } from "@/components/deck/motion";

export function DeckShell({
  slideTitles,
  activeIndex,
  onNavigate,
  downloadHref,
  downloadDisabled,
  children,
}: {
  slideTitles: string[];
  activeIndex: number;
  onNavigate: (index: number) => void;
  downloadHref: string;
  downloadDisabled: boolean;
  children: React.ReactNode;
}) {
  const [direction, setDirection] = useState<1 | -1>(1);
  const previousIndex = useRef(activeIndex);
  const railRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDirection(activeIndex >= previousIndex.current ? 1 : -1);
    previousIndex.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowRight") onNavigate(Math.min(activeIndex + 1, slideTitles.length - 1));
      if (event.key === "ArrowLeft") onNavigate(Math.max(activeIndex - 1, 0));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeIndex, onNavigate, slideTitles.length]);

  useEffect(() => {
    const rail = railRef.current;
    const active = rail?.children[activeIndex] as HTMLElement | undefined;
    active?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [activeIndex]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-[#070706] px-4 py-7">
      <div className="flex w-full max-w-[1360px] items-center justify-between gap-4 px-1">
        <p className="font-[family-name:var(--font-display)] text-xl text-[#fff6ea]">
          BrickPilot <span className="ml-3 font-[family-name:var(--font-body)] text-[0.6rem] font-bold uppercase tracking-[0.18em] text-[#c97940]">Concept Deck</span>
        </p>
        <div className="flex items-center gap-4">
          <span className="font-[family-name:var(--font-body)] text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#8f8275] [font-variant-numeric:tabular-nums]">
            Sheet {String(activeIndex + 1).padStart(2, "0")} <span className="text-[#574f48]">/ {slideTitles.length}</span>
          </span>
          <a
            aria-disabled={downloadDisabled}
            className={`inline-flex items-center gap-2 px-4 py-2.5 font-[family-name:var(--font-body)] text-[0.66rem] font-bold uppercase tracking-[0.12em] transition-colors ${downloadDisabled ? "cursor-not-allowed bg-[#2a1a10] text-[#957461]" : "bg-[#ff4e00] text-[#fff6ea] hover:bg-[#e94500]"}`}
            href={downloadDisabled ? undefined : downloadHref}
            onClick={downloadDisabled ? (event) => event.preventDefault() : undefined}
          >
            <Download className="h-3.5 w-3.5" /> Download PDF
          </a>
        </div>
      </div>

      <div className="relative aspect-video w-full max-w-[1360px]">
        <button
          aria-label="Previous slide"
          className="absolute left-[-22px] top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center border border-[#8e5a31]/55 bg-[#0c0b09]/95 text-[#e9dccb] transition-colors hover:border-[#c97940] hover:text-[#c97940] disabled:opacity-25"
          disabled={activeIndex === 0}
          onClick={() => onNavigate(activeIndex - 1)}
          type="button"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          aria-label="Next slide"
          className="absolute right-[-22px] top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center border border-[#8e5a31]/55 bg-[#0c0b09]/95 text-[#e9dccb] transition-colors hover:border-[#c97940] hover:text-[#c97940] disabled:opacity-25"
          disabled={activeIndex === slideTitles.length - 1}
          onClick={() => onNavigate(activeIndex + 1)}
          type="button"
        >
          <ChevronRight className="h-5 w-5" />
        </button>

        <div className="absolute inset-0 overflow-hidden border border-[#8e5a31]/60 bg-[#100e0c] shadow-[14px_16px_0_rgba(0,0,0,0.55)]">
          <AnimatePresence custom={direction} initial={false} mode="wait">
            <motion.div
              animate="center"
              className="absolute inset-0 flex flex-col"
              custom={direction}
              exit="exit"
              initial="enter"
              key={activeIndex}
              variants={slideDirectionVariants(direction)}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="absolute bottom-0 left-0 right-0 z-10 h-[2px] bg-[#8e5a31]/20">
          <div className="h-full bg-[#ff4e00] transition-[width] duration-500" style={{ width: `${((activeIndex + 1) / slideTitles.length) * 100}%` }} />
        </div>
      </div>

      <div className="flex w-full max-w-[1360px] gap-1 overflow-x-auto pb-1" ref={railRef}>
        {slideTitles.map((title, index) => (
          <button
            className={`flex min-w-[4.4rem] shrink-0 flex-col items-center gap-1 border-t-2 px-2 pb-1 pt-2 font-[family-name:var(--font-body)] text-[0.54rem] uppercase tracking-[0.07em] transition-colors ${index === activeIndex ? "border-[#ff4e00] text-[#e9dccb]" : "border-[#8e5a31]/30 text-[#786d62] hover:border-[#c97940]/70 hover:text-[#b5a697]"}`}
            key={title + index}
            onClick={() => onNavigate(index)}
            type="button"
          >
            <b className="font-[family-name:var(--font-display)] text-[0.95rem] font-normal leading-none">{String(index + 1).padStart(2, "0")}</b>
            <span className="max-w-[5.2rem] truncate">{title}</span>
          </button>
        ))}
      </div>
      <p className="font-[family-name:var(--font-body)] text-[0.58rem] uppercase tracking-[0.12em] text-[#574f48]">
        Arrow keys to move · click a sheet to jump
      </p>
    </main>
  );
}
