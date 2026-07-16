"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BadgeCheck, Box, ChevronRight, Clock3, Coins, LoaderCircle, LogOut, Plus, RotateCcw, ShieldCheck } from "lucide-react";

import { CadWorkspace } from "@/components/cad-workspace";
import { GuidedIntake } from "@/components/guided-intake";
import { NaturalLanguageIntake } from "@/components/guided-intake/NaturalLanguageIntake";
import { authClient } from "@/lib/auth-client";
import type { ArchitecturalReviewResult, RequirementDelta } from "@/lib/ai/schema";
import type { BuildingRequirements } from "@/lib/building/requirements";
import type { Building } from "@/lib/building/schema";
import { formatEstimateRange } from "@/lib/cost/format";
import { deriveQuantityTakeoff } from "@/lib/cost/quantity";
import type { CostEstimate } from "@/lib/cost/schema";
import type { ValidationReport } from "@/lib/validation";

type DesignResult = {
  projectId: string;
  designId: string;
  version?: number;
  title: string;
  requirements: BuildingRequirements;
  building: Building;
  validation: ValidationReport;
  costEstimate: CostEstimate;
  intent?: { assumptions?: string[]; evaluatedCandidateCount?: number };
  aiReview?: ArchitecturalReviewResult | null;
};

type RecentStudy = {
  projectId: string;
  designId: string;
  version?: number;
  title: string;
  status: string;
  createdAt: string;
  requirements: BuildingRequirements;
  building: Building | null;
  validation: ValidationReport | null;
  costEstimate: CostEstimate | null;
  aiReview?: ArchitecturalReviewResult | null;
};

type GenerationConflict = { ruleId?: string; message?: string; suggestedAction?: string };
type WorkspaceError = { title: string; message: string; code?: string; actions: string[] };

function explainGenerationFailure(payload: { error?: string; code?: string; details?: GenerationConflict[] }): WorkspaceError {
  const code = payload.code;
  if (code === "NO_FEASIBLE_LAYOUT") {
    const reportedActions = (payload.details ?? []).map((conflict) => conflict.suggestedAction).filter((action): action is string => Boolean(action));
    return {
      title: "This brief needs adjustment",
      message: "BrickPilot could not connect every requested room with valid walls, doors and circulation inside the current buildable envelope.",
      code,
      actions: [...new Set([...reportedActions, "Move one or more ground-floor rooms to an upper floor.", "Remove an optional courtyard, parking bay or secondary room.", "Increase the plot or reduce setbacks only where local rules permit."])].slice(0, 4),
    };
  }
  if (code === "UNSUPPORTED_PROGRAM_TOPOLOGY") return {
    title: "The room programme exceeds the available floor area",
    message: payload.error ?? "The minimum requested areas do not fit after setbacks and the stair core are reserved.",
    code,
    actions: ["Reduce room counts or optional spaces.", "Move rooms to another floor.", "Use a larger buildable envelope."],
  };
  if (code === "RATE_LIMITED") return { title: "Generation limit reached", message: payload.error ?? "Try again tomorrow.", code, actions: [] };
  if (code === "INCOMPLETE_ROOM_PROGRAM") return { title: "The room programme is incomplete", message: payload.error ?? "Add at least one bedroom and one bathroom.", code, actions: ["Open the Rooms step and add the missing core room."] };
  return { title: "Generation could not start", message: payload.error ?? "Unable to generate this study.", code, actions: ["Review the questionnaire and try again."] };
}

function builtAreaSquareMetres(building: Building) {
  return deriveQuantityTakeoff(building).grossFloorAreaMm2 / 1_000_000;
}

function describeRequirementDelta(delta: RequirementDelta) {
  if (delta.op === "add_room") return `Add ${delta.newRoom.name} (${delta.newRoom.type}) on ${delta.newRoom.floorId}`;
  if (delta.op === "remove_room") return `Remove room ${delta.roomId} and its relationships`;
  return `${delta.resizeDirection === "increase" ? "Increase" : "Decrease"} room ${delta.roomId} using the bounded server resize`;
}

export function DesignWorkspace({ hasProjects: _hasProjects, userName }: { hasProjects: boolean; userName: string }) {
  const [result, setResult] = useState<DesignResult | null>(null);
  const [recent, setRecent] = useState<RecentStudy[]>([]);
  const [failedRecent, setFailedRecent] = useState<RecentStudy[]>([]);
  const [error, setError] = useState<WorkspaceError | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [highlightedObjectIds, setHighlightedObjectIds] = useState<string[]>([]);
  const [prefill, setPrefill] = useState<{ requirements: BuildingRequirements; assumptions: string[] } | null>(null);
  const resultRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/designs")
      .then(async (response) => {
        if (!response.ok) return { studies: [], failedStudies: [] };
        return (await response.json()) as { studies: RecentStudy[]; failedStudies?: RecentStudy[] };
      })
      .then((data) => { if (active) { setRecent(data.studies); setFailedRecent(data.failedStudies ?? []); } })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const findingInputs = useMemo(() => result?.validation.findings.map(({ ruleId, severity, message, floorId, objectIds }) => ({ ruleId, severity, message, floorId, objectIds })) ?? [], [result]);

  useEffect(() => {
    if (!result || isGenerating) return;
    window.requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "auto", block: "start" }));
  }, [isGenerating, result]);

  async function generate(requirements: BuildingRequirements) {
    setError(null);
    setHighlightedObjectIds([]);
    setIsGenerating(true);
    try {
      const response = await fetch("/api/designs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirements }),
      });
      const data = (await response.json()) as DesignResult | { error?: string; code?: string; details?: GenerationConflict[] };
      if (!response.ok || !("projectId" in data)) {
        setError(explainGenerationFailure("error" in data || "code" in data || "details" in data ? data : {}));
        window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
        return;
      }
      setResult(data);
      setRecent((current) => [{
        projectId: data.projectId,
        designId: data.designId,
        version: data.version,
        title: data.title,
        status: "completed",
        createdAt: new Date().toISOString(),
        requirements: data.requirements,
        building: data.building,
        validation: data.validation,
        costEstimate: data.costEstimate,
        aiReview: data.aiReview,
      }, ...current.filter((study) => study.designId !== data.designId)].slice(0, 12));
    } catch (generationError) {
      setError({ title: "Connection interrupted", message: generationError instanceof Error ? generationError.message : "Unable to generate this study.", actions: ["Check the connection and try again. Your questionnaire remains saved."] });
    } finally {
      setIsGenerating(false);
    }
  }

  function openStudy(study: RecentStudy) {
    if (!study.building || !study.validation || !study.costEstimate) return;
    setResult({
      projectId: study.projectId,
      designId: study.designId,
      version: study.version,
      title: study.title,
      requirements: study.requirements,
      building: study.building,
      validation: study.validation,
      costEstimate: study.costEstimate,
      aiReview: study.aiReview,
    });
    setError(null);
    setHighlightedObjectIds([]);
  }

  async function signOut() {
    await authClient.signOut();
    window.location.assign("/");
  }

  async function applySuggestion(deltaIndex: number) {
    if (!result || isGenerating) return;
    setError(null);
    setIsGenerating(true);
    try {
      const response = await fetch(`/api/designs/${result.designId}/apply-suggestion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deltaIndex }),
      });
      const data = await response.json() as DesignResult | { error?: string; code?: string };
      if (!response.ok || !("designId" in data)) {
        const failure = data as { error?: string; code?: string };
        setError({ title: "Could not apply that suggestion", message: failure.error ?? "Try again.", code: failure.code, actions: [] });
        return;
      }
      setResult(data);
      setHighlightedObjectIds([]);
      setRecent((current) => [{
        projectId: data.projectId,
        designId: data.designId,
        version: data.version,
        title: data.title,
        status: "completed",
        createdAt: new Date().toISOString(),
        requirements: data.requirements,
        building: data.building,
        validation: data.validation,
        costEstimate: data.costEstimate,
        aiReview: data.aiReview,
      }, ...current].slice(0, 12));
    } catch (suggestionError) {
      setError({ title: "Connection interrupted", message: suggestionError instanceof Error ? suggestionError.message : "Unable to apply that suggestion.", actions: [] });
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#080807] text-[#fff6ea]">
      <div className="mx-auto max-w-[112rem] px-3 py-4 sm:px-5 lg:px-7">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#8e5a31]/55 pb-4">
          <div className="flex items-end gap-4">
            <div><p className="font-[family-name:var(--font-display)] text-3xl leading-none tracking-[-0.04em] text-[#c97940]">BrickPilot</p><p className="mt-1 text-[0.62rem] font-extrabold uppercase tracking-[0.15em] text-[#86796c]">Residential concept engineering</p></div>
            <span className="hidden border-l border-[#8e5a31]/45 pl-4 text-[0.62rem] font-bold uppercase tracking-[0.12em] text-[#ff8d49] md:block">Topology · validation · cost · drawing</span>
          </div>
          <div className="flex items-center gap-3"><span className="hidden text-xs text-[#95887b] sm:block">Signed in as {userName}</span><button className="inline-flex items-center gap-2 border border-[#8e5a31]/65 px-3 py-2 text-[0.65rem] font-bold uppercase tracking-[0.12em] transition hover:bg-[#171512] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fff6ea]" onClick={signOut} type="button"><LogOut className="h-3.5 w-3.5" /> Sign out</button></div>
        </header>

        <div className="py-5">
          {result && error ? <div className="mb-5 border border-[#ff5b45]/70 bg-[#180d09] p-5" role="alert"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex max-w-3xl items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#ff806f]" /><div><p className="text-xs font-extrabold uppercase tracking-[0.12em] text-[#ff806f]">{error.title}</p><p className="mt-2 text-sm leading-6 text-[#d8c9bc]">{error.message}</p>{error.code ? <p className="mt-3 text-[0.58rem] uppercase tracking-[0.08em] text-[#6f6359]">Reference: {error.code}</p> : null}</div></div><button className="border border-[#8e5a31]/60 px-3 py-2 text-[0.65rem] font-bold uppercase tracking-[0.1em]" onClick={() => setError(null)} type="button">Dismiss</button></div></div> : null}
          {!result && !isGenerating ? <div className="mx-auto w-full max-w-[92rem] space-y-5">
            {error ? <div className="border border-[#ff5b45]/70 bg-[#180d09] p-5" role="alert"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex max-w-3xl items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#ff806f]" /><div><p className="text-xs font-extrabold uppercase tracking-[0.12em] text-[#ff806f]">{error.title}</p><p className="mt-2 text-sm leading-6 text-[#d8c9bc]">{error.message}</p>{error.actions.length ? <div className="mt-4"><p className="text-[0.62rem] font-bold uppercase tracking-[0.1em] text-[#9f9183]">Recommended changes</p><ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-[#b5a697]">{error.actions.map((action) => <li key={action}>{action}</li>)}</ul></div> : null}{error.code ? <p className="mt-3 text-[0.58rem] uppercase tracking-[0.08em] text-[#6f6359]">Reference: {error.code}</p> : null}</div></div><button className="inline-flex items-center gap-2 border border-[#8e5a31]/60 px-3 py-2 text-[0.65rem] font-bold uppercase tracking-[0.1em]" onClick={() => setError(null)} type="button"><RotateCcw className="h-3.5 w-3.5" /> Adjust questionnaire</button></div></div> : null}
            <NaturalLanguageIntake
              disabled={isGenerating}
              onParsed={(requirements, assumptions) => setPrefill({ requirements, assumptions })}
              onUseFixture={(requirements) => setPrefill({ requirements, assumptions: ["Loaded from a tuned demo fixture."] })}
            />
            {prefill ? <div className="border border-[#38765a]/55 bg-[#0d0c0a] p-4">
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-[#7bc79e]">Parsed — review below, then generate</p>
              {prefill.assumptions.length > 0 ? <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-[#b5a697]">{prefill.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul> : null}
            </div> : null}
            <GuidedIntake initialValue={prefill?.requirements} isSubmitting={isGenerating} onSubmit={generate} storageKey="active-residential-study" submitLabel="Generate verified concept" />
            {recent.length > 0 ? <section className="border border-[#8e5a31]/45 bg-[#0d0c0a] p-4"><div className="flex items-center justify-between"><p className="text-[0.65rem] font-extrabold uppercase tracking-[0.14em] text-[#c97940]">Recent studies</p><span className="text-[0.58rem] uppercase tracking-[0.1em] text-[#756a60]">Saved</span></div><div className="mt-3 space-y-1">{recent.slice(0, 5).map((study) => <button className="flex w-full items-center justify-between gap-3 border-t border-[#8e5a31]/25 py-3 text-left text-xs text-[#b5a697] transition hover:text-[#fff6ea] disabled:cursor-not-allowed disabled:opacity-40" disabled={!study.building} key={study.designId} onClick={() => openStudy(study)} type="button"><span className="min-w-0"><span className="block truncate font-semibold">{study.title}</span><span className="mt-1 flex items-center gap-1 text-[0.58rem] uppercase tracking-[0.08em] text-[#756a60]"><Clock3 className="h-3 w-3" /> {new Date(study.createdAt).toLocaleDateString()}</span></span><ChevronRight className="h-4 w-4 shrink-0 text-[#c97940]" /></button>)}</div></section> : null}
            {failedRecent.length > 0 ? <details className="border border-[#8e5a31]/35 bg-[#0b0a09] p-4"><summary className="cursor-pointer text-[0.62rem] font-bold uppercase tracking-[0.12em] text-[#9f9183]">Failed attempts · {failedRecent.length}</summary><p className="mt-3 text-xs leading-5 text-[#756a60]">These attempts never became usable plans and no longer crowd the saved-study list. Load the brief, adjust it, then generate again.</p><div className="mt-2">{failedRecent.slice(0, 5).map((study) => <button className="flex w-full items-center justify-between border-t border-[#8e5a31]/20 py-3 text-left text-xs text-[#9f9183] hover:text-[#fff6ea]" key={study.designId} onClick={() => { setPrefill({ requirements: study.requirements, assumptions: ["Recovered from a failed attempt. Review the capacity and architecture steps before generating."] }); window.scrollTo({ top: 0, behavior: "smooth" }); }} type="button"><span><span className="block font-semibold">{study.title}</span><span className="mt-1 block text-[0.56rem] uppercase tracking-[0.08em] text-[#6f6359]">Failed · {new Date(study.createdAt).toLocaleDateString()}</span></span><RotateCcw className="h-3.5 w-3.5 text-[#c97940]" /></button>)}</div></details> : null}
          </div> : null}

          <section className="min-w-0 scroll-mt-4 self-start" ref={resultRef}>
            {isGenerating ? <div className="grid min-h-[44rem] place-items-center border border-[#8e5a31]/55 bg-[#0d0c0a] p-8 text-center"><div className="max-w-md"><LoaderCircle className="mx-auto h-9 w-9 animate-spin text-[#ff4e00] motion-reduce:animate-none" /><p className="mt-6 text-[0.67rem] font-extrabold uppercase tracking-[0.15em] text-[#c97940]">Evaluating deterministic candidates</p><h1 className="mt-4 font-[family-name:var(--font-display)] text-5xl font-normal leading-[0.95] tracking-[-0.04em]">Building a plan that can explain itself<span className="text-[#ff4e00]">.</span></h1><p className="mt-5 text-sm leading-6 text-[#9d8f82]">Normalizing shared walls, placing openings and stairs, proving circulation, reconciling regional cost, and composing the drawing sheet.</p></div></div> : null}

            {result && !isGenerating ? <div className="reveal space-y-5">
              <div className="flex flex-wrap items-end justify-between gap-4 border border-[#8e5a31]/50 bg-[#0d0c0a] px-5 py-4"><div><p className="text-[0.62rem] font-extrabold uppercase tracking-[0.15em] text-[#c97940]">Study {result.designId.slice(0, 8)} · immutable v{result.version ?? 1}</p><h1 className="mt-1 font-[family-name:var(--font-display)] text-4xl tracking-[-0.035em]">{result.title}</h1></div><div className="flex flex-wrap items-center gap-2"><Link className="inline-flex items-center gap-2 bg-[#e94300] px-3 py-2 text-[0.65rem] font-bold uppercase tracking-[0.1em] text-[#fff6ea] transition hover:bg-[#ff4e00]" href={`/workspace/designs/${result.designId}/massing`}><Box className="h-3.5 w-3.5" /> Explore 3D massing</Link><button className="inline-flex items-center gap-2 border border-[#c97940] px-3 py-2 text-[0.65rem] font-bold uppercase tracking-[0.1em] transition hover:bg-[#171512]" onClick={() => { setResult(null); setPrefill(null); setHighlightedObjectIds([]); }} type="button"><Plus className="h-3.5 w-3.5" /> New study</button></div></div>

              <CadWorkspace building={result.building} findings={findingInputs} highlightedObjectIds={highlightedObjectIds} projectName={result.title} storageKey={result.projectId} />

              <div className="grid gap-4 xl:grid-cols-[1fr_1fr_.9fr]">
                <section className="border border-[#8e5a31]/50 bg-[#0d0c0a] p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[0.63rem] font-extrabold uppercase tracking-[0.14em] text-[#c97940]">Validation evidence</p><div className="mt-3 flex items-end gap-2"><span className="font-[family-name:var(--font-display)] text-5xl">{result.validation.score}</span><span className="mb-2 text-[0.62rem] uppercase tracking-[0.1em] text-[#82766b]">/ 100</span></div></div>{result.validation.valid ? <span className="inline-flex items-center gap-1.5 border border-[#38765a]/60 px-2.5 py-1.5 text-[0.62rem] font-bold uppercase tracking-[0.08em] text-[#7bc79e]"><BadgeCheck className="h-3.5 w-3.5" /> Hard checks pass</span> : <span className="text-[#ff806f]">Blocked</span>}</div>{result.building.structuralConcept ? <div className="mt-4 border border-[#38765a]/45 bg-[#0b1510] p-3"><p className="flex items-center gap-2 text-[0.6rem] font-bold uppercase tracking-[0.1em] text-[#7bc79e]"><ShieldCheck className="h-3.5 w-3.5" /> Preliminary pillar coordination passed</p><p className="mt-2 text-xs leading-5 text-[#9dbaaa]">{result.building.structuralConcept.columns.length} aligned conceptual pillar locations · {result.building.structuralConcept.axes.length} grid axes · continuous through {result.building.floors.length} floor{result.building.floors.length === 1 ? "" : "s"}.</p><p className="mt-2 text-[0.58rem] leading-4 text-[#70877a]">Member sizes, loads, foundations, seismic/wind design and code compliance require a licensed structural engineer.</p></div> : null}<div className="mt-4 border-t border-[#8e5a31]/35">{result.validation.findings.length ? result.validation.findings.slice(0, 8).map((finding) => <button className="flex w-full items-start gap-3 border-b border-[#8e5a31]/25 py-3 text-left" key={`${finding.ruleId}-${finding.objectIds.join("-")}`} onClick={() => setHighlightedObjectIds(finding.objectIds)} type="button"><span className={`mt-1 h-2 w-2 shrink-0 ${finding.severity === "error" ? "bg-[#ff5b45]" : finding.severity === "warning" ? "bg-[#d69b35]" : "bg-[#5d9ed2]"}`} /><span><span className="block text-[0.58rem] font-bold uppercase tracking-[0.09em] text-[#82766b]">{finding.ruleId}</span><span className="mt-1 block text-xs leading-5 text-[#cbbbad]">{finding.message}</span></span></button>) : <p className="py-5 text-sm text-[#8f8275]">No validation findings for this concept.</p>}</div></section>

                <section className="border border-[#8e5a31]/50 bg-[#0d0c0a] p-5"><div className="flex items-center gap-2"><Coins className="h-4 w-4 text-[#c97940]" /><p className="text-[0.63rem] font-extrabold uppercase tracking-[0.14em] text-[#c97940]">Regional feasibility cost</p></div>{result.costEstimate.status === "available" ? <><p className="mt-5 font-[family-name:var(--font-display)] text-3xl tracking-[-0.035em]">{formatEstimateRange(result.costEstimate.total, result.costEstimate.currency, result.costEstimate.locale)}</p><p className="mt-2 text-xs leading-5 text-[#8f8275]">Expected band in native {result.costEstimate.currency}. Confidence <strong className="text-[#fff6ea]">{result.costEstimate.confidence}</strong> · {result.costEstimate.selection.match.replaceAll("_", " ")}.</p><div className="mt-5 border-t border-[#8e5a31]/35">{result.costEstimate.lineItems.map((line) => <div className="flex items-center justify-between gap-3 border-b border-[#8e5a31]/25 py-3 text-xs" key={line.id}><span className="text-[#a99a8d]">{line.label}</span><span className="font-semibold">{formatEstimateRange(line.amounts, result.costEstimate.currency, result.costEstimate.locale)}</span></div>)}</div><p className="mt-4 text-[0.63rem] leading-5 text-[#786d62]">{result.costEstimate.disclaimer}</p></> : <div className="mt-5 border border-[#8e5a31]/35 p-4"><p className="text-sm font-semibold">Native regional cost unavailable</p><p className="mt-2 text-xs leading-5 text-[#8f8275]">BrickPilot will not convert an unrelated India rate and present it as local evidence.</p></div>}</section>

                <section className="border border-[#8e5a31]/50 bg-[#0d0c0a] p-5"><p className="text-[0.63rem] font-extrabold uppercase tracking-[0.14em] text-[#c97940]">Study record</p><dl className="mt-4 space-y-3 text-xs">{[["Built area", `${builtAreaSquareMetres(result.building).toFixed(1)} m²`], ["Floors", `${result.building.floors.length} · ${result.building.floors.map((floor) => floor.label).join(", ")}`], ["Candidate", `${result.building.candidate.generatorId} / ${result.building.candidate.index}`], ["Geometry", result.building.candidate.geometryHash], ["Algorithm", result.building.algorithmVersion]].map(([label, value]) => <div className="border-b border-[#8e5a31]/25 pb-3" key={label}><dt className="text-[0.57rem] font-bold uppercase tracking-[0.1em] text-[#74695f]">{label}</dt><dd className="mt-1 break-words text-[#cbbbad]">{value}</dd></div>)}</dl>{result.costEstimate.status === "available" ? <div className="mt-5"><p className="text-[0.58rem] font-bold uppercase tracking-[0.1em] text-[#74695f]">Sources</p>{result.costEstimate.sources.map((source) => <a className="mt-2 block text-xs leading-5 text-[#c97940] underline decoration-[#8e5a31] underline-offset-4 hover:text-[#fff6ea]" href={source.url} key={source.url} rel="noreferrer" target="_blank">{source.title}</a>)}</div> : null}<div className="mt-5 flex items-start gap-2 border-t border-[#8e5a31]/35 pt-4 text-[0.62rem] leading-5 text-[#74695f]"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#c97940]" /> Concept feasibility output. Professional verification is required before approvals, procurement, finance, or construction.</div></section>
              </div>

              <section className="border border-[#8e5a31]/50 bg-[#0d0c0a] p-5">
                <p className="text-[0.63rem] font-extrabold uppercase tracking-[0.14em] text-[#c97940]">AI architectural concurrence</p>
                {result.aiReview?.status === "reviewed" ? <>
                  <p className="mt-3 text-sm text-[#cbbbad]">{result.aiReview.review.concurs ? "Concurs with this concept" : "Raises concerns"} · confidence {result.aiReview.review.confidence}</p>
                  {result.aiReview.review.citedConcerns.length > 0 ? <ul className="mt-4 space-y-3">{result.aiReview.review.citedConcerns.map((concern, index) => <li className="border-t border-[#8e5a31]/25 pt-3 text-xs leading-5" key={`${concern.topic}-${concern.objectIds.join("-")}-${index}`}><span className="block font-semibold text-[#fff6ea]">{concern.whyItMatters}</span><span className="mt-1 block text-[#9d8f82]">{concern.recommendation}</span><span className="mt-1 block text-[#7bc79e]">What it saves: {concern.whatItSaves}</span><button className="mt-1 text-[0.58rem] uppercase tracking-[0.08em] text-[#c97940]" onClick={() => setHighlightedObjectIds(concern.objectIds)} type="button">Ref: {[concern.ruleId, concern.floorId, ...concern.evidenceIds, ...concern.objectIds].filter(Boolean).join(" · ")}</button></li>)}</ul> : <p className="mt-4 text-xs text-[#8f8275]">No grounded advisory concerns were returned.</p>}
                  {result.aiReview.review.requirementDeltas.length > 0 ? <div className="mt-4 border-t border-[#8e5a31]/25 pt-3"><p className="text-[0.58rem] font-bold uppercase tracking-[0.1em] text-[#9f9183]">Suggested requirement changes</p><div className="mt-2 space-y-2">{result.aiReview.review.requirementDeltas.map((delta, index) => <div className="flex items-center justify-between gap-3 border border-[#8e5a31]/25 p-3 text-xs" key={`${delta.op}-${index}`}><span><span className="block font-semibold text-[#fff6ea]">{describeRequirementDelta(delta)}</span><span className="mt-1 block text-[#8f8275]">AI rationale: {delta.summary}</span></span><button className="shrink-0 border border-[#c97940] px-2.5 py-1 text-[0.6rem] font-bold uppercase tracking-[0.08em] hover:bg-[#171512] disabled:opacity-50" disabled={isGenerating} onClick={() => void applySuggestion(index)} type="button">Apply exact change</button></div>)}</div></div> : null}
                </> : <p className="mt-3 text-sm text-[#9d8f82]">AI architectural review unavailable{result.aiReview?.status === "unavailable" ? ` (${result.aiReview.reason.replaceAll("_", " ")})` : ""}. The deterministically valid plan remains available.</p>}
                <p className="mt-4 border-t border-[#8e5a31]/25 pt-3 text-[0.62rem] leading-5 text-[#74695f]">Advisory concept review only. It is not licensed-architect, permit, structural, MEP, or code-compliance approval.</p>
              </section>
            </div> : null}
          </section>
        </div>
      </div>
    </main>
  );
}
