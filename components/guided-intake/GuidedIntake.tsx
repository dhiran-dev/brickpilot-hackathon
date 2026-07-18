"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Briefcase, Building2, Check, CircleDollarSign, Home, LoaderCircle, RotateCcw, Ruler, Sparkles, type LucideIcon } from "lucide-react";

import { BUILDING_TYPE_OPTIONS, currentBuildingRequirementsSchema, legacyBuildingRequirementsSchema, type CurrentBuildingRequirements, type LegacyBuildingRequirements, type ReadableBuildingRequirements, type ShadeStructureRequirement } from "@/lib/building/requirements";
import { ARCHITECTURAL_STYLE_PREVIEWS, FORM_STRATEGY_PREVIEWS, constrainArchitectureChoices, formStrategyPatch, type ArchitecturePreviewOption } from "@/components/guided-intake/architecture-options";
import { applyRegionalPrefill, applyShadeStructureChoice, assessBriefCapacity, createCurrentRequirements, createRequirements, DEFAULT_INTAKE_DRAFT, draftFromRequirements, floorProgramBrief, normalizeFloorProgram, updateFloorProgramBrief, upgradeLegacyFloorProgram, type FloorProgram, type FloorProgramBrief, type IntakeDraft } from "@/components/guided-intake/model";
import { adminAreaForRegion, CURRENCY_OPTIONS, LOCALE_OPTIONS, REGION_OPTIONS, regionForCountry } from "@/components/guided-intake/region-options";
import { clearDraft, loadDraft, resolveDraftHydration, saveDraft } from "@/lib/design/draft-storage";
import { resolveRegionalPack } from "@/lib/design/regional-packs";

const STEPS = [
  { id: "project", label: "Project", question: "What are we planning?" },
  { id: "region", label: "Region", question: "Where will it be built?" },
  { id: "site", label: "Site", question: "What controls the plot?" },
  { id: "building", label: "Levels", question: "How should the house stack?" },
  { id: "rooms", label: "Rooms", question: "Who needs which spaces?" },
  { id: "architecture", label: "Style", question: "What architectural character should shape it?" },
  { id: "budget", label: "Budget", question: "What should the estimate respect?" },
  { id: "review", label: "Review", question: "Is this the brief to solve?" },
] as const;

const BUILDING_TYPE_ICONS: Record<(typeof BUILDING_TYPE_OPTIONS)[number]["value"], LucideIcon> = {
  detached_house: Home,
  apartment: Building2,
  corporate_commercial: Briefcase,
};

const CONTROL = "mt-2 min-h-11 w-full border border-[#8e5a31]/60 bg-[#12100e] px-3 py-2.5 text-sm text-[#fff6ea] outline-none transition-colors placeholder:text-[#655d55] focus:border-[#fff6ea] focus:ring-1 focus:ring-[#fff6ea]";
const LABEL = "text-[0.65rem] font-extrabold uppercase tracking-[0.12em] text-[#c97940]";
const ACTION_PRIMARY = "inline-flex min-h-10 items-center gap-2 bg-[#ff4e00] px-4 py-2.5 text-[0.8125rem] font-extrabold uppercase tracking-[0.12em] text-[#090908] transition-transform hover:-translate-y-0.5 hover:bg-[#e94700] disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transform-none";
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
  initialValue?: ReadableBuildingRequirements;
  onChange?: (requirements: CurrentBuildingRequirements) => void;
  onSubmit: (requirements: CurrentBuildingRequirements, legacyRequirements: LegacyBuildingRequirements) => void | Promise<void>;
  isSubmitting?: boolean;
  draftId: string;
  submitLabel?: string;
  className?: string;
};

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="block"><span className={LABEL}>{label}</span>{children}{hint ? <span className="mt-1.5 block text-[0.68rem] leading-5 text-[#8f8275]">{hint}</span> : null}</label>;
}

function NumberControl({ label, value, min, max, suffix, onChange }: { label: string; value: number; min: number; max: number; suffix?: string; onChange: (value: number) => void }) {
  return <div className="flex items-center justify-between gap-3 border-b border-[#8e5a31]/30 py-3"><span className="text-sm text-[#cbbcab]">{label}</span><div className="flex items-center"><button aria-label={`Decrease ${label}`} className="grid h-11 w-11 place-items-center border border-[#8e5a31]/50 text-lg text-[#c97940] hover:bg-[#20160f] disabled:opacity-30" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} type="button">−</button><output className="min-w-12 px-2 text-center font-[family-name:var(--font-display)] text-xl">{value}{suffix}</output><button aria-label={`Increase ${label}`} className="grid h-11 w-11 place-items-center border border-[#8e5a31]/50 text-lg text-[#c97940] hover:bg-[#20160f] disabled:opacity-30" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} type="button">+</button></div></div>;
}

function Choice({ checked, title, detail, disabled, badge, onClick }: { checked: boolean; title: string; detail: string; disabled?: boolean; badge?: string; onClick: () => void }) {
  return <button aria-pressed={checked} className={`relative min-h-28 border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fff6ea] ${disabled ? "cursor-not-allowed border-[#45392f]/35 bg-[#0b0a09] text-[#655d55]" : checked ? "border-[#ff4e00]/85 bg-[#1c130c] text-[#fff6ea]" : "border-[#8e5a31]/30 bg-[#11100e] text-[#b5a697] hover:border-[#c97940]/60 hover:text-[#fff6ea]"}`} disabled={disabled} onClick={onClick} type="button"><span className="flex items-start justify-between gap-2"><span className="block text-[0.7rem] font-extrabold uppercase tracking-[0.1em]">{title}</span>{checked ? <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#ff8b4d]" /> : null}</span><span className="mt-2 block text-xs leading-5 opacity-80">{detail}</span>{badge ? <span className="absolute right-2 top-2 border border-current px-1.5 py-0.5 text-[0.52rem] font-bold uppercase tracking-[0.08em]">{badge}</span> : null}</button>;
}

function BuildingTypeCard({ icon: Icon, title, description, checked, disabled, badge, onClick }: { icon: LucideIcon; title: string; description: string; checked: boolean; disabled?: boolean; badge?: string; onClick: () => void }) {
  return (
    <button aria-pressed={checked} className={`group relative flex min-h-44 flex-col border p-5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fff6ea] ${disabled ? "cursor-not-allowed border-[#45392f]/30 bg-[#0b0a09]" : checked ? "border-[#ff4e00] bg-[#1e130c]" : "border-[#8e5a31]/30 bg-[#11100e] hover:border-[#c97940]/70 hover:bg-[#151310]"}`} disabled={disabled} onClick={onClick} type="button">
      <div className="flex items-start justify-between gap-3">
        <span className={`grid h-11 w-11 place-items-center border ${disabled ? "border-[#45392f]/30 text-[#554b40]" : checked ? "border-[#ff4e00]/60 bg-[#ff4e00]/10 text-[#ff8b4d]" : "border-[#8e5a31]/35 text-[#c97940] group-hover:border-[#c97940]/60"}`}><Icon aria-hidden="true" className="h-5 w-5" /></span>
        {checked ? <span className="grid h-5 w-5 place-items-center bg-[#ff4e00] text-[#090908]"><Check aria-hidden="true" className="h-3 w-3" /><span className="sr-only">Selected</span></span> : badge ? <span className="border border-[#5e5146]/40 px-2 py-1 text-[0.55rem] font-bold uppercase tracking-[0.12em] text-[#776a5d]">{badge}</span> : null}
      </div>
      <div className="mt-auto pt-6">
        <p className={`font-[family-name:var(--font-display)] text-2xl font-normal tracking-[-0.02em] ${disabled ? "text-[#5f564c]" : "text-[#fff6ea]"}`}>{title}</p>
        <p className={`mt-1.5 text-xs leading-5 ${disabled ? "text-[#554b40]" : "text-[#9f9183]"}`}>{description}</p>
      </div>
    </button>
  );
}

export function ArchitectureOptionCard<Value extends string>({
  option,
  checked,
  suggested,
  suggestionLabel,
  imageFailed = false,
  radioName,
  onSelect,
  onImageError,
}: {
  option: ArchitecturePreviewOption<Value>;
  checked: boolean;
  suggested?: boolean;
  suggestionLabel?: string;
  imageFailed?: boolean;
  radioName: string;
  onSelect: (value: Value) => void;
  onImageError: (source: string) => void;
}) {
  const disabled = !option.available;

  return (
    <label aria-disabled={disabled} className={`group relative flex flex-col border transition-colors ${disabled ? "cursor-not-allowed border-[#45392f]/35 bg-[#0b0a09]" : checked ? "cursor-pointer border-[#ff4e00] bg-[#1c130c] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#fff6ea]" : "cursor-pointer border-[#8e5a31]/30 bg-[#11100e] hover:border-[#c97940]/60 hover:bg-[#151310] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#fff6ea]"}`}>
      <input checked={!disabled && checked} className="sr-only" disabled={disabled} name={radioName} onChange={() => { if (!disabled) onSelect(option.value); }} type="radio" value={option.value} />
      {disabled ? <span className="absolute right-3 top-3 z-10 border border-[#8e5a31]/60 bg-[#0b0a09]/90 px-2 py-1 text-[0.55rem] font-extrabold uppercase tracking-[0.12em] text-[#b5a697]">Coming soon</span> : null}
      {!imageFailed ? <span className={`block aspect-[16/10] overflow-hidden border-b border-[#8e5a31]/25 bg-[#11100e] ${disabled ? "opacity-45 grayscale" : ""}`}><img alt={option.imageAlt} className="h-full w-full object-cover" draggable={false} onError={() => onImageError(option.imageSrc)} src={option.imageSrc} /></span> : null}
      <span className="flex flex-1 flex-col p-4">
        <span className="flex items-start justify-between gap-2">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`text-[0.55rem] font-bold uppercase tracking-[0.14em] ${disabled ? "text-[#655d55]" : "text-[#c97940]"}`}>{option.plate}</span>
            {!disabled && suggested && suggestionLabel ? <span className="whitespace-nowrap border border-[#c97940]/35 px-1.5 py-0.5 text-[0.52rem] font-bold uppercase tracking-[0.08em] text-[#c97940]">Suggested for {suggestionLabel}</span> : null}
          </span>
          {!disabled && checked ? <span className="grid h-5 w-5 shrink-0 place-items-center bg-[#ff4e00] text-[#090908]"><Check aria-hidden="true" className="h-3 w-3" /><span className="sr-only">Selected</span></span> : null}
        </span>
        <span className={`mt-2 block text-sm font-semibold ${disabled ? "text-[#776a5d]" : "text-[#fff6ea]"}`}>{option.title}</span>
        <span className={`mt-1 block text-xs leading-5 ${disabled ? "text-[#5f564c]" : "text-[#9f9183]"}`}>{option.detail}</span>
      </span>
    </label>
  );
}

export function ArchitectureReferencePicker<Value extends string>({
  legend,
  description,
  name,
  options,
  value,
  suggestedValue,
  suggestionLabel,
  onChange,
}: {
  legend: string;
  description: string;
  name: string;
  options: readonly ArchitecturePreviewOption<Value>[];
  value: Value;
  suggestedValue?: Value;
  suggestionLabel?: string;
  onChange: (value: Value) => void;
}) {
  const descriptionId = useId();
  const radioName = `${name}-${useId().replaceAll(":", "")}`;
  const [failedSources, setFailedSources] = useState<ReadonlySet<string>>(() => new Set());
  const selected = options.find((option) => option.available && option.value === value) ?? options.find((option) => option.available);
  if (!selected) return null;

  return (
    <fieldset aria-describedby={descriptionId} className="min-w-0 border-0 p-0">
      <legend className="text-sm font-semibold text-[#fff6ea]">{legend}</legend>
      <p className="mt-1.5 max-w-2xl text-xs leading-5 text-[#9f9183]" id={descriptionId}>{description}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {options.map((option) => <ArchitectureOptionCard checked={option.available && option.value === value} imageFailed={failedSources.has(option.imageSrc)} key={option.value} onImageError={(source) => setFailedSources((current) => new Set(current).add(source))} onSelect={onChange} option={option} radioName={radioName} suggested={option.value === suggestedValue} suggestionLabel={suggestionLabel} />)}
      </div>
      <p aria-live="polite" className="sr-only">Selected {selected.title}. {selected.detail}</p>
    </fieldset>
  );
}

type ActionBarProps = {
  backDisabled: boolean;
  ready: boolean;
  isLast: boolean;
  isSubmitting: boolean;
  blocking?: boolean;
  submitDisabled: boolean;
  submitLabel: string;
  onBack: () => void;
  onContinue: () => void;
  onSubmit: () => void;
};

function BackAction({ backDisabled, onBack }: ActionBarProps) {
  return <button className="inline-flex min-h-10 shrink-0 items-center gap-2 border border-[#8e5a31]/55 px-3 py-2.5 text-[0.8125rem] font-bold uppercase tracking-[0.11em] text-[#b5a697] hover:border-[#c97940] hover:text-[#fff6ea] disabled:opacity-30" disabled={backDisabled} onClick={onBack} type="button"><ArrowLeft className="h-4 w-4" /> Back</button>;
}

function PrimaryAction({ ready, isLast, isSubmitting, blocking, submitDisabled, submitLabel, onContinue, onSubmit }: ActionBarProps) {
  return !isLast
    ? <button className={`${ACTION_PRIMARY} shrink-0`} disabled={!ready} onClick={onContinue} type="button">Confirm &amp; continue <ArrowRight className="h-4 w-4" /></button>
    : <button className={`${ACTION_PRIMARY} shrink-0`} disabled={submitDisabled} onClick={onSubmit} type="button">{isSubmitting ? "Solving the brief" : blocking ? "Adjust brief to continue" : submitLabel}{isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Sparkles className="h-4 w-4" />}</button>;
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

export function GuidedIntake({ initialValue, onChange, onSubmit, isSubmitting = false, draftId, submitLabel = "Generate feasible plan", className }: GuidedIntakeProps) {
  const [draft, setDraft] = useState<IntakeDraft>(() => constrainArchitectureChoices(initialValue ? draftFromRequirements(initialValue) : DEFAULT_INTAKE_DRAFT));
  const [stepIndex, setStepIndex] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const step = STEPS[stepIndex];
  const unitLabel = draft.displayUnit === "metric" ? "m" : "ft";
  const currentRegion = regionForCountry(draft.countryCode);
  const currentAdminArea = adminAreaForRegion(currentRegion, draft.adminArea);
  const regionalResolution = resolveRegionalPack(draft.countryCode, draft.adminArea);
  const legacyRequirements = useMemo(() => {
    try { return createRequirements(draft); } catch { return null; }
  }, [draft]);
  const requirements = useMemo(() => {
    try { return createCurrentRequirements(draft); } catch { return null; }
  }, [draft]);
  const capacity = useMemo(() => legacyRequirements ? assessBriefCapacity(legacyRequirements) : null, [legacyRequirements]);

  useEffect(() => {
    try {
      const authoritativeValue = initialValue ? draftFromRequirements(initialValue) : undefined;
      const stored = loadDraft<IntakeDraft & { roadEdge?: IntakeDraft["roadEdges"][number] }>(window.localStorage, draftId);
      const hydration = resolveDraftHydration({ authoritativeValue, storedDraft: stored, defaultValue: DEFAULT_INTAKE_DRAFT });
      if (hydration.source === "draft") {
        const storedDraft = hydration.value as IntakeDraft & { roadEdge?: IntakeDraft["roadEdges"][number] };
        setDraft(constrainArchitectureChoices({
          ...DEFAULT_INTAKE_DRAFT,
          ...storedDraft,
          roadEdges: storedDraft.roadEdges?.length ? storedDraft.roadEdges : storedDraft.roadEdge ? [storedDraft.roadEdge] : DEFAULT_INTAKE_DRAFT.roadEdges,
          floorHeightM: FLOOR_HEIGHT_OPTIONS.some(([value]) => value === storedDraft.floorHeightM) ? storedDraft.floorHeightM : DEFAULT_INTAKE_DRAFT.floorHeightM,
          stairWidthMm: STAIR_WIDTH_OPTIONS.some(([value]) => value === storedDraft.stairWidthMm) ? storedDraft.stairWidthMm : DEFAULT_INTAKE_DRAFT.stairWidthMm,
          setbacks: { ...DEFAULT_INTAKE_DRAFT.setbacks, ...storedDraft.setbacks },
          socialSpaceMode: storedDraft.socialSpaceMode ?? DEFAULT_INTAKE_DRAFT.socialSpaceMode,
          programs: DEFAULT_INTAKE_DRAFT.programs.map((fallback, level) => (stored?.version ?? 0) >= 2
            ? normalizeFloorProgram(storedDraft.programs?.[level], fallback)
            : upgradeLegacyFloorProgram(storedDraft.programs?.[level], fallback)),
        }));
      } else {
        setDraft(constrainArchitectureChoices(hydration.value));
      }
      setStepIndex(Math.max(0, Math.min(STEPS.length - 1, hydration.stepIndex)));
      setError(null);
    } catch {
      // Local progress is an enhancement; malformed storage is ignored.
      setDraft(constrainArchitectureChoices(initialValue ? draftFromRequirements(initialValue) : DEFAULT_INTAKE_DRAFT));
      setStepIndex(0);
    }
    setHydrated(true);
  }, [draftId, initialValue]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      saveDraft(window.localStorage, draftId, { version: INTAKE_STORAGE_VERSION, draft, stepIndex }, { title: draft.projectName });
    } catch {
      // Local progress is an enhancement; generation remains available if storage is full.
    }
  }, [draft, draftId, hydrated, stepIndex]);

  useEffect(() => {
    if (requirements) onChange?.(requirements);
  }, [onChange, requirements]);

  const stepperRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const list = stepperRef.current;
    const activeStep = list?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!list || !activeStep || list.scrollWidth <= list.clientWidth) return;
    const listRect = list.getBoundingClientRect();
    const stepRect = activeStep.getBoundingClientRect();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollTo({ left: list.scrollLeft + (stepRect.left - listRect.left) - (list.clientWidth - stepRect.width) / 2, behavior: reducedMotion ? "auto" : "smooth" });
  }, [stepIndex]);

  function patch(next: Partial<IntakeDraft>) {
    setDraft((current) => constrainArchitectureChoices({ ...current, ...next }));
    setError(null);
  }

  function changeCountry(countryCode: string) {
    const region = regionForCountry(countryCode);
    const adminArea = region.adminAreas[0];
    patch(applyRegionalPrefill({
      ...draft,
      countryCode: region.countryCode,
      adminArea: adminArea.value,
      locality: adminArea.localities[0].value,
      currency: region.defaultCurrency,
      locale: region.defaultLocale,
    }, region.countryCode, adminArea.value));
  }

  function changeAdminArea(adminAreaValue: string) {
    const adminArea = adminAreaForRegion(currentRegion, adminAreaValue);
    patch(applyRegionalPrefill({ ...draft, adminArea: adminArea.value, locality: adminArea.localities[0].value }, draft.countryCode, adminArea.value));
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

  function updateShadeStructure(location: ShadeStructureRequirement["location"], type: ShadeStructureRequirement["type"] | "none") {
    setDraft((current) => applyShadeStructureChoice(current, location, type));
    setError(null);
  }

  function shadeType(location: ShadeStructureRequirement["location"]) {
    return draft.shadeStructures.find((shade) => shade.location === location)?.type ?? "none";
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
    const parsed = currentBuildingRequirementsSchema.safeParse(createCurrentRequirements(draft));
    const parsedLegacy = legacyBuildingRequirementsSchema.safeParse(createRequirements(draft));
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "The brief is incomplete."); return; }
    if (!parsedLegacy.success) { setError(parsedLegacy.error.issues[0]?.message ?? "The brief is incomplete."); return; }
    setError(null);
    await onSubmit(parsed.data, parsedLegacy.data);
  }

  function reset() {
    setDraft(constrainArchitectureChoices(DEFAULT_INTAKE_DRAFT));
    setStepIndex(0);
    setError(null);
    try { clearDraft(window.localStorage, draftId); } catch {
      // Resetting the visible form must still work when browser storage is unavailable.
    }
  }

  const goToPreviousStep = () => setStepIndex((index) => Math.max(0, index - 1));
  const goToNextStep = () => setStepIndex((index) => Math.min(STEPS.length - 1, index + 1));
  const sharedActionBarProps = {
    backDisabled: stepIndex === 0 || isSubmitting,
    blocking: capacity?.blocking,
    isLast: stepIndex === STEPS.length - 1,
    isSubmitting,
    onBack: goToPreviousStep,
    onContinue: goToNextStep,
    onSubmit: submit,
    ready: stepReady(step.id, draft),
    submitDisabled: !requirements || Boolean(capacity?.blocking) || isSubmitting,
    submitLabel,
  };

  return (
    <section className={`guided-intake border border-[#8e5a31]/45 bg-[#0d0c0a] text-[#fff6ea] ${className ?? ""}`}>
      <div>
        <div className="sticky top-0 z-20 border-b border-[#8e5a31]/30 bg-[#0a0908]">
          <div className="flex items-center gap-2 p-2">
            <p className="hidden shrink-0 whitespace-nowrap px-2 text-[0.65rem] font-extrabold uppercase tracking-[0.14em] text-[#ff6a1f] md:block">Guided residential brief</p>
            <BackAction {...sharedActionBarProps} />
            <nav aria-label="Brief steps" className="min-w-0 flex-1">
              <ol className="intake-stepper flex divide-x divide-[#8e5a31]/15 overflow-x-auto" ref={stepperRef}>
                {STEPS.map((item, index) => { const active = index === stepIndex; const complete = index < stepIndex && stepReady(item.id, draft); return <li className="shrink-0" key={item.id}><button aria-current={active ? "step" : undefined} aria-label={item.label} className={`relative flex items-center justify-center gap-2.5 px-3 py-2.5 transition-colors ${active ? "bg-[#17110c] text-[#fff6ea]" : complete ? "text-[#c5b5a5] hover:text-[#fff6ea]" : "text-[#776a5d] hover:text-[#c5b5a5]"}`} onClick={() => setStepIndex(index)} title={item.label} type="button"><span className={`grid h-6 w-6 shrink-0 place-items-center border text-[0.6rem] font-bold ${complete ? "border-[#4a8d68]/70 text-[#77c497]" : active ? "border-[#ff4e00] text-[#ff8b4d]" : "border-[#4a4037]/70"}`}>{complete ? <Check className="h-3 w-3" /> : String(index + 1).padStart(2, "0")}</span>{active ? <span className="whitespace-nowrap text-[0.65rem] font-bold uppercase tracking-[0.12em]">{item.label}</span> : null}{active ? <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-[#ff4e00]" /> : null}</button></li>; })}
              </ol>
            </nav>
            <button aria-label="Reset brief" className="inline-flex min-h-10 shrink-0 items-center gap-2 border border-[#8e5a31]/45 px-3 py-2 text-[0.62rem] font-bold uppercase tracking-[0.1em] text-[#a8998b] transition hover:border-[#c97940] hover:text-[#fff6ea]" onClick={reset} type="button"><RotateCcw className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Reset</span></button>
            <PrimaryAction {...sharedActionBarProps} />
          </div>
        </div>

        <div className="mx-auto w-full max-w-5xl p-5 sm:p-7">
          <div className="mb-7"><p className="text-[0.61rem] font-bold uppercase tracking-[0.13em] text-[#8f8275]">Step {stepIndex + 1} of {STEPS.length}</p><h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-normal tracking-[-0.025em]">{step.question}</h2></div>

          {step.id === "project" ? <div className="space-y-7">
            <Field label="Project name"><input autoFocus className={CONTROL} maxLength={120} onChange={(event) => patch({ projectName: event.target.value })} placeholder="The Nair family home" value={draft.projectName} /></Field>
            <div><p className={LABEL}>Building type</p><div className="mt-3 grid gap-3 md:grid-cols-3">{BUILDING_TYPE_OPTIONS.map((option) => <BuildingTypeCard badge={option.available ? undefined : option.note} checked={option.value === draft.buildingType} description={option.available ? "A single-family bungalow or multi-level villa, from ground-only through G+3." : option.value === "apartment" ? "Multi-unit residential planning is not enabled yet." : "Office, retail and institutional rule packs are coming later."} disabled={!option.available} icon={BUILDING_TYPE_ICONS[option.value]} key={option.value} onClick={() => option.available && patch({ buildingType: "detached_house" })} title={option.label} />)}</div></div>
            <div className="border-l-2 border-[#c97940] bg-[#17120e] p-4 text-xs leading-6 text-[#aa9b8d]"><strong className="text-[#fff6ea]">Scope:</strong> BrickPilot produces a residential concept and feasibility package. A licensed architect and engineers must verify it before permits or construction.</div>
          </div> : null}

          {step.id === "region" ? <div className="space-y-7">
            {regionalResolution.warning ? <p className="border border-[#d69b35]/65 bg-[#17140d] p-3 text-xs leading-5 text-[#e4bd6a]" role="status">{regionalResolution.warning.message}</p> : null}
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Country / region" hint="The ISO country code is stored automatically with the selection."><select className={CONTROL} id="region-country" onChange={(event) => changeCountry(event.target.value)} value={draft.countryCode}>{!REGION_OPTIONS.some((region) => region.countryCode === draft.countryCode) ? <option value={draft.countryCode}>General / other region ({draft.countryCode})</option> : null}{REGION_OPTIONS.map((region) => <option key={region.countryCode} value={region.countryCode}>{region.label} · {region.countryCode}</option>)}</select></Field>
              <Field label="State / province / emirate"><select className={CONTROL} id="region-admin-area" onChange={(event) => changeAdminArea(event.target.value)} value={draft.adminArea}>{!currentRegion.adminAreas.some((adminArea) => adminArea.value === draft.adminArea) ? <option value={draft.adminArea}>General / other region ({draft.adminArea})</option> : null}{currentRegion.adminAreas.map((adminArea) => <option key={adminArea.value} value={adminArea.value}>{adminArea.label}</option>)}</select></Field>
              <Field label="City / locality"><select className={CONTROL} id="region-locality" onChange={(event) => patch({ locality: event.target.value })} value={draft.locality}>{!currentAdminArea.localities.some((locality) => locality.value === draft.locality) ? <option value={draft.locality}>General / other locality ({draft.locality})</option> : null}{currentAdminArea.localities.map((locality) => <option key={locality.value} value={locality.value}>{locality.label}</option>)}</select></Field>
              <Field label="Currency" hint="Choose the native project currency. Unsupported rate regions remain unavailable rather than being converted silently."><select className={CONTROL} id="region-currency" onChange={(event) => patch({ currency: event.target.value })} value={draft.currency}>{!CURRENCY_OPTIONS.some(([currency]) => currency === draft.currency) ? <option value={draft.currency}>General / other currency ({draft.currency})</option> : null}{CURRENCY_OPTIONS.map(([currency, label]) => <option key={currency} value={currency}>{label}</option>)}</select></Field>
              <Field label="Formatting locale" hint="Controls digit grouping, currency symbols and number presentation."><select className={CONTROL} id="region-locale" onChange={(event) => patch({ locale: event.target.value })} value={draft.locale}>{!LOCALE_OPTIONS.some(([locale]) => locale === draft.locale) ? <option value={draft.locale}>General formatting ({draft.locale})</option> : null}{LOCALE_OPTIONS.map(([locale, label]) => <option key={locale} value={locale}>{label}</option>)}</select></Field>
            </div>
            <div><p className={LABEL}>Display measurements</p><div className="mt-2 grid grid-cols-2 gap-2"><Choice checked={draft.displayUnit === "metric"} detail="Metres and square metres. Canonical geometry remains integer millimetres." onClick={() => changeUnits("metric")} title="Metric" /><Choice checked={draft.displayUnit === "imperial"} detail="Feet and square feet for display. Stored geometry remains millimetres." onClick={() => changeUnits("imperial")} title="Imperial" /></div></div>
            <div className="flex gap-3 bg-[#11100e] p-4"><CircleDollarSign className="mt-0.5 h-5 w-5 shrink-0 text-[#c97940]" /><p className="text-xs leading-5 text-[#9f9183]">Cost will only be shown when a reviewed rate pack supports <strong className="text-[#fff6ea]">{draft.locality || draft.adminArea}, {draft.currency}</strong>. Any fallback is labelled with its source, effective date and confidence.</p></div>
          </div> : null}

          {step.id === "site" ? <div className="space-y-7">
            <div className="grid gap-5 sm:grid-cols-2"><Field label={`Plot width (${unitLabel})`}><input className={CONTROL} min="1" onChange={(event) => patch({ siteWidth: Number(event.target.value) })} step="0.1" type="number" value={draft.siteWidth} /></Field><Field label={`Plot depth (${unitLabel})`}><input className={CONTROL} min="1" onChange={(event) => patch({ siteDepth: Number(event.target.value) })} step="0.1" type="number" value={draft.siteDepth} /></Field></div>
            <div className="grid gap-5 sm:grid-cols-[1.4fr_1fr]"><div><p className={LABEL}>Road edges · select all that apply</p><div aria-label="Road edges" className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4" role="group">{DIRECTIONS.map((direction) => { const checked = draft.roadEdges.includes(direction); return <button aria-pressed={checked} className={`border px-3 py-3 text-[0.65rem] font-extrabold uppercase tracking-[0.1em] transition-colors ${checked ? "border-[#ff4e00] bg-[#25150e] text-[#fff6ea]" : "border-[#8e5a31]/45 bg-[#11100e] text-[#8f8275] hover:border-[#c97940]"}`} key={direction} onClick={() => toggleRoadEdge(direction)} type="button">{direction}</button>; })}</div><p className="mt-1.5 text-[0.68rem] leading-5 text-[#8f8275]">At least one road edge is required. Main facing is preferred for the entrance when it also has road access.</p></div><Field label="Main facing"><select className={CONTROL} onChange={(event) => patch({ facing: event.target.value as IntakeDraft["facing"] })} value={draft.facing}>{DIRECTIONS.map((direction) => <option key={direction} value={direction}>{direction[0].toUpperCase() + direction.slice(1)}</option>)}</select></Field></div>
            <div><p className={LABEL}>Setbacks ({unitLabel})</p><div className="mt-2 grid gap-3 bg-[#11100e] p-4 sm:grid-cols-4">{(["north", "east", "south", "west"] as const).map((direction) => <Field key={direction} label={direction}><input className={CONTROL} min="0" onChange={(event) => patch({ setbacks: { ...draft.setbacks, [direction]: Number(event.target.value) } })} step="0.1" type="number" value={draft.setbacks[direction]} /></Field>)}</div></div>
            <div><p className={LABEL}>Plot geometry</p><div className="mt-2 grid gap-2 sm:grid-cols-2"><Choice checked detail="Supported for verified topology, setbacks and drawing output." onClick={() => undefined} title="Rectangular plot" /><Choice badge="Coming soon" checked={false} detail="Irregular boundaries are not yet accepted for generation." disabled onClick={() => undefined} title="Irregular plot" /></div></div>
          </div> : null}

          {step.id === "building" ? <div className="space-y-7">
            <div><p className={LABEL}>Number of storeys</p><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{[1, 2, 3, 4].map((count) => <Choice checked={draft.floorCount === count} detail={count === 1 ? "Ground only" : `Ground + ${count - 1}`} key={count} onClick={() => patch({ floorCount: count })} title={count === 1 ? "G" : `G+${count - 1}`} />)}</div></div>
            <div className="grid gap-5 sm:grid-cols-2"><Field label="Floor-to-floor height" hint="Concept presets applied to every floor. Local rules and structural design still require professional verification."><select className={CONTROL} id="floor-height" onChange={(event) => patch({ floorHeightM: Number(event.target.value) })} value={draft.floorHeightM}>{FLOOR_HEIGHT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><div className="border-l-2 border-[#c97940] bg-[#17120e] p-4 text-xs leading-6 text-[#aa9b8d]"><strong className="text-[#fff6ea]">Variation is automatic.</strong> BrickPilot assigns a fresh internal seed for every generation. The seed is stored with the study for audit and reproduction, but it is not a user input.</div></div>
            {draft.floorCount > 1 ? <div className="grid gap-5 bg-[#11100e] p-4 sm:grid-cols-2"><Field label="Stair family"><select className={CONTROL} onChange={(event) => patch({ stairFamily: event.target.value as IntakeDraft["stairFamily"] })} value={draft.stairFamily}><option value="dog_leg">Dog-leg</option><option value="straight">Straight flight</option></select></Field><Field label="Clear stair width" hint="Concept presets only. Final width, landings, rise/run and fire requirements must follow the applicable local code."><select className={CONTROL} id="stair-width" onChange={(event) => patch({ stairWidthMm: Number(event.target.value) })} value={draft.stairWidthMm}>{STAIR_WIDTH_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Toggle checked={draft.liftProvision} detail="Reserve conceptual space only; lift design remains professional scope." label="Provision for a future lift" onChange={(liftProvision) => patch({ liftProvision })} /></div> : <p className="bg-[#11100e] p-4 text-xs leading-5 text-[#8f8275]">No stair core is required for a ground-only plan.</p>}
          </div> : null}

          {step.id === "rooms" ? <div className="space-y-7">
            <div className="grid gap-5 sm:grid-cols-2"><div className="bg-[#11100e] px-4"><NumberControl label="Household occupants" max={30} min={1} onChange={(occupants) => patch({ occupants })} value={draft.occupants} /></div><Toggle checked={draft.accessibilityRequired} detail="Prioritises a ground-floor bedroom, bathroom, route and clearances." label="Step-free / mobility access needed" onChange={(accessibilityRequired) => patch({ accessibilityRequired })} /></div>
            <div><p className={LABEL}>Ground-floor living and dining</p><div className="mt-2 grid gap-2 sm:grid-cols-2"><Choice checked={draft.socialSpaceMode === "separate"} detail="Two distinct rooms with a required direct opening between living and dining." onClick={() => patch({ socialSpaceMode: "separate" })} title="Separate living + dining" /><Choice checked={draft.socialSpaceMode === "combined"} detail="One larger shared hall sized for both living and dining functions." onClick={() => patch({ socialSpaceMode: "combined" })} title="Combined living / dining hall" /></div></div>
            <div><p className={LABEL}>Room programme by floor</p><div className="mt-2 grid gap-3 xl:grid-cols-2">{draft.programs.slice(0, draft.floorCount).map((program, level) => { const brief = floorProgramBrief(program); return <section className="bg-[#11100e]" key={level}><header className="flex items-center justify-between border-b border-[#8e5a31]/25 px-4 py-3"><div><p className="text-sm font-bold">{level === 0 ? "Ground floor" : `Floor ${level}`}</p><p className="mt-0.5 text-[0.62rem] uppercase tracking-[0.09em] text-[#74685d]">F{level}</p></div><span className="font-[family-name:var(--font-display)] text-2xl text-[#c97940]">{program.bedrooms}B · {program.bathrooms}W</span></header><div className="px-4"><NumberControl label="Bedrooms with attached bathroom" max={Math.min(8 - brief.bedroomsWithoutAttachedBathroom, 8 - brief.sharedBathrooms)} min={0} onChange={(attachedBedrooms) => updateProgramBrief(level, { attachedBedrooms })} value={brief.attachedBedrooms} /><p className="pb-2 text-[0.68rem] leading-5 text-[#8f8275]">Each creates a private bathroom with a required direct door from its bedroom.</p><NumberControl label="Bedrooms without attached bathroom" max={8 - brief.attachedBedrooms} min={0} onChange={(bedroomsWithoutAttachedBathroom) => updateProgramBrief(level, { bedroomsWithoutAttachedBathroom })} value={brief.bedroomsWithoutAttachedBathroom} /><NumberControl label="Additional / shared bathrooms" max={8 - brief.attachedBedrooms} min={0} onChange={(sharedBathrooms) => updateProgramBrief(level, { sharedBathrooms })} value={brief.sharedBathrooms} /><NumberControl label="Studies / offices" max={3} min={0} onChange={(studies) => updateProgram(level, { studies })} value={program.studies} /></div>{level > 0 ? <div className="p-3"><Toggle checked={program.balcony} label="Balcony on this floor" onChange={(balcony) => updateProgram(level, { balcony })} /></div> : null}</section>; })}</div></div>
            <div><p className={LABEL}>Ground-floor priorities</p><div className="mt-2 grid gap-2 sm:grid-cols-2"><Toggle checked={draft.includeParking} label="Covered parking" onChange={(includeParking) => patch({ includeParking, ...(includeParking ? {} : { shadeStructures: draft.shadeStructures.filter((shade) => shade.location !== "parking"), aboveParkingUse: { value: "auto", source: "default" } as const }) })} /><Toggle checked={draft.includeVerandah} label="Covered verandah" onChange={(includeVerandah) => patch({ includeVerandah, ...(includeVerandah ? {} : { shadeStructures: draft.shadeStructures.filter((shade) => shade.location !== "verandah") }) })} /><Toggle checked={draft.includeUtility} label="Utility / laundry" onChange={(includeUtility) => patch({ includeUtility })} /><Toggle checked={draft.includePooja} label="Pooja / sacred room" onChange={(includePooja) => patch({ includePooja })} /><Toggle checked={draft.includeCourtyard} detail="Creates an exterior planning void, not leftover gap." label="Central courtyard" onChange={(includeCourtyard) => patch({ includeCourtyard })} /></div></div>
          </div> : null}

          {step.id === "architecture" ? <div className="space-y-10">
            {regionalResolution.warning ? <p className="border border-[#8e5a31]/65 bg-[#171512] p-4 text-base leading-7 text-[#b5a697]" role="status">{regionalResolution.warning.message} Selectable references are marked as available below.</p> : null}
            <ArchitectureReferencePicker description="This is a design constraint, not a decorative label. It controls elevation vocabulary, shade, roof expression and the visualization brief." legend="Choose the villa language" name="architectural-style" onChange={(architecturalStyle) => patch({ architecturalStyle })} options={ARCHITECTURAL_STYLE_PREVIEWS} suggestedValue={regionalResolution.pack.intakeStyle} suggestionLabel={regionalResolution.matchedAdminArea ?? (draft.adminArea || draft.countryCode)} value={draft.architecturalStyle} />
            <ArchitectureReferencePicker description="Choose the volumetric rule that organizes rooms, courts and terraces. The plate is a strategy preview, not a generated façade." legend="Choose the built-form strategy" name="form-strategy" onChange={(formStrategy) => patch(formStrategyPatch(formStrategy))} options={FORM_STRATEGY_PREVIEWS} suggestedValue={regionalResolution.pack.defaultFormStrategy} suggestionLabel={regionalResolution.matchedAdminArea ?? (draft.adminArea || draft.countryCode)} value={draft.formStrategy} />
            <div className="max-w-2xl"><Field label="Material direction"><select className={CONTROL} onChange={(event) => patch({ materialDirection: event.target.value as IntakeDraft["materialDirection"] })} value={draft.materialDirection}><option value="warm_natural">Warm natural · timber + stone + mineral plaster</option><option value="earthy_textured">Earthy textured · brick + lime + local stone</option><option value="light_mineral">Light mineral · pale plaster + restrained timber</option><option value="monochrome">Monochrome · concrete + dark metal + clear glazing</option></select></Field></div>
            <section className="space-y-5 border-t border-[#8e5a31]/30 pt-7"><div><p className={LABEL}>Entry and outdoor roof intent</p><p className="mt-2 max-w-3xl text-xs leading-5 text-[#8f8275]">These are physical constraints. Open pergolas remain visibly slatted; solid canopies and occupied outdoor edges receive their required supports and guards.</p></div><div className="grid gap-5 sm:grid-cols-2"><Field label="Primary entry side"><select className={CONTROL} onChange={(event) => patch({ currentEntry: { ...draft.currentEntry, primarySide: { value: event.target.value as IntakeDraft["currentEntry"]["primarySide"]["value"], source: "user" } } })} value={draft.currentEntry.primarySide.value}><option value="auto_road_side">Automatic · road-facing side</option>{DIRECTIONS.map((direction) => <option key={direction} value={direction}>{direction}</option>)}</select></Field><Field label="Secondary entry"><select className={CONTROL} onChange={(event) => patch({ currentEntry: { ...draft.currentEntry, secondaryEntry: { value: event.target.value as IntakeDraft["currentEntry"]["secondaryEntry"]["value"], source: "user" } } })} value={draft.currentEntry.secondaryEntry.value}><option value="auto">Automatic if useful</option><option value="none">No secondary entry</option><option value="rear">Rear entry</option><option value="service_side">Service-side entry</option></select></Field><Field label="Main door clear width"><select className={CONTROL} onChange={(event) => patch({ currentEntry: { ...draft.currentEntry, primaryDoorClearWidthMm: Number(event.target.value) } })} value={draft.currentEntry.primaryDoorClearWidthMm}>{[1000, 1200, 1400, 1600].map((width) => <option key={width} value={width}>{width} mm</option>)}</select></Field><Field label="Maximum exterior pedestrian entries"><select className={CONTROL} onChange={(event) => patch({ maxExteriorPedestrianEntryCount: Number(event.target.value) })} value={draft.maxExteriorPedestrianEntryCount}>{[1, 2].map((count) => <option key={count} value={count}>{count}</option>)}</select></Field></div><div className="grid gap-5 sm:grid-cols-2">{(["front_entry", "parking", "verandah", "terrace"] as const).map((location) => { const disabled = location === "parking" && !draft.includeParking || location === "verandah" && !draft.includeVerandah; return <Field key={location} label={`${location.replaceAll("_", " ")} roof`}><select className={CONTROL} disabled={disabled} onChange={(event) => updateShadeStructure(location, event.target.value as ShadeStructureRequirement["type"] | "none")} value={disabled ? "none" : shadeType(location)}><option value="none">No added shade structure</option><option value="open_pergola">Open pergola · slatted</option><option value="solid_canopy">Solid canopy</option></select></Field>; })}</div>{draft.includeParking ? <Field label="Use of space above parking"><select className={CONTROL} onChange={(event) => patch({ aboveParkingUse: { value: event.target.value as IntakeDraft["aboveParkingUse"]["value"], source: "user" } })} value={draft.aboveParkingUse.value}><option value="auto">Automatic · use proportionately</option><option value="occupied_rooms">Occupied rooms</option><option value="balcony">Balcony</option><option value="terrace">Terrace</option><option value="unbuilt">Leave unbuilt</option></select></Field> : null}</section>
            <div className="border-l-2 border-[#c97940] bg-[#17120e] p-4 text-xs leading-6 text-[#aa9b8d]"><strong className="text-[#fff6ea]">Plot and house are separate decisions.</strong> A rectangular site may contain stepped, winged or courtyard-based built form. BrickPilot still keeps every room and support concept inside the verified buildable envelope.</div>
          </div> : null}

          {step.id === "budget" ? <div className="space-y-7">
            <div><p className={LABEL}>Finish and specification tier</p><div className="mt-2 grid gap-2 sm:grid-cols-3">{(["essential", "standard", "premium"] as const).map((tier) => <Choice checked={draft.qualityTier === tier} detail={tier === "essential" ? "Durable, cost-controlled baseline." : tier === "standard" ? "Balanced residential specification." : "Higher finish and services allowance."} key={tier} onClick={() => patch({ qualityTier: tier })} title={tier} />)}</div></div>
            <div className="grid gap-5 sm:grid-cols-2"><Field label={`Target low (${draft.currency})`} hint="Enter 0 if no target is set."><input className={CONTROL} min="0" onChange={(event) => patch({ budgetLowMajor: Number(event.target.value) })} step="10000" type="number" value={draft.budgetLowMajor} /></Field><Field label={`Target high (${draft.currency})`}><input className={CONTROL} min={draft.budgetLowMajor} onChange={(event) => patch({ budgetHighMajor: Number(event.target.value) })} step="10000" type="number" value={draft.budgetHighMajor} /></Field><Field label="Contingency (%)"><input className={CONTROL} max="50" min="0" onChange={(event) => patch({ contingencyPercent: Number(event.target.value) })} step="0.5" type="number" value={draft.contingencyPercent} /></Field><Field label="Tax assumption (%)" hint="Only apply a tax rate you have explicitly confirmed."><input className={CONTROL} max="50" min="0" onChange={(event) => patch({ taxPercent: Number(event.target.value) })} step="0.5" type="number" value={draft.taxPercent} /></Field></div>
            <div className="border-l-2 border-[#ff4e00] bg-[#17120e] p-4 text-xs leading-6 text-[#aa9b8d]"><strong className="text-[#fff6ea]">No false precision:</strong> the result is a sourced low / expected / high feasibility range. It lists inclusions, exclusions, locality, effective date and confidence—not a contractor quotation.</div>
          </div> : null}

          {step.id === "review" ? <Review capacity={capacity} draft={draft} requirements={requirements} /> : null}

          {error ? <p className="mt-6 border border-[#ff5b45]/70 bg-[#1a0c09] p-3 text-sm text-[#ff9e91]" role="alert">{error}</p> : null}
          <footer className="intake-actions mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[#8e5a31]/25 pt-5"><BackAction {...sharedActionBarProps} /><PrimaryAction {...sharedActionBarProps} /></footer>
        </div>
      </div>
    </section>
  );
}

function Review({ draft, requirements, capacity }: { draft: IntakeDraft; requirements: CurrentBuildingRequirements | null; capacity: ReturnType<typeof assessBriefCapacity> | null }) {
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
    ["Entry", `${draft.currentEntry.primarySide.value.replaceAll("_", " ")} · ${draft.currentEntry.primaryDoorClearWidthMm} mm main door · ${draft.currentEntry.secondaryEntry.value.replaceAll("_", " ")} secondary`],
    ["Shade structures", draft.shadeStructures.length ? draft.shadeStructures.map((shade) => `${shade.type.replaceAll("_", " ")} at ${shade.location.replaceAll("_", " ")}`).join(", ") : "No added shade structure"],
    ["Above parking", draft.includeParking ? draft.aboveParkingUse.value.replaceAll("_", " ") : "No parking requested"],
    ["Budget target", draft.budgetHighMajor > 0 ? `${budget.format(draft.budgetLowMajor)} – ${budget.format(draft.budgetHighMajor)}` : "No target supplied"],
    ["Canonical output", requirements ? `${requirements.rooms.length} named spaces · ${requirements.relationships.length} relationship rules` : "Requires corrections"],
  ];
  return <div className="space-y-6"><div className="grid border-t border-[#8e5a31]/25 sm:grid-cols-2 sm:gap-x-8">{items.map(([label, value]) => <div className="border-b border-[#8e5a31]/25 py-4" key={label}><p className="text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[#8f8275]">{label}</p><p className="mt-1.5 text-sm font-semibold leading-5 text-[#fff6ea]">{value}</p></div>)}</div>{capacity ? <section className={`border p-4 ${capacity.blocking ? "border-[#ff5b45]/70 bg-[#1a0c09]" : capacity.floors.some((floor) => floor.status === "tight") ? "border-[#d69b35]/65 bg-[#17140d]" : "border-[#38765a]/60 bg-[#0e1712]"}`}><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[0.62rem] font-extrabold uppercase tracking-[0.12em] text-[#c97940]">Programme capacity check</p><p className="mt-1 text-sm font-semibold">{capacity.blocking ? "The brief needs more usable area" : capacity.floors.some((floor) => floor.status === "tight") ? "Feasible, but tightly programmed" : "Minimum room areas fit the envelope"}</p></div><span className="text-[0.6rem] font-bold uppercase tracking-[0.1em] text-[#8f8275]">Area preflight · topology follows</span></div><p className="mt-3 max-w-3xl text-[0.68rem] leading-5 text-[#9f9183]"><strong className="text-[#d7c9ba]">The percentage is space demand, not a quality score:</strong> minimum requested room area divided by usable floor area. Topology is checked next—it means every room has the required connections and can be reached through valid doors, openings and stairs.</p><div className="mt-4 grid gap-2 sm:grid-cols-2">{capacity.floors.map((floor) => <div className="bg-[#11100e] p-3" key={floor.floorId}><div className="flex items-center justify-between gap-3 text-xs"><span>{floor.label}</span><strong className={floor.status === "over_capacity" ? "text-[#ff806f]" : floor.status === "tight" ? "text-[#e4bd6a]" : "text-[#7bc79e]"}>{Number.isFinite(floor.utilization) ? `${Math.round(floor.utilization * 100)}%` : "Blocked"}</strong></div><p className="mt-1 text-[0.65rem] leading-5 text-[#8f8275]">Minimum rooms {(floor.minimumRoomAreaMm2 / 1_000_000).toFixed(1)} m² · usable {(floor.usableAreaMm2 / 1_000_000).toFixed(1)} m²</p></div>)}</div>{capacity.actions.length ? <ul className="mt-4 list-disc space-y-1 pl-5 text-xs leading-5 text-[#b5a697]">{capacity.actions.map((action) => <li key={action}>{action}</li>)}</ul> : null}</section> : null}<div className="grid gap-3 sm:grid-cols-[auto_1fr]"><Ruler className="mt-1 h-5 w-5 text-[#c97940]" /><div><p className="text-sm font-semibold">What happens next</p><p className="mt-1 text-xs leading-6 text-[#9f9183]">BrickPilot assigns an internal variation seed, generates a fixed candidate set, normalizes shared walls, places doors, windows and stairs, then tests reachability and geometry. If no plan is feasible, the result names the constraints to change.</p></div></div></div>;
}
