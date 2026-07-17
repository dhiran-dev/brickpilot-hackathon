"use client";

import { useId, useMemo } from "react";
import { Check, Pin } from "lucide-react";

import { CadPlan } from "@/components/cad-plan";
import type { PersistedScheme } from "@/lib/design/persisted-study";
import { buildDrawing } from "@/lib/drawing/build-drawing";
import { visibilityForPreset } from "@/lib/drawing/schema";

export function shouldShowSchemeRack(schemeCount: number, evidenceGateEnabled: boolean) {
  return evidenceGateEnabled && schemeCount > 1;
}

function SchemeOption({ scheme, active, pending, name, disabled, onChange }: {
  scheme: PersistedScheme;
  active: boolean;
  pending: boolean;
  name: string;
  disabled: boolean;
  onChange: (schemeId: string) => void;
}) {
  const detailId = useId();
  const artifact = useMemo(() => buildDrawing(scheme.building, {
    scheme: { name: scheme.name, partiId: scheme.partiId, style: "scheme study" },
  }).floors[0], [scheme]);
  return <label className={`relative block min-w-[13.5rem] snap-start border bg-[#090908] text-left sm:min-w-[17rem] md:min-w-[21rem] ${pending ? "border-[#c97940]" : "border-[#8e5a31]/45"} ${disabled ? "opacity-55" : "cursor-pointer"}`}>
    <input aria-describedby={detailId} checked={pending} className="peer sr-only" disabled={disabled} name={name} onChange={() => onChange(scheme.schemeId)} type="radio" value={scheme.schemeId} />
    <span className="block min-h-11 border-b border-[#8e5a31]/35 px-3 py-2.5 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#fff6ea]"><span className="flex items-center justify-between gap-3"><span className="text-[0.8125rem] font-extrabold uppercase tracking-[0.1em] text-[#fff6ea]">{scheme.name}</span>{active ? <span className="inline-flex items-center gap-1 text-[0.8125rem] font-bold uppercase tracking-[0.08em] text-[#fff6ea]"><Pin className="h-3 w-3" /> Pinned</span> : pending ? <span className="inline-flex items-center gap-1 text-[0.8125rem] font-bold uppercase tracking-[0.08em] text-[#c97940]"><Check className="h-3 w-3" /> Ready</span> : null}</span></span>
    <span aria-hidden="true" className="hidden aspect-[3/2] overflow-hidden border-b border-[#8e5a31]/30 bg-[#171512] p-1.5 sm:block">{artifact ? <CadPlan appearance="cad-dark" artifact={artifact} className="h-full w-full" layers={visibilityForPreset("architectural")} projectName={scheme.name} /> : null}</span>
    <span className="block p-3" id={detailId}><span className="block text-[0.8125rem] font-bold uppercase tracking-[0.09em] text-[#c97940]">{scheme.partiId.replaceAll("_", " ")} · rung {scheme.ladderRung}</span><span className="mt-1.5 line-clamp-2 block text-base leading-6 text-[#b5a697]">{scheme.rationale}</span></span>
  </label>;
}

export function SchemeRack({ schemes, selectedSchemeId, pendingSchemeId, disabled = false, onChange, className }: {
  schemes: readonly PersistedScheme[];
  selectedSchemeId: string | null | undefined;
  pendingSchemeId: string | null | undefined;
  disabled?: boolean;
  onChange: (schemeId: string) => void;
  className?: string;
}) {
  const name = `villa-scheme-${useId().replaceAll(":", "")}`;
  return <fieldset className={`min-w-0 w-full max-w-full overflow-hidden border-y border-[#8e5a31]/50 py-4 ${className ?? ""}`}>
    <legend className="px-1 text-[0.8125rem] font-extrabold uppercase tracking-[0.14em] text-[#c97940]">Viable villa directions</legend>
    <p className="mt-1 text-base leading-7 text-[#b5a697]">Choose a drawing to pin it for review. The canonical plan changes only after you confirm.</p>
    <div className="mt-4 flex snap-x gap-3 overflow-x-auto pb-3" data-scheme-count={schemes.length}>
      {schemes.map((scheme) => <SchemeOption active={scheme.schemeId === selectedSchemeId} disabled={disabled} key={scheme.schemeId} name={name} onChange={onChange} pending={scheme.schemeId === (pendingSchemeId ?? selectedSchemeId)} scheme={scheme} />)}
    </div>
    {schemes.length > 1 ? <p aria-hidden="true" className="mt-1 hidden border-r border-[#c97940] pr-3 text-right text-[0.8125rem] font-bold uppercase tracking-[0.08em] text-[#c97940] md:block xl:hidden">Scroll directions →</p> : null}
  </fieldset>;
}
