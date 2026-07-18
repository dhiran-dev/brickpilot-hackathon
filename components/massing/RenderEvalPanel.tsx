"use client";

import { useCallback, useEffect, useState } from "react";

type EvalStatus = {
  sampleCount: number;
  evaluatedCount: number;
  samples: Array<{
    id: string;
    sampleIndex: number;
    evaluated: boolean;
    structuralPass: boolean | null;
    aestheticPass: boolean | null;
    humanDisposition: { disposition?: string } | null;
  }>;
  aggregate: { structuralPassRate?: number; aestheticPassRate?: number } | null;
  releaseGatePassed: boolean;
};

export function RenderEvalPanel({ layoutVersionId }: { layoutVersionId: string }) {
  const [status, setStatus] = useState<EvalStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const response = await fetch(`/api/designs/${layoutVersionId}/render-eval`, { cache: "no-store" });
    if (!response.ok) throw new Error("Release evaluation is unavailable.");
    setStatus(await response.json() as EvalStatus);
  }, [layoutVersionId]);
  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Release evaluation is unavailable.")); }, [load]);

  async function disposition(sampleId: string, value: "approved" | "rejected") {
    setError(null);
    const response = await fetch(`/api/designs/${layoutVersionId}/render-eval`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sampleId, disposition: value }),
    });
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) return setError(payload.error ?? "Disposition could not be saved.");
    await load();
  }

  return <details className="mt-8 border border-[#8e5a31]/45 bg-[#0c0b09] p-4 text-[#fff6ea]">
    <summary className="cursor-pointer text-[0.62rem] font-extrabold uppercase tracking-[0.14em] text-[#c97940]">Internal · GPT image 2 release evaluation</summary>
    {error ? <p className="mt-3 text-xs text-[#ff806f]">{error}</p> : null}
    {!status ? <p className="mt-3 text-xs text-[#786d62]">Loading release evidence…</p> : <div className="mt-4">
      <p className="text-xs text-[#b5a697]">{status.sampleCount}/5 provider samples stored · {status.evaluatedCount}/5 evaluated · gate {status.releaseGatePassed ? "passed" : "held"}</p>
      <div className="mt-3 grid gap-2 md:grid-cols-5">{status.samples.map((sample) => <div className="border border-[#8e5a31]/35 p-2" key={sample.id}>
        <p className="text-[0.55rem] font-bold uppercase tracking-[0.1em]">Sample {sample.sampleIndex}</p>
        <p className="mt-1 text-[0.55rem] text-[#786d62]">{sample.evaluated ? `Structure ${sample.structuralPass ? "pass" : "fail"} · Aesthetic ${sample.aestheticPass ? "pass" : "fail"}` : "Awaiting approved evaluator"}</p>
        {sample.evaluated ? <div className="mt-2 flex gap-1"><button className="border border-[#38765a]/65 px-2 py-1 text-[0.48rem] uppercase text-[#7bc79e]" onClick={() => void disposition(sample.id, "approved")} type="button">Approve</button><button className="border border-[#9b493d]/65 px-2 py-1 text-[0.48rem] uppercase text-[#ff806f]" onClick={() => void disposition(sample.id, "rejected")} type="button">Reject</button></div> : null}
      </div>)}</div>
    </div>}
  </details>;
}
