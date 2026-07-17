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
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#090908] px-4 py-8">
      <div className="flex w-full max-w-[1360px] items-center justify-between gap-4">
        <p className="font-[family-name:var(--font-display)] text-lg text-[#fff6ea]">
          BrickPilot <span className="ml-2 font-[family-name:var(--font-body)] text-[0.62rem] font-bold uppercase tracking-[0.14em] text-[#c97940]">Concept Deck</span>
        </p>
        <div className="flex items-center gap-2">
          <span className="border border-[#8e5a31]/45 px-3 py-2 font-[family-name:var(--font-body)] text-[0.7rem] font-bold uppercase tracking-[0.1em] text-[#b5a697] [font-variant-numeric:tabular-nums]">
            {String(activeIndex + 1).padStart(2, "0")} / {slideTitles.length}
          </span>
          <a
            aria-disabled={downloadDisabled}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-[0.68rem] font-bold uppercase tracking-[0.11em] ${downloadDisabled ? "cursor-not-allowed bg-[#4d2515] text-[#957461]" : "bg-[#ff4e00] text-[#fff6ea] hover:bg-[#e94500]"}`}
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
          className="absolute left-[-22px] top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center border border-[#8e5a31]/55 bg-[#171512] text-[#fff6ea] hover:border-[#c97940] hover:text-[#c97940] disabled:opacity-30"
          disabled={activeIndex === 0}
          onClick={() => onNavigate(activeIndex - 1)}
          type="button"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          aria-label="Next slide"
          className="absolute right-[-22px] top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center border border-[#8e5a31]/55 bg-[#171512] text-[#fff6ea] hover:border-[#c97940] hover:text-[#c97940] disabled:opacity-30"
          disabled={activeIndex === slideTitles.length - 1}
          onClick={() => onNavigate(activeIndex + 1)}
          type="button"
        >
          <ChevronRight className="h-5 w-5" />
        </button>

        <div className="absolute inset-0 overflow-hidden border border-[#8e5a31]/55 bg-[#171512]">
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
      </div>

      <div className="flex w-full max-w-[1360px] gap-1.5 overflow-x-auto pb-1" ref={railRef}>
        {slideTitles.map((title, index) => (
          <button
            className={`flex shrink-0 flex-col items-center justify-center gap-0.5 border px-3 py-2 font-[family-name:var(--font-body)] text-[0.56rem] uppercase tracking-[0.06em] ${index === activeIndex ? "border-[#ff4e00] text-[#ff4e00]" : "border-[#8e5a31]/40 text-[#b5a697] hover:border-[#c97940]"}`}
            key={title + index}
            onClick={() => onNavigate(index)}
            type="button"
          >
            <b className="font-[family-name:var(--font-display)] text-sm font-normal">{String(index + 1).padStart(2, "0")}</b>
            <span className="max-w-16 truncate">{title}</span>
          </button>
        ))}
      </div>
      <p className="font-[family-name:var(--font-body)] text-[0.62rem] uppercase tracking-[0.1em] text-[#786d62]">
        Arrow keys to move · click a sheet below to jump
      </p>
    </main>
  );
}
