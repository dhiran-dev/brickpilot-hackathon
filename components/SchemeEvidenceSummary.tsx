import type { SchemeEvidenceState } from "@/components/design-workspace-state";

export function SchemeEvidenceSummary({
  evidence,
  validationScore,
}: {
  evidence: SchemeEvidenceState;
  validationScore: number;
}) {
  return (
    <dl aria-busy={evidence.busy} className="mt-5 border-t border-[#8e5a31]/35 text-base">
      <div className="flex items-center justify-between border-b border-[#8e5a31]/25 py-3">
        <dt className="text-[#b5a697]">Hard validation</dt>
        <dd className="font-semibold text-[#fff6ea]">{validationScore} / 100</dd>
      </div>
      <div className="flex items-center justify-between border-b border-[#8e5a31]/25 py-3">
        <dt className="text-[#b5a697]">Cost evidence</dt>
        <dd className="text-right text-[#fff6ea]">{evidence.cost}</dd>
      </div>
      <div className="flex items-center justify-between border-b border-[#8e5a31]/25 py-3">
        <dt className="text-[#b5a697]">AI review</dt>
        <dd className="text-right text-[#fff6ea]">{evidence.review}</dd>
      </div>
    </dl>
  );
}
