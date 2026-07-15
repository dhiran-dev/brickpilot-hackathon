"use client";

import Link from "next/link";
import { ArrowLeft, Compass, ExternalLink, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";

import { generateLayout, layoutFixtures, type LayoutData, type LayoutFixtureName } from "@/lib/layout-engine";

const fixtureLabels: Record<LayoutFixtureName, string> = {
  eastFacing3Bhk30x50: "30 × 50 · East · 3BHK",
  fourBhk40x60: "40 × 60 · North · 4BHK",
  compact2Bhk20x30: "20 × 30 · West · 2BHK",
};

const roomFill: Record<LayoutData["rooms"][number]["type"], string> = {
  living: "#29231d",
  dining: "#211e1a",
  kitchen: "#33251b",
  bedroom: "#1d1b18",
  bathroom: "#28231e",
  pooja: "#30251d",
  utility: "#25211d",
  foyer: "#1c1a17",
  parking: "#211f1c",
  study: "#231f1a",
  balcony: "#1f1c18",
  circulation: "#1a1816",
};

const compactRoomNames: Record<string, string> = {
  "Primary Bath": "Ensuite",
  "Common Bath": "Bath",
  "Powder Room": "Powder",
  "Primary Suite": "Primary",
};

function PlanPreview({ layout }: { layout: LayoutData }) {
  const padding = 46;
  const scale = Math.min(700 / layout.plot.widthFt, 570 / layout.plot.depthFt);
  const width = layout.plot.widthFt * scale;
  const height = layout.plot.depthFt * scale;
  const plot = layout.plot;

  return (
    <svg
      aria-label={`Deterministic ${plot.widthFt} by ${plot.depthFt} foot floor plan`}
      className="block h-auto w-full"
      role="img"
      viewBox={`0 0 ${width + padding * 2} ${height + padding * 2}`}
    >
      <g fill="none" stroke="#c97940" strokeWidth="1" vectorEffect="non-scaling-stroke">
        <path d={`M${padding} 20v12M${padding + width} 20v12M${padding} 26H${padding + width}`} opacity="0.72" />
        <path d={`M20 ${padding}h12M20 ${padding + height}h12M26 ${padding}V${padding + height}`} opacity="0.72" />
      </g>
      <g fill="#c97940" fontFamily="Avenir Next, Gill Sans, sans-serif" fontSize="9" letterSpacing="1.1">
        <text textAnchor="middle" x={padding + width / 2} y="17">{plot.widthFt} FT</text>
        <text textAnchor="middle" transform={`rotate(-90 15 ${padding + height / 2})`} x="15" y={padding + height / 2}>{plot.depthFt} FT</text>
      </g>
      <rect fill="none" height={height} stroke="#c97940" strokeOpacity="0.55" strokeWidth="1" width={width} x={padding} y={padding} />
      <rect
        fill="#13110f"
        height={layout.buildableBounds.depthFt * scale}
        stroke="#fff6ea"
        strokeWidth="2.5"
        width={layout.buildableBounds.widthFt * scale}
        x={padding + layout.buildableBounds.xFt * scale}
        y={padding + layout.buildableBounds.yFt * scale}
      />
      {layout.rooms.map((room) => {
        const roomWidth = room.widthFt * scale;
        const roomHeight = room.depthFt * scale;
        const roomName = compactRoomNames[room.name] ?? room.name;
        const labelFits = roomWidth > Math.max(48, roomName.length * 5.3) && roomHeight > 32;
        return (
          <g key={room.id}>
            <rect
              fill={roomFill[room.type]}
              height={roomHeight}
              stroke="#fff6ea"
              strokeWidth="1.6"
              width={roomWidth}
              x={padding + room.xFt * scale}
              y={padding + room.yFt * scale}
            />
            {labelFits ? (
              <g fill="#fff6ea" fontFamily="Avenir Next, Gill Sans, sans-serif" textAnchor="middle">
                <text fontSize="9" fontWeight="700" letterSpacing="0.7" x={padding + room.xFt * scale + roomWidth / 2} y={padding + room.yFt * scale + roomHeight / 2 - 2}>
                  {roomName.toUpperCase()}
                </text>
                <text fill="#b5a697" fontSize="8" x={padding + room.xFt * scale + roomWidth / 2} y={padding + room.yFt * scale + roomHeight / 2 + 11}>
                  {Math.round(room.areaSqFt)} SQ FT
                </text>
              </g>
            ) : null}
          </g>
        );
      })}
      <g transform={`translate(${width + padding + 18} ${padding + 8})`}>
        <circle cx="0" cy="0" fill="#090908" r="13" stroke="#ff4e00" />
        <path d="M0-9 4 3 0 1-4 3Z" fill="#ff4e00" />
        <text fill="#ff4e00" fontFamily="Avenir Next, sans-serif" fontSize="8" fontWeight="700" textAnchor="middle" y="-17">N</text>
      </g>
    </svg>
  );
}

export function LayoutLab() {
  const [fixtureName, setFixtureName] = useState<LayoutFixtureName>("eastFacing3Bhk30x50");
  const [seed, setSeed] = useState(2_026);
  const layout = useMemo(() => generateLayout(layoutFixtures[fixtureName], seed), [fixtureName, seed]);
  const requirements = layoutFixtures[fixtureName];

  return (
    <main className="min-h-screen bg-[#090908] text-[#fff6ea]">
      <div className="mx-auto max-w-[96rem] px-4 py-5 sm:px-6 sm:py-7">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#8e5a31]/60 pb-5">
          <div className="flex items-center gap-5">
            <Link aria-label="Back to home" className="border border-[#8e5a31]/70 p-2.5 text-[#c97940] transition-colors hover:bg-[#171512] focus:outline-2 focus:outline-offset-4 focus:outline-[#fff6ea]" href="/">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <p className="font-[family-name:var(--font-display)] text-3xl tracking-[-0.035em] text-[#c97940]">BrickPilot</p>
              <p className="mt-1 text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#b5a697]">Layout engine · checkpoint 02</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3"><div className="flex items-center gap-2 text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#b5a697]"><span className="h-2 w-2 bg-[#ff4e00]" aria-hidden="true" /> Internal geometry harness</div><Link className="inline-flex items-center gap-2 border border-[#c97940] px-3 py-2 text-[0.65rem] font-bold uppercase tracking-[0.1em] text-[#fff6ea] hover:bg-[#171512]" href="/workspace">Open product workspace <ExternalLink className="h-3.5 w-3.5" /></Link></div>
        </header>

        <div className="mt-6 border-l-2 border-[#ff4e00] bg-[#17120e] px-4 py-3 text-xs leading-5 text-[#b5a697]"><strong className="text-[#fff6ea]">Internal QA only.</strong> This page visualizes the legacy recursive partition candidate and is not professional drawing output. Use <Link className="text-[#ff8d49] underline underline-offset-4" href="/workspace">/workspace</Link> for guided requirements, topology validation, doors/windows/stairs, regional cost, layers, CAD Dark/Paper Light, and exports.</div>

        <section className="grid gap-8 py-8 xl:grid-cols-[20rem_minmax(0,1fr)] xl:py-10">
          <aside className="border border-[#8e5a31]/55 bg-[#0e0d0b] p-6">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#c97940]">Test brief</p>
            <h1 className="mt-4 font-[family-name:var(--font-display)] text-4xl leading-[0.98] tracking-[-0.035em]">Partition every square foot<span className="text-[#ff4e00]">.</span></h1>
            <p className="mt-5 text-sm leading-6 text-[#b5a697]">The engine slices one buildable rectangle into aligned rooms. A seed changes the composition without sacrificing validity.</p>

            <label className="mt-8 block">
              <span className="text-[0.7rem] font-bold uppercase tracking-[0.12em] text-[#c97940]">Checkpoint fixture</span>
              <select
                className="mt-2 w-full appearance-none border border-[#8e5a31]/70 bg-[#171512] px-3 py-3 text-sm text-[#fff6ea] outline-none focus:border-[#fff6ea]"
                onChange={(event) => setFixtureName(event.target.value as LayoutFixtureName)}
                value={fixtureName}
              >
                {Object.entries(fixtureLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>

            <label className="mt-5 block">
              <span className="text-[0.7rem] font-bold uppercase tracking-[0.12em] text-[#c97940]">Seed</span>
              <input
                className="mt-2 w-full border border-[#8e5a31]/70 bg-[#171512] px-3 py-3 text-sm text-[#fff6ea] outline-none focus:border-[#fff6ea]"
                max={0xffff_ffff}
                min={0}
                onChange={(event) => setSeed(Number(event.target.value) >>> 0)}
                type="number"
                value={seed}
              />
            </label>
            <button
              className="mt-5 flex w-full items-center justify-between bg-[#ff4e00] px-4 py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-[#fff6ea] transition hover:-translate-y-0.5 hover:bg-[#e94500] focus:outline-2 focus:outline-offset-4 focus:outline-[#fff6ea] motion-reduce:transform-none"
              onClick={() => setSeed((current) => (current + 1) >>> 0)}
              type="button"
            >
              Regenerate <RefreshCw className="h-4 w-4" />
            </button>

            <dl className="mt-8 border-t border-[#8e5a31]/55 pt-5 text-sm">
              <div className="flex justify-between gap-4 py-2"><dt className="text-[#b5a697]">Floor</dt><dd>Ground only</dd></div>
              <div className="flex justify-between gap-4 py-2"><dt className="text-[#b5a697]">Rooms</dt><dd>{layout.rooms.length}</dd></div>
              <div className="flex justify-between gap-4 py-2"><dt className="text-[#b5a697]">Coverage</dt><dd>{(layout.coverageRatio * 100).toFixed(2)}%</dd></div>
              <div className="flex justify-between gap-4 py-2"><dt className="text-[#b5a697]">Facing</dt><dd className="capitalize">{requirements.plot.facing}</dd></div>
            </dl>
          </aside>

          <div className="relative self-start">
            <div className="absolute -top-2 right-2 bottom-6 left-2 border border-[#8e5a31]/45 bg-[#11100e]" aria-hidden="true" />
            <section className="relative border border-[#8e5a31]/70 bg-[#171512] p-4 shadow-[10px_11px_0_rgba(20,18,16,0.82)] sm:p-6">
              <div className="flex items-center justify-between gap-4 border-b border-[#8e5a31]/55 pb-4 text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#c97940]">
                <span>{requirements.name}</span>
                <span className="flex items-center gap-2"><Compass className="h-3.5 w-3.5" /> Seed {layout.seed}</span>
              </div>
              <div className="mx-auto mt-4 max-w-4xl"><PlanPreview layout={layout} /></div>
              <div className="grid border-t border-[#8e5a31]/55 sm:grid-cols-3">
                <div className="py-4 sm:pr-5"><span className="text-[0.65rem] uppercase tracking-[0.1em] text-[#b5a697]">Buildable</span><b className="mt-1 block font-[family-name:var(--font-display)] text-2xl font-normal">{layout.buildableBounds.areaSqFt.toFixed(0)} sq ft</b></div>
                <div className="border-t border-[#8e5a31]/55 py-4 sm:border-l sm:border-t-0 sm:px-5"><span className="text-[0.65rem] uppercase tracking-[0.1em] text-[#b5a697]">Overlap</span><b className="mt-1 block font-[family-name:var(--font-display)] text-2xl font-normal">0.00 sq ft</b></div>
                <div className="border-t border-[#8e5a31]/55 py-4 sm:border-l sm:border-t-0 sm:pl-5"><span className="text-[0.65rem] uppercase tracking-[0.1em] text-[#b5a697]">Algorithm</span><b className="mt-1 block font-[family-name:var(--font-display)] text-2xl font-normal">Recursive slice</b></div>
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
