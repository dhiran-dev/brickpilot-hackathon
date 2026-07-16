"use client";

import { useState } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";

import type { BuildingRequirements } from "@/lib/building/requirements";

type BuildingFixture = {
  id: string;
  label: string;
  description: string;
  requirements: BuildingRequirements;
};

type ParseFailure = { message: string; fixtures: BuildingFixture[] };

export function NaturalLanguageIntake({ onParsed, onUseFixture, disabled }: {
  onParsed: (requirements: BuildingRequirements, assumptions: string[]) => void;
  onUseFixture: (requirements: BuildingRequirements) => void;
  disabled: boolean;
}) {
  const [sentence, setSentence] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [failure, setFailure] = useState<ParseFailure | null>(null);

  async function submit() {
    const value = sentence.trim();
    if (value.length < 8 || isParsing || disabled) return;
    setIsParsing(true);
    setFailure(null);
    try {
      const response = await fetch("/api/intake/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sentence: value }),
      });
      const data = await response.json() as {
        requirements?: BuildingRequirements;
        assumptions?: string[];
        error?: string;
        fixtures?: BuildingFixture[];
      };
      if (response.ok && data.requirements) {
        onParsed(data.requirements, data.assumptions ?? []);
        return;
      }
      setFailure({ message: data.error ?? "Could not parse that sentence.", fixtures: data.fixtures ?? [] });
    } catch {
      setFailure({ message: "Connection interrupted while parsing.", fixtures: [] });
    } finally {
      setIsParsing(false);
    }
  }

  return (
    <section className="border border-[#8e5a31]/45 bg-[#0d0c0a] p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-[#c97940]" />
        <p className="text-[0.63rem] font-extrabold uppercase tracking-[0.14em] text-[#c97940]">Describe it in one sentence</p>
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          aria-label="Home design description"
          className="min-w-0 flex-1 border border-[#8e5a31]/50 bg-[#080807] px-3 py-2 text-sm text-[#fff6ea] placeholder:text-[#6f6359] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fff6ea]"
          disabled={disabled || isParsing}
          maxLength={1_000}
          onChange={(event) => setSentence(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void submit(); }}
          placeholder="3BHK east-facing Vastu home for a family of 4 on a 30×50 plot"
          value={sentence}
        />
        <button
          className="inline-flex shrink-0 items-center justify-center gap-2 border border-[#c97940] px-4 py-2 text-[0.65rem] font-bold uppercase tracking-[0.1em] transition hover:bg-[#171512] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled || isParsing || sentence.trim().length < 8}
          onClick={() => void submit()}
          type="button"
        >
          {isParsing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : null}
          Parse sentence
        </button>
      </div>
      {failure ? <div className="mt-4 border border-[#ff5b45]/60 p-3" role="alert">
        <p className="text-xs leading-5 text-[#d8c9bc]">{failure.message}</p>
        {failure.fixtures.length > 0 ? <div className="mt-3">
          <p className="text-[0.58rem] font-bold uppercase tracking-[0.1em] text-[#9f9183]">Try a tuned example instead</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {failure.fixtures.map((fixture) => (
              <button
                className="border border-[#8e5a31]/60 px-3 py-2 text-left text-xs text-[#b5a697] transition hover:text-[#fff6ea]"
                key={fixture.id}
                onClick={() => onUseFixture(fixture.requirements)}
                type="button"
              >
                <span className="block font-semibold">{fixture.label}</span>
                <span className="mt-0.5 block text-[0.62rem] text-[#847869]">{fixture.description}</span>
              </button>
            ))}
          </div>
        </div> : null}
      </div> : null}
    </section>
  );
}
