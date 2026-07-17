"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { DeckShell } from "@/components/deck/DeckShell";
import { BackCoverSlide } from "@/components/deck/slides/BackCoverSlide";
import { BriefSlide } from "@/components/deck/slides/BriefSlide";
import { CostSlide } from "@/components/deck/slides/CostSlide";
import { CoverSlide } from "@/components/deck/slides/CoverSlide";
import { FloorPlanSlide } from "@/components/deck/slides/FloorPlanSlide";
import { OverviewSlide } from "@/components/deck/slides/OverviewSlide";
import { RationaleSlide } from "@/components/deck/slides/RationaleSlide";
import { RenderSlide } from "@/components/deck/slides/RenderSlide";
import { RoomScheduleSlide } from "@/components/deck/slides/RoomScheduleSlide";
import { ValidationSlide } from "@/components/deck/slides/ValidationSlide";
import { deriveDeckSlides, type DeckPayload } from "@/lib/design/deck";

export function DeckViewer({ layoutVersionId }: { layoutVersionId: string }) {
  const [payload, setPayload] = useState<DeckPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    let active = true;
    fetch(`/api/designs/${layoutVersionId}/deck`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "This study can't be presented as a deck.");
        return data as DeckPayload;
      })
      .then((data) => { if (active) setPayload(data); })
      .catch((fetchError) => { if (active) setError(fetchError instanceof Error ? fetchError.message : "This study can't be presented as a deck."); });
    return () => { active = false; };
  }, [layoutVersionId]);

  if (error) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#090908] p-6 text-[#fff6ea]">
        <div className="max-w-lg border border-[#8e5a31]/60 bg-[#171512] p-7">
          <h1 className="font-[family-name:var(--font-display)] text-2xl">This study can't be presented as a deck</h1>
          <p className="mt-3 text-sm leading-6 text-[#b5a697]">{error}</p>
          <Link className="mt-6 inline-block border border-[#8e5a31] px-4 py-3 text-xs font-bold uppercase tracking-[0.12em] text-[#fff6ea]" href="/workspace">Back to workspace</Link>
        </div>
      </main>
    );
  }

  if (!payload) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#090908]">
        <div className="flex flex-col items-center gap-3">
          <p className="font-[family-name:var(--font-display)] text-xl text-[#fff6ea]">BrickPilot</p>
          <div className="h-px w-10 animate-pulse bg-[#c97940]" />
          <p className="font-[family-name:var(--font-body)] text-[0.62rem] font-bold uppercase tracking-[0.14em] text-[#786d62]">Setting out the sheets…</p>
        </div>
      </main>
    );
  }

  const slides = deriveDeckSlides(payload);
  const active = slides[activeIndex];
  const sheetLabel = String(active.sheetNumber).padStart(2, "0");

  function renderSlide() {
    switch (active.kind) {
      case "cover": return <CoverSlide payload={payload!} sheetTotal={slides.length} />;
      case "brief": return <BriefSlide payload={payload!} slide={active} />;
      case "overview": return <OverviewSlide payload={payload!} sheetLabel={sheetLabel} />;
      case "floor_plan": return <FloorPlanSlide floorId={active.floorId} payload={payload!} sheetLabel={sheetLabel} />;
      case "render": return <RenderSlide label={active.label} payload={payload!} role={active.role} sheetLabel={sheetLabel} />;
      case "room_schedule": return <RoomScheduleSlide payload={payload!} sheetLabel={sheetLabel} />;
      case "validation": return <ValidationSlide payload={payload!} sheetLabel={sheetLabel} />;
      case "cost": return <CostSlide payload={payload!} sheetLabel={sheetLabel} />;
      case "rationale": return <RationaleSlide payload={payload!} sheetLabel={sheetLabel} />;
      case "back_cover": return <BackCoverSlide payload={payload!} />;
    }
  }

  return (
    <DeckShell
      activeIndex={activeIndex}
      downloadDisabled={payload.renders.status !== "completed"}
      downloadHref={`/api/designs/${layoutVersionId}/deck/pdf`}
      onNavigate={setActiveIndex}
      slideTitles={slides.map((slide) => slide.title)}
    >
      {renderSlide()}
    </DeckShell>
  );
}
