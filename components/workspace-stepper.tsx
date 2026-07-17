"use client";

import Link from "next/link";
import { Check } from "lucide-react";

export type WorkspaceStepId = "directions" | "plan" | "massing" | "render";

const STEP_LABELS: Record<WorkspaceStepId, string> = {
  directions: "Directions",
  plan: "2D plan",
  massing: "3D massing",
  render: "Render",
};

export type WorkspaceStepperItem = {
  id: WorkspaceStepId;
  complete?: boolean;
  disabled?: boolean;
  href?: string;
  onSelect?: () => void;
};

// Mirrors the guided-intake stepper idiom (numbered chips, accent underline on the
// active step, hairline divide-x separators) so the brief, workspace result and
// massing routes read as one continuous flow.
export function WorkspaceStepper({ current, items, ariaLabel = "Study steps", className }: {
  current: WorkspaceStepId;
  items: readonly WorkspaceStepperItem[];
  ariaLabel?: string;
  className?: string;
}) {
  return <nav aria-label={ariaLabel} className={className ?? "border-y border-[#8e5a31]/30 bg-[#0a0908]"}>
    <ol className="flex divide-x divide-[#8e5a31]/15 overflow-x-auto">
      {items.map((item, index) => {
        const active = item.id === current;
        const complete = !active && Boolean(item.complete);
        const disabled = Boolean(item.disabled) && !active;
        const tone = active
          ? "bg-[#17110c] text-[#fff6ea]"
          : complete
            ? "text-[#c5b5a5] hover:text-[#fff6ea]"
            : disabled
              ? "cursor-not-allowed text-[#554b40]"
              : "text-[#776a5d] hover:text-[#c5b5a5]";
        const chipTone = complete
          ? "border-[#4a8d68]/70 text-[#77c497]"
          : active
            ? "border-[#ff4e00] text-[#ff8b4d]"
            : disabled
              ? "border-[#3a332c]/70 text-[#554b40]"
              : "border-[#4a4037]/70";
        const itemClassName = `relative flex w-full items-center justify-center gap-2.5 px-4 py-3.5 transition-colors lg:px-2 ${tone}`;
        const content = <>
          <span className={`grid h-6 w-6 shrink-0 place-items-center border text-[0.6rem] font-bold ${chipTone}`}>{complete ? <Check className="h-3 w-3" /> : String(index + 1).padStart(2, "0")}</span>
          <span className="whitespace-nowrap text-[0.65rem] font-bold uppercase tracking-[0.12em]">{STEP_LABELS[item.id]}</span>
          {active ? <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-[#ff4e00]" /> : null}
        </>;
        return <li className="shrink-0 lg:flex-1" key={item.id}>
          {disabled || (!item.href && !item.onSelect)
            ? <span aria-current={active ? "step" : undefined} aria-disabled={disabled || undefined} className={itemClassName}>{content}</span>
            : item.href
              ? <Link aria-current={active ? "step" : undefined} className={itemClassName} href={item.href}>{content}</Link>
              : <button aria-current={active ? "step" : undefined} className={itemClassName} onClick={item.onSelect} type="button">{content}</button>}
        </li>;
      })}
    </ol>
  </nav>;
}
