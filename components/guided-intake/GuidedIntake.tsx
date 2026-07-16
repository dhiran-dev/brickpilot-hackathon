"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Building2, Check, CircleDollarSign, Compass, Home, LoaderCircle, MapPinned, Palette, RotateCcw, Ruler, Sparkles, UsersRound } from "lucide-react";

import { BUILDING_TYPE_OPTIONS, buildingRequirementsSchema, type BuildingRequirements } from "@/lib/building/requirements";
import { assessBriefCapacity, createRequirements, DEFAULT_INTAKE_DRAFT, draftFromRequirements, floorProgramBrief, normalizeFloorProgram, updateFloorProgramBrief, upgradeLegacyFloorProgram, type FloorProgram, type FloorProgramBrief, type IntakeDraft } from "@/components/guided-intake/model";
import { adminAreaForRegion, CURRENCY_OPTIONS, LOCALE_OPTIONS, REGION_OPTIONS, regionForCountry } from "@/components/guided-intake/region-options";

const STEPS = [
  { id: "project", label: "Project", question: "What are we planning?", icon: Home },
  { id: "region", label: "Region", question: "Where will it be built?", icon: MapPinned },
  { id: "site", label: "Site", question: "What controls the plot?", icon: Compass },
  { id: "building", label: "Levels", question: "How should the house stack?", icon: Building2 },
  { id: "rooms", label: "Rooms", question: "Who needs which spaces?", icon: UsersRound },
  { id: "architecture", label: "Style", question: "What architectural character should shape it?", icon: Palette },
  { id: "budget", label: "Budget", question: "What should the estimate respect?", icon: CircleDollarSign },
  { id: "review", label: "Review", question: "Is this the brief to solve?", icon: Check },
] as const;

const CONTROL = "mt-2 w-full border border-[#8e5a31]/60 bg-[#12100e] px-3 py-2.5 text-sm text-[#fff6ea] outline-none transition-colors placeholder:text-[#655d55] focus:border-[#fff6ea] focus:ring-1 focus:ring-[#fff6ea]";
const LABEL = "text-[0.65rem] font-extrabold uppercase tracking-[0.12em] text-[#c97940]";
const DIRECTIONS = ["north", "east", "south", "west"] as const;
const FLOOR_HEIGHT_OPTIONS = [
  [2.7, "2.70 m · compact"],
  [3, "3.00 m · standard"],
  [3.1, "3.10 m · comfortable"],
  [3.3, "3.30 m · generous"],
  [3.6, "3.60 m · high ceiling"],
] as const;
const STAIR_WIDTH_OPTIONS = [
  [900, "900 mm · compact baseline"],
  [1000, "1000 mm · standard residential"],
  [1100, "1100 mm · comfortable"],
  [1200, "1200 mm · generous"],
  [1500, "1500 mm · wide / assisted movement"],
] as const;
const INTAKE_STORAGE_VERSION = 4;

type StepId = (typeof STEPS)[number]["id"];

export type GuidedIntakeProps = {
  initialValue?: BuildingRequirements;
  onChange?: (requirements: BuildingRequirements) => void;
  onSubmit: (requirements: BuildingRequirements) => void | Promise<void>;
  isSubmitting?: boolean;
  storageKey?: string;
  submitLabel?: string;
  className?: string;
};

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="block"><span className={LABEL}>{label}</span>{children}{hint ? <span className="mt-1.5 block text-[0.68rem] leading-5 text-[#8f8275]">{hint}</span> : null}</label>;
}

function NumberControl({ label, value, min, max, suffix, onChange }: { label: string; value: number; min: number; max: number; suffix?: string; onChange: (value: number) => void }) {
  return <div className="flex items-center justify-between gap-3 border-b border-[#8e5a31]/30 py-3"><span className="text-sm text-[#cbbcab]">{label}</span><div className="flex items-center"><button aria-label={`Decrease ${label}`} className="grid h-8 w-8 place-items-center border border-[#8e5a31]/50 text-lg text-[#c97940] hover:bg-[#20160f] disabled:opacity-30" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} type="button">−</button><output className="min-w-12 px-2 text-center font-[family-name:var(--font-display)] text-xl">{value}{suffix}</output><button aria-label={`Increase ${label}`} className="grid h-8 w-8 place-items-center border border-[#8e5a31]/50 text-lg text-[#c97940] hover:bg-[#20160f] disabled:opacity-30" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} type="button">+</button></div></div>;
}

function Choice({ checked, title, detail, disabled, badge, onClick }: { checked: boolean; title: string; detail: string; disabled?: boolean; badge?: string; onClick: () => void }) {
  return <button aria-pressed={checked} className={`relative min-h-28 border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fff6ea] ${disabled ? "cursor-not-allowed border-[#45392f]/55 bg-[#0b0a09] text-[#655d55]" : checked ? "border-[#ff4e00] bg-[#25150e] text-[#fff6ea] shadow-[inset_0_-2px_#ff4e00]" : "border-[#8e5a31]/45 bg-[#11100e] text-[#b5a697] hover:border-[#c97940] hover:text-[#fff6ea]"}`} disabled={disabled} onClick={onClick} type="button"><span className="block text-[0.69rem] font-extrabold uppercase tracking-[0.1em]">{title}</span><span className="mt-2 block text-xs leading-5 opacity-80">{detail}</span>{badge ? <span className="absolute right-2 top-2 border border-current px-1.5 py-0.5 text-[0.52rem] font-bold uppercase tracking-[0.08em]">{badge}</span> : null}</button>;
}

function Toggle({ checked, label, detail, onChange }: { checked: boolean; label: string; detail?: string; onChange: (checked: boolean) => void }) {
  return <button aria-pressed={checked} className={`flex w-full items-center justify-between gap-4 border p-3 text-left transition-colors ${checked ? "border-[#c97940] bg-[#1c140f]" : "border-[#8e5a31]/35 bg-[#0f0e0c]"}`} onClick={() => onChange(!checked)} type="button"><span><span className="block text-sm font-semibold text-[#fff6ea]">{label}</span>{detail ? <span className="mt-0.5 block text-xs leading-5 text-[#8f8275]">{detail}</span> : null}</span><span aria-hidden="true" className={`relative h-6 w-11 shrink-0 border ${checked ? "border-[#ff4e00] bg-[#ff4e00]" : "border-[#5e5146] bg-[#171512]"}`}><span className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 bg-[#fff6ea] transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`} /></span></button>;
}

function stepReady(step: StepId, draft: IntakeDraft) {
  if (step === "project") return draft.projectName.trim().length > 0;
  if (step === "region") return /^[A-Za-z]{2}$/.test(draft.countryCode) && draft.adminArea.trim().length > 0 && /^[A-Za-z]{3}$/.test(draft.currency) && draft.locale.trim().length >= 2;
  if (step === "site") return draft.siteWidth > 0 && draft.siteDepth > 0 && draft.roadEdges.length > 0 && Object.values(draft.setbacks).every((value) => value >= 0);
  if (step === "building") return draft.floorCount >= 1 && draft.floorCount <= 4 && draft.floorHeightM >= 2.4 && (draft.floorCount === 1 || draft.stairWidthMm >= 900);
  if (step === "rooms") return draft.occupants > 0 && draft.programs.slice(0, draft.floorCount).reduce((sum, floor) => sum + floor.bedrooms, 0) >= 1 && draft.programs.slice(0, draft.floorCount).reduce((sum, floor) => sum + floor.bathrooms, 0) >= 1;
  if (step === "architecture") return Boolean(draft.architecturalStyle && draft.formStrategy && draft.roofCharacter && draft.materialDirection);
  if (step === "budget") return draft.budgetLowMajor >= 0 && draft.budgetHighMajor >= draft.budgetLowMajor && draft.contingencyPercent >= 0;
  return true;
}

export function GuidedIntake({ initialValue, onChange, onSubmit, isSubmitting = false, storageKey = "new-project", submitLabel = "Generate feasible plan", className }: GuidedIntakeProps) {
  const [draft, setDraft] = useState<IntakeDraft>(() => initialValue ? draftFromRequirements(initialValue) : DEFAULT_INTAKE_DRAFT);
  const [stepIndex, setStepIndex] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const step = STEPS[stepIndex];
  const unitLabel = draft.displayUnit === "metric" ? "m" : "ft";
  const currentRegion = regionForCountry(draft.countryCode);
  const currentAdminArea = adminAreaForRegion(currentRegion, draft.adminArea);
  const requirements = useMemo(() => {
    try { return createRequirements(draft); } catch { return null; }
  }, [draft]);
  const capacity = useMemo(() => requirements ? assessBriefCapacity(requirements) : null, [requirements]);

  useEffect(() => {
    if (initialValue) {
      setDraft(draftFromRequirements(initialValue));
      setStepIndex(0);
      setError(null);
      setHydrated(true);
      return;
    }
    try {
      const saved = window.localStorage.getItem(`brickpilot:intake:${storageKey}`);
      if (saved) {
        const parsed = JSON.parse(saved) as { version?: number; draft?: IntakeDraft & { roadEdge?: IntakeDraft["roadEdges"][number] }; stepIndex?: number };
        if (parsed.draft) setDraft({
          ...DEFAULT_INTAKE_DRAFT,
          ...parsed.draft,
          roadEdges: parsed.draft.roadEdges?.length ? parsed.draft.roadEdges : parsed.draft.roadEdge ? [parsed.draft.roadEdge] : DEFAULT_INTAKE_DRAFT.roadEdges,
          floorHeightM: FLOOR_HEIGHT_OPTIONS.some(([value]) => value === parsed.draft?.floorHeightM) ? parsed.draft.floorHeightM : DEFAULT_INTAKE_DRAFT.floorHeightM,
          stairWidthMm: STAIR_WIDTH_OPTIONS.some(([value]) => value === parsed.draft?.stairWidthMm) ? parsed.draft.stairWidthMm : DEFAULT_INTAKE_DRAFT.stairWidthMm,
          setbacks: { ...DEFAULT_INTAKE_DRAFT.setbacks, ...parsed.draft.setbacks },
          socialSpaceMode: parsed.draft.socialSpaceMode ?? DEFAULT_INTAKE_DRAFT.socialSpaceMode,
          programs: DEFAULT_INTAKE_DRAFT.programs.map((fallback, level) => (parsed.version ?? 0) >= 2
            ? normalizeFloorProgram(parsed.draft?.programs?.[level], fallback)
            : upgradeLegacyFloorProgram(parsed.draft?.programs?.[level], fallback)),
        });
        if (typeof parsed.stepIndex === "number") setStepIndex(Math.max(0, Math.min(STEPS.length - 1, parsed.stepIndex)));
      }
    } catch {
      // Local progress is an enhancement; malformed storage is ignored.
    }
    setHydrated(true);
  }, [initialValue, storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(`brickpilot:intake:${storageKey}`, JSON.stringify({ version: INTAKE_STORAGE_VERSION, draft, stepIndex }));
  }, [draft, hydrated, stepIndex, storageKey]);

  useEffect(() => {
    if (requirements) onChange?.(requirements);
  }, [onChange, requirements]);

  function patch(next: Partial<IntakeDraft>) {
    setDraft((current) => ({ ...current, ...next }));
    setError(null);
  }

  function changeCountry(countryCode: string) {
    const region = regionForCountry(countryCode);
    const adminArea = region.adminAreas[0];
    patch({
      countryCode: region.countryCode,
      adminArea: adminArea.value,
      locality: adminArea.localities[0].value,
      currency: region.defaultCurrency,
      locale: region.defaultLocale,
    });
  }

  function changeAdminArea(adminAreaValue: string) {
    const adminArea = adminAreaForRegion(currentRegion, adminAreaValue);
    patch({ adminArea: adminArea.value, locality: adminArea.localities[0].value });
  }

  function updateProgram(level: number, next: Partial<FloorProgram>) {
    setDraft((current) => ({
      ...current,
      programs: current.programs.map((program, index) => index === level
        ? normalizeFloorProgram({ ...program, ...next }, DEFAULT_INTAKE_DRAFT.programs[level])
        : program),
    }));
  }

  function updateProgramBrief(level: number, next: Partial<FloorProgramBrief>) {
    setDraft((current) => ({
      ...current,
      programs: current.programs.map((program, index) => index === level
        ? updateFloorProgramBrief(program, next)
        : program),
    }));
    setError(null);
  }

  function toggleRoadEdge(direction: IntakeDraft["roadEdges"][number]) {
    const selected = draft.roadEdges.includes(direction);
    if (selected && draft.roadEdges.length === 1) return;
    patch({ roadEdges: selected ? draft.roadEdges.filter((edge) => edge !== direction) : [...draft.roadEdges, direction] });
  }

  function changeUnits(next: IntakeDraft["displayUnit"]) {
    if (next === draft.displayUnit) return;
    const factor = next === "imperial" ? 3.28084 : 0.3048;
    patch({ displayUnit: next, siteWidth: Number((draft.siteWidth * factor).toFixed(2)), siteDepth: Number((draft.siteDepth * factor).toFixed(2)), setbacks: Object.fromEntries(Object.entries(draft.setbacks).map(([key, value]) => [key, Number((value * factor).toFixed(2))])) as IntakeDraft["setbacks"] });
  }

  async function submit() {
    const incompleteStepIndex = STEPS.findIndex((candidate) => !stepReady(candidate.id, draft));
    if (incompleteStepIndex >= 0) {
      setStepIndex(incompleteStepIndex);
      setError(`Complete the ${STEPS[incompleteStepIndex].label.toLowerCase()} step before generating.`);
      return;
    }
    if (!requirements) { setError("Some answers do not form a valid building brief yet. Review the highlighted step values."); return; }
    if (capacity?.blocking) { setError("The minimum room programme is larger than the usable floor area. Follow the capacity recommendations above before generating."); return; }
    const parsed = buildingRequirementsSchema.safeParse(createRequirements(draft));
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "The brief is incomplete."); return; }
    setError(null);
    await onSubmit(parsed.data);
  }

  function reset() {
    setDraft(DEFAULT_INTAKE_DRAFT);
    setStepIndex(0);
    setError(null);
    window.localStorage.removeItem(`brickpilot:intake:${storageKey}`);
  }

  return (
    <section className={`border border-[#8e5a31]/55 bg-[#0d0c0a] text-[#fff6ea] ${className ?? ""}`}>
      <header className="border-b border-[#8e5a31]/45 px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[0.65rem] font-extrabold uppercase tracking-[0.14em] text-[#ff6a1f]">Guided residential brief</p><h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl font-normal tracking-[-0.035em]">Questions before coordinates<span className="text-[#ff4e00]">.</span></h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[#9f9183]">Every answer becomes a measurable planning constraint. No room geometry or cost is invented from a sentence.</p></div><button className="inline-flex items-center gap-2 border border-[#8e5a31]/45 px-3 py-2 text-[0.62rem] font-bold uppercase tracking-[0.1em] text-[#a8998b] hover:border-[#c97940] hover:text-[#fff6ea]" onClick={reset} type="button"><RotateCcw className="h-3.5 w-3.5" /> Reset</button></div>
      </header>

      <div className="grid lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Brief steps" className="border-b border-[#8e5a31]/40 bg-[#0a0908] p-2 lg:border-b-0 lg:border-r">
          <ol className="grid grid-cols-4 gap-px sm:grid-cols-7 lg:block">
            {STEPS.map((item, index) => { const Icon = item.icon; const complete = index < stepIndex && stepReady(item.id, draft); return <li key={item.id}><button aria-current={index === stepIndex ? "step" : undefined} className={`flex w-full items-center gap-3 px-2 py-3 text-left transition-colors lg:border-b lg:border-[#8e5a31]/25 lg:px-3 ${index === stepIndex ? "bg-[#25150e] text-[#fff6ea] shadow-[inset_2px_0_#ff4e00]" : index < stepIndex ? "text-[#c5b5a5]" : "text-[#625a52] hover:text-[#a8998b]"}`} onClick={() => setStepIndex(index)} type="button"><span className={`grid h-7 w-7 shrink-0 place-items-center border ${complete ? "border-[#4a8d68] text-[#77c497]" : index === stepIndex ? "border-[#ff4e00] text-[#ff8b4d]" : "border-[#4a4037]"}`}>{complete ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}</span><span className="hidden text-[0.64rem] font-bold uppercase tracking-[0.1em] sm:block lg:block">{item.label}</span></button></li>; })}
          </ol>
        </nav>

        <div className="min-w-0 p-5 sm:p-7">
          <div className="mb-7 border-b border-[#8e5a31]/35 pb-5"><p className="text-[0.61rem] font-bold uppercase tracking-[0.13em] text-[#8f8275]">Step {stepIndex + 1} of {STEPS.length}</p><h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-normal tracking-[-0.025em]">{step.question}</h2></div>

          {step.id === "project" ? <div className="space-y-7">
            <Field label="Project name"><input autoFocus className={CONTROL} maxLength={120} onChange={(event) => patch({ projectName: event.target.value })} placeholder="The Nair family home" value={draft.projectName} /></Field>
            <div><p className={LABEL}>Building type</p><div className="mt-2 grid gap-2 md:grid-cols-3">{BUILDING_TYPE_OPTIONS.map((option) => <Choice badge={option.available ? undefined : option.note} checked={option.value === draft.buildingType} detail={option.available ? "A single-family bungalow or multi-level villa, from ground-only through G+3." : option.value === "apartment" ? "Multi-unit residential planning is not enabled yet." : "Office, retail and institutional rule packs are coming later."} disabled={!option.available} key={option.value} onClick={() => option.available && patch({ buildingType: "detached_house" })} title={option.label} />)}</div></div>
            <div className="border-l-2 border-[#c97940] bg-[#17120e] p-4 text-xs leading-6 text-[#aa9b8d]"><strong className="text-[#fff6ea]">Scope:</strong> BrickPilot produces a residential concept and feasibility package. A licensed architect and engineers must verify it before permits or construction.</div>
          </div> : null}

          {step.id === "region" ? <div className="space-y-7">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Country / region" hint="The ISO country code is stored automatically with the selection."><select className={CONTROL} id="region-country" onChange={(event) => changeCountry(event.target.value)} value={draft.countryCode}>{!REGION_OPTIONS.some((region) => region.countryCode === draft.countryCode) ? <option value={draft.countryCode}>General / other region ({draft.countryCode})</option> : null}{REGION_OPTIONS.map((region) => <option key={region.countryCode} value={region.countryCode}>{region.label} · {region.countryCode}</option>)}</select></Field>
              <Field label="State / province / emirate"><select className={CONTROL} id="region-admin-area" onChange={(event) => changeAdminArea(event.target.value)} value={draft.adminArea}>{!currentRegion.adminAreas.some((adminArea) => adminArea.value === draft.adminArea) ? <option value={draft.adminArea}>General / other region ({draft.adminArea})</option> : null}{currentRegion.adminAreas.map((adminArea) => <option key={adminArea.value} value={adminArea.value}>{adminArea.label}</option>)}</select></Field>
              <Field label="City / locality"><select className={CONTROL} id="region-locality" onChange={(event) => patch({ locality: event.target.value })} value={draft.locality}>{!currentAdminArea.localities.some((locality) => locality.value === draft.locality) ? <option value={draft.locality}>General / other locality ({draft.locality})</option> : null}{currentAdminArea.localities.map((locality) => <option key={locality.value} value={locality.value}>{locality.label}</option>)}</select></Field>
              <Field label="Currency" hint="Choose the native project currency. Unsupported rate regions remain unavailable rather than being converted silently."><select className={CONTROL} id="region-currency" onChange={(event) => patch({ currency: event.target.value })} value={draft.currency}>{!CURRENCY_OPTIONS.some(([currency]) => currency === draft.currency) ? <option value={draft.currency}>General / other currency ({draft.currency})</option> : null}{CURRENCY_OPTIONS.map(([currency, label]) => <option key={currency} value={currency}>{label}</option>)}</select></Field>
              <Field label="Formatting locale" hint="Controls digit grouping, currency symbols and number presentation."><select className={CONTROL} id="region-locale" onChange={(event) => patch({ locale: event.target.value })} value={draft.locale}>{!LOCALE_OPTIONS.some(([locale]) => locale === draft.locale) ? <option value={draft.locale}>General formatting ({draft.locale})</option> : null}{LOCALE_OPTIONS.map(([locale, label]) => <option key={locale} value={locale}>{label}</option>)}</select></Field>
            </div>
            <div><p className={LABEL}>Display measurements</p><div className="mt-2 grid grid-cols-2 gap-2"><Choice checked={draft.displayUnit === "metric"} detail="Metres and square metres. Canonical geometry remains integer millimetres." onClick={() => changeUnits("metric")} title="Metric" /><Choice checked={draft.displayUnit === "imperial"} detail="Feet and square feet for display. Stored geometry remains millimetres." onClick={() => changeUnits("imperial")} title="Imperial" /></div></div>
            <div className="flex gap-3 border border-[#8e5a31]/40 bg-[#11100e] p-4"><CircleDollarSign className="mt-0.5 h-5 w-5 shrink-0 text-[#c97940]" /><p className="text-xs leading-5 text-[#9f9183]">Cost will only be shown when a reviewed rate pack supports <strong className="text-[#fff6ea]">{draft.locality || draft.adminArea}, {draft.currency}</strong>. Any fallback is labelled with its source, effective date and confidence.</p></div>
          </div> : null}

          {step.id === "site" ? <div className="space-y-7">
            <div className="grid gap-5 sm:grid-cols-2"><Field label={`Plot width (${unitLabel})`}><input className={CONTROL} min="1" onChange={(event) => patch({ siteWidth: Number(event.target.value) })} step="0.1" type="number" value={draft.siteWidth} /></Field><Field label={`Plot depth (${unitLabel})`}><input className={CONTROL} min="1" onChange={(event) => patch({ siteDepth: Number(event.target.value) })} step="0.1" type="number" value={draft.siteDepth} /></Field></div>
            <div className="grid gap-5 sm:grid-cols-[1.4fr_1fr]"><div><p className={LABEL}>Road edges · select all that apply</p><div aria-label="Road edges" className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4" role="group">{DIRECTIONS.map((direction) => { const checked = draft.roadEdges.includes(direction); return <button aria-pressed={checked} className={`border px-3 py-3 text-[0.65rem] font-extrabold uppercase tracking-[0.1em] transition-colors ${checked ? "border-[#ff4e00] bg-[#25150e] text-[#fff6ea]" : "border-[#8e5a31]/45 bg-[#11100e] text-[#8f8275] hover:border-[#c97940]"}`} key={direction} onClick={() => toggleRoadEdge(direction)} type="button">{direction}</button>; })}</div><p className="mt-1.5 text-[0.68rem] leading-5 text-[#8f8275]">At least one road edge is required. Main facing is preferred for the entrance when it also has road access.</p></div><Field label="Main facing"><select className={CONTROL} onChange={(event) => patch({ facing: event.target.value as IntakeDraft["facing"] })} value={draft.facing}>{DIRECTIONS.map((direction) => <option key={direction} value={direction}>{direction[0].toUpperCase() + direction.slice(1)}</option>)}</select></Field></div>
            <div><p className={LABEL}>Setbacks ({unitLabel})</p><div className="mt-2 grid gap-3 border border-[#8e5a31]/40 bg-[#11100e] p-4 sm:grid-cols-4">{(["north", "east", "south", "west"] as const).map((direction) => <Field key={direction} label={direction}><input className={CONTROL} min="0" onChange={(event) => patch({ setbacks: { ...draft.setbacks, [direction]: Number(event.target.value) } })} step="0.1" type="number" value={draft.setbacks[direction]} /></Field>)}</div></div>
            <div><p className={LABEL}>Plot geometry</p><div className="mt-2 grid gap-2 sm:grid-cols-2"><Choice checked detail="Supported for verified topology, setbacks and drawing output." onClick={() => undefined} title="Rectangular plot" /><Choice badge="Coming soon" checked={false} detail="Irregular boundaries are not yet accepted for generation." disabled onClick={() => undefined} title="Irregular plot" /></div></div>
          </div> : null}

          {step.id === "building" ? <div className="space-y-7">
            <div><p className={LABEL}>Number of storeys</p><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{[1, 2, 3, 4].map((count) => <Choice checked={draft.floorCount === count} detail={count === 1 ? "Ground only" : `Ground + ${count - 1}`} key={count} onClick={() => patch({ floorCount: count })} title={count === 1 ? "G" : `G+${count - 1}`} />)}</div></div>
            <div className="grid gap-5 sm:grid-cols-2"><Field label="Floor-to-floor height" hint="Concept presets applied to every floor. Local rules and structural design still require professional verification."><select className={CONTROL} id="floor-height" onChange={(event) => patch({ floorHeightM: Number(event.target.value) })} value={draft.floorHeightM}>{FLOOR_HEIGHT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><div className="border-l-2 border-[#c97940] bg-[#17120e] p-4 text-xs leading-6 text-[#aa9b8d]"><strong className="text-[#fff6ea]">Variation is automatic.</strong> BrickPilot assigns a fresh internal seed for every generation. The seed is stored with the study for audit and reproduction, but it is not a user input.</div></div>
            {draft.floorCount > 1 ? <div className="grid gap-5 border border-[#8e5a31]/40 bg-[#11100e] p-4 sm:grid-cols-2"><Field label="Stair family"><select className={CONTROL} onChange={(event) => patch({ stairFamily: event.target.value as IntakeDraft["stairFamily"] })} value={draft.stairFamily}><option value="dog_leg">Dog-leg</option><option value="straight">Straight flight</option></select></Field><Field label="Clear stair width" hint="Concept presets only. Final width, landings, rise/run and fire requirements must follow the applicable local code."><select className={CONTROL} id="stair-width" onChange={(event) => patch({ stairWidthMm: Number(event.target.value) })} value={draft.stairWidthMm}>{STAIR_WIDTH_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Toggle checked={draft.liftProvision} detail="Reserve conceptual space only; lift design remains professional scope." label="Provision for a future lift" onChange={(liftProvision) => patch({ liftProvision })} /></div> : <p className="border border-[#8e5a31]/35 p-4 text-xs leading-5 text-[#8f8275]">No stair core is required for a ground-only plan.</p>}
          </div> : null}

          {step.id === "rooms" ? <div className="space-y-7">
            <div className="grid gap-5 sm:grid-cols-2"><div className="border border-[#8e5a31]/40 bg-[#11100e] px-4"><NumberControl label="Household occupants" max={30} min={1} onChange={(occupants) => patch({ occupants })} value={draft.occupants} /></div><Toggle checked={draft.accessibilityRequired} detail="Prioritises a ground-floor bedroom, bathroom, route and clearances." label="Step-free / mobility access needed" onChange={(accessibilityRequired) => patch({ accessibilityRequired })} /></div>
            <div><p className={LABEL}>Ground-floor living and dining</p><div className="mt-2 grid gap-2 sm:grid-cols-2"><Choice checked={draft.socialSpaceMode === "separate"} detail="Two distinct rooms with a required direct opening between living and dining." onClick={() => patch({ socialSpaceMode: "separate" })} title="Separate living + dining" /><Choice checked={draft.socialSpaceMode === "combined"} detail="One larger shared hall sized for both living and dining functions." onClick={() => patch({ socialSpaceMode: "combined" })} title="Combined living / dining hall" /></div></div>
            <div><p className={LABEL}>Room programme by floor</p><div className="mt-2 grid gap-3 xl:grid-cols-2">{draft.programs.slice(0, draft.floorCount).map((program, level) => { const brief = floorProgramBrief(program); return <section className="border border-[#8e5a31]/45 bg-[#11100e]" key={level}><header className="flex items-center justify-between border-b border-[#8e5a31]/35 px-4 py-3"><div><p className="text-sm font-bold">{level === 0 ? "Ground floor" : `Floor ${level}`}</p><p className="mt-0.5 text-[0.62rem] uppercase tracking-[0.09em] text-[#74685d]">F{level}</p></div><span className="font-[family-name:var(--font-display)] text-2xl text-[#c97940]">{program.bedrooms}B · {program.bathrooms}W</span></header><div className="px-4"><NumberControl label="Bedrooms with attached bathroom" max={Math.min(8 - brief.bedroomsWithoutAttachedBathroom, 8 - brief.sharedBathrooms)} min={0} onChange={(attachedBedrooms) => updateProgramBrief(level, { attachedBedrooms })} value={brief.attachedBedrooms} /><p className="pb-2 text-[0.68rem] leading-5 text-[#8f8275]">Each creates a private bathroom with a required direct door from its bedroom.</p><NumberControl label="Bedrooms without attached bathroom" max={8 - brief.attachedBedrooms} min={0} onChange={(bedroomsWithoutAttachedBathroom) => updateProgramBrief(level, { bedroomsWithoutAttachedBathroom })} value={brief.bedroomsWithoutAttachedBathroom} /><NumberControl label="Additional / shared bathrooms" max={8 - brief.attachedBedrooms} min={0} onChange={(sharedBathrooms) => updateProgramBrief(level, { sharedBathrooms })} value={brief.sharedBathrooms} /><NumberControl label="Studies / offices" max={3} min={0} onChange={(studies) => updateProgram(level, { studies })} value={program.studies} /></div>{level > 0 ? <div className="p-3"><Toggle checked={program.balcony} label="Balcony on this floor" onChange={(balcony) => updateProgram(level, { balcony })} /></div> : null}</section>; })}</div></div>
            <div><p className={LABEL}>Ground-floor priorities</p><div className="mt-2 grid gap-2 sm:grid-cols-2"><Toggle checked={draft.includeParking} label="Covered parking" onChange={(includeParking) => patch({ includeParking })} /><Toggle checked={draft.includeUtility} label="Utility / laundry" onChange={(includeUtility) => patch({ includeUtility })} /><Toggle checked={draft.includePooja} label="Pooja / sacred room" onChange={(includePooja) => patch({ includePooja })} /><Toggle checked={draft.includeCourtyard} detail="Creates an exterior planning void, not leftover gap." label="Central courtyard" onChange={(includeCourtyard) => patch({ includeCourtyard })} /></div></div>
          </div> : null}

          {step.id === "architecture" ? <div className="space-y-7">
            <div><p className={LABEL}>Architectural character</p><p className="mt-2 max-w-3xl text-xs leading-5 text-[#8f8275]">This is a design constraint, not a decorative label. It controls the elevation vocabulary, shade, roof expression and the material brief sent to visualization.</p><div className="mt-3 grid gap-2 md:grid-cols-3">{([
              ["contemporary_tropical", "Contemporary tropical", "Deep shade, screened openings, planted edges and warm natural finishes."],
              ["kerala_contemporary", "Kerala contemporary", "Regional roof cues, rain protection and modern planning without imitation ornament."],
              ["warm_minimal", "Warm minimal", "Quiet planes, timber warmth and restrained, human-scaled detail."],
              ["courtyard_vernacular", "Courtyard vernacular", "An inward-looking shaded heart with regionally grounded proportions."],
              ["modernist", "Modernist", "Clear structural rhythm, strong horizontal lines and disciplined openings."],
            ] as const).map(([value, title, detail]) => <Choice checked={draft.architecturalStyle === value} detail={detail} key={value} onClick={() => patch({ architecturalStyle: value })} title={title} />)}</div></div>
            <div><p className={LABEL}>Built-form strategy</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{([
              ["stepped_terraces", "Stepped villa", "Sectioned setbacks on every level create shaded entry courts, terraces and a receding villa silhouette."],
              ["articulated_wings", "Courts + wings", "Use mixed room clusters, an entry recess and side courts to form practical connected villa wings."],
              ["courtyard", "Courtyard form", "Reserve an open-to-sky planning heart; this automatically includes a courtyard in the brief."],
              ["compact", "Compact", "A simpler, efficient envelope with architectural depth coming from shade and façade layers."],
            ] as const).map(([value, title, detail]) => <Choice checked={draft.formStrategy === value} detail={detail} key={value} onClick={() => patch({ formStrategy: value, ...(value === "courtyard" ? { includeCourtyard: true } : {}) })} title={title} />)}</div></div>
            <div className="grid gap-5 sm:grid-cols-2"><Field label="Roof character"><select className={CONTROL} onChange={(event) => patch({ roofCharacter: event.target.value as IntakeDraft["roofCharacter"] })} value={draft.roofCharacter}><option value="mixed">Mixed · shelter + terraces</option><option value="sloped">Predominantly sloped</option><option value="flat_parapet">Flat parapet</option></select></Field><Field label="Material direction"><select className={CONTROL} onChange={(event) => patch({ materialDirection: event.target.value as IntakeDraft["materialDirection"] })} value={draft.materialDirection}><option value="warm_natural">Warm natural · timber + stone + mineral plaster</option><option value="earthy_textured">Earthy textured · brick + lime + local stone</option><option value="light_mineral">Light mineral · pale plaster + restrained timber</option><option value="monochrome">Monochrome · concrete + dark metal + clear glazing</option></select></Field></div>
            <div className="border-l-2 border-[#c97940] bg-[#17120e] p-4 text-xs leading-6 text-[#aa9b8d]"><strong className="text-[#fff6ea]">Plot and house are separate decisions.</strong> A rectangular site may contain stepped, winged or courtyard-based built form. BrickPilot still keeps every room and support concept inside the verified buildable envelope.</div>
          </div> : null}

          {step.id === "budget" ? <div className="space-y-7">
            <div><p className={LABEL}>Finish and specification tier</p><div className="mt-2 grid gap-2 sm:grid-cols-3">{(["essential", "standard", "premium"] as const).map((tier) => <Choice checked={draft.qualityTier === tier} detail={tier === "essential" ? "Durable, cost-controlled baseline." : tier === "standard" ? "Balanced residential specification." : "Higher finish and services allowance."} key={tier} onClick={() => patch({ qualityTier: tier })} title={tier} />)}</div></div>
            <div className="grid gap-5 sm:grid-cols-2"><Field label={`Target low (${draft.currency})`} hint="Enter 0 if no target is set."><input className={CONTROL} min="0" onChange={(event) => patch({ budgetLowMajor: Number(event.target.value) })} step="10000" type="number" value={draft.budgetLowMajor} /></Field><Field label={`Target high (${draft.currency})`}><input className={CONTROL} min={draft.budgetLowMajor} onChange={(event) => patch({ budgetHighMajor: Number(event.target.value) })} step="10000" type="number" value={draft.budgetHighMajor} /></Field><Field label="Contingency (%)"><input className={CONTROL} max="50" min="0" onChange={(event) => patch({ contingencyPercent: Number(event.target.value) })} step="0.5" type="number" value={draft.contingencyPercent} /></Field><Field label="Tax assumption (%)" hint="Only apply a tax rate you have explicitly confirmed."><input className={CONTROL} max="50" min="0" onChange={(event) => patch({ taxPercent: Number(event.target.value) })} step="0.5" type="number" value={draft.taxPercent} /></Field></div>
            <div className="border-l-2 border-[#ff4e00] bg-[#17120e] p-4 text-xs leading-6 text-[#aa9b8d]"><strong className="text-[#fff6ea]">No false precision:</strong> the result is a sourced low / expected / high feasibility range. It lists inclusions, exclusions, locality, effective date and confidence—not a contractor quotation.</div>
          </div> : null}

          {step.id === "review" ? <Review capacity={capacity} draft={draft} requirements={requirements} /> : null}

          {error ? <p className="mt-6 border border-[#ff5b45]/70 bg-[#1a0c09] p-3 text-sm text-[#ff9e91]" role="alert">{error}</p> : null}
          <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[#8e5a31]/35 pt-5"><button className="inline-flex items-center gap-2 border border-[#8e5a31]/55 px-4 py-3 text-[0.67rem] font-bold uppercase tracking-[0.11em] text-[#b5a697] hover:border-[#c97940] hover:text-[#fff6ea] disabled:opacity-30" disabled={stepIndex === 0 || isSubmitting} onClick={() => setStepIndex((index) => Math.max(0, index - 1))} type="button"><ArrowLeft className="h-4 w-4" /> Back</button>{stepIndex < STEPS.length - 1 ? <button className="inline-flex items-center gap-3 bg-[#ff4e00] px-5 py-3 text-[0.68rem] font-extrabold uppercase tracking-[0.12em] text-white transition-transform hover:-translate-y-0.5 hover:bg-[#e94700] disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transform-none" disabled={!stepReady(step.id, draft)} onClick={() => setStepIndex((index) => Math.min(STEPS.length - 1, index + 1))} type="button">Confirm & continue <ArrowRight className="h-4 w-4" /></button> : <button className="inline-flex items-center gap-3 bg-[#ff4e00] px-5 py-3 text-[0.68rem] font-extrabold uppercase tracking-[0.12em] text-white transition-transform hover:-translate-y-0.5 hover:bg-[#e94700] disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transform-none" disabled={!requirements || capacity?.blocking || isSubmitting} onClick={submit} type="button">{isSubmitting ? "Solving the brief" : capacity?.blocking ? "Adjust brief to continue" : submitLabel}{isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Sparkles className="h-4 w-4" />}</button>}</footer>
        </div>
      </div>
    </section>
  );
}

function Review({ draft, requirements, capacity }: { draft: IntakeDraft; requirements: BuildingRequirements | null; capacity: ReturnType<typeof assessBriefCapacity> | null }) {
  const totalBedrooms = draft.programs.slice(0, draft.floorCount).reduce((sum, floor) => sum + floor.bedrooms, 0);
  const totalBathrooms = draft.programs.slice(0, draft.floorCount).reduce((sum, floor) => sum + floor.bathrooms, 0);
  const totalAttachedBathrooms = draft.programs.slice(0, draft.floorCount).reduce((sum, floor) => sum + floor.attachedBathrooms, 0);
  const budget = new Intl.NumberFormat(draft.locale || "en", { style: "currency", currency: draft.currency, maximumFractionDigits: 0, notation: "compact" });
  const items = [
    ["Project", draft.projectName],
    ["Location", `${draft.locality ? `${draft.locality}, ` : ""}${draft.adminArea} · ${draft.countryCode}`],
    ["Site", `${draft.siteWidth} × ${draft.siteDepth} ${draft.displayUnit === "metric" ? "m" : "ft"} · ${draft.roadEdges.join(" + ")} road access`],
    ["Building", draft.floorCount === 1 ? "Ground floor" : `G+${draft.floorCount - 1} · ${draft.stairFamily.replace("_", " ")} stair`],
    ["Household", `${draft.occupants} people${draft.accessibilityRequired ? " · step-free priorities" : ""}`],
    ["Private rooms", `${totalBedrooms} bedrooms · ${totalBathrooms} bathrooms · ${totalAttachedBathrooms} attached`],
    ["Social spaces", draft.socialSpaceMode === "combined" ? "Combined living / dining hall" : "Separate living + dining"],
    ["Architecture", `${draft.architecturalStyle.replaceAll("_", " ")} · ${draft.formStrategy.replaceAll("_", " ")}`],
    ["Budget target", draft.budgetHighMajor > 0 ? `${budget.format(draft.budgetLowMajor)} – ${budget.format(draft.budgetHighMajor)}` : "No target supplied"],
    ["Canonical output", requirements ? `${requirements.rooms.length} named spaces · ${requirements.relationships.length} relationship rules` : "Requires corrections"],
  ];
  return <div className="space-y-6"><div className="grid border-l border-t border-[#8e5a31]/40 sm:grid-cols-2">{items.map(([label, value]) => <div className="border-b border-r border-[#8e5a31]/40 p-4" key={label}><p className="text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[#8f8275]">{label}</p><p className="mt-1.5 text-sm font-semibold leading-5 text-[#fff6ea]">{value}</p></div>)}</div>{capacity ? <section className={`border p-4 ${capacity.blocking ? "border-[#ff5b45]/70 bg-[#1a0c09]" : capacity.floors.some((floor) => floor.status === "tight") ? "border-[#d69b35]/65 bg-[#17140d]" : "border-[#38765a]/60 bg-[#0e1712]"}`}><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[0.62rem] font-extrabold uppercase tracking-[0.12em] text-[#c97940]">Programme capacity check</p><p className="mt-1 text-sm font-semibold">{capacity.blocking ? "The brief needs more usable area" : capacity.floors.some((floor) => floor.status === "tight") ? "Feasible, but tightly programmed" : "Minimum room areas fit the envelope"}</p></div><span className="text-[0.6rem] font-bold uppercase tracking-[0.1em] text-[#8f8275]">Area preflight · topology follows</span></div><p className="mt-3 max-w-3xl text-[0.68rem] leading-5 text-[#9f9183]"><strong className="text-[#d7c9ba]">The percentage is space demand, not a quality score:</strong> minimum requested room area divided by usable floor area. Topology is checked next—it means every room has the required connections and can be reached through valid doors, openings and stairs.</p><div className="mt-4 grid gap-2 sm:grid-cols-2">{capacity.floors.map((floor) => <div className="border border-[#8e5a31]/30 p-3" key={floor.floorId}><div className="flex items-center justify-between gap-3 text-xs"><span>{floor.label}</span><strong className={floor.status === "over_capacity" ? "text-[#ff806f]" : floor.status === "tight" ? "text-[#e4bd6a]" : "text-[#7bc79e]"}>{Number.isFinite(floor.utilization) ? `${Math.round(floor.utilization * 100)}%` : "Blocked"}</strong></div><p className="mt-1 text-[0.65rem] leading-5 text-[#8f8275]">Minimum rooms {(floor.minimumRoomAreaMm2 / 1_000_000).toFixed(1)} m² · usable {(floor.usableAreaMm2 / 1_000_000).toFixed(1)} m²</p></div>)}</div>{capacity.actions.length ? <ul className="mt-4 list-disc space-y-1 pl-5 text-xs leading-5 text-[#b5a697]">{capacity.actions.map((action) => <li key={action}>{action}</li>)}</ul> : null}</section> : null}<div className="grid gap-3 sm:grid-cols-[auto_1fr]"><Ruler className="mt-1 h-5 w-5 text-[#c97940]" /><div><p className="text-sm font-semibold">What happens next</p><p className="mt-1 text-xs leading-6 text-[#9f9183]">BrickPilot assigns an internal variation seed, generates a fixed candidate set, normalizes shared walls, places doors, windows and stairs, then tests reachability and geometry. If no plan is feasible, the result names the constraints to change.</p></div></div></div>;
}
