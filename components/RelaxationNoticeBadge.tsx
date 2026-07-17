import { relaxationNotice } from "@/components/design-workspace-state";

export function RelaxationNoticeBadge({ rung }: { rung: number }) {
  const notice = relaxationNotice(rung);
  if (!notice) return null;

  return <span className="inline-flex border border-[#c97940] px-2.5 py-1.5 text-[0.8125rem] font-bold uppercase tracking-[0.09em] text-[#fff6ea]">{notice}</span>;
}
