import Link from "next/link";
import { CircleAlert, Clock3, LockKeyhole } from "lucide-react";

import type {
  ProjectCapabilities,
  ProjectCapabilityProfile,
  ProjectLifecycleStatus,
} from "@/lib/server/project-capabilities";

export const PROJECT_VIEW_ONLY_EXPLANATION = "This project is view-only. Its saved results remain available, but AI changes, scheme selection, new reference captures, and render generation or retry are disabled.";

const CURRENT_CAPABILITY_FALLBACK: ProjectCapabilities = {
  canView: true,
  canReadAssets: true,
  canDelete: true,
  canApplyAiSuggestion: true,
  canSelectScheme: true,
  canGenerateRender: true,
  canRetryRender: true,
};

export type ProjectCapabilityPresentation = {
  kind: "view_only" | "generating" | "failed" | "deleting" | "unavailable";
  blocksNormalAccess: boolean;
  eyebrow: string;
  title: string;
  message: string;
};

/**
 * Creation responses produced before capability metadata was added are treated as current
 * for this one browser session. Reopened studies always use the server-resolved object.
 */
export function capabilitiesForWorkspace(capabilities?: ProjectCapabilities): ProjectCapabilities {
  return capabilities ?? CURRENT_CAPABILITY_FALLBACK;
}

export function projectCapabilityPresentation(input: {
  capabilityProfile?: ProjectCapabilityProfile;
  projectStatus?: ProjectLifecycleStatus;
  capabilities?: ProjectCapabilities;
}): ProjectCapabilityPresentation | null {
  const capabilities = capabilitiesForWorkspace(input.capabilities);

  if (input.projectStatus === "deleting") return {
    kind: "deleting",
    blocksNormalAccess: true,
    eyebrow: "Deletion status",
    title: "Project deletion pending",
    message: "This project is being deleted, or its deletion is awaiting a retry. Saved results and project actions stay unavailable while cleanup completes.",
  };
  if (input.projectStatus === "failed") return {
    kind: "failed",
    blocksNormalAccess: true,
    eyebrow: "Generation status",
    title: "Project generation failed",
    message: "No completed project is available to open. Return to the dashboard to review the failure summary or delete the failed project.",
  };
  if (input.projectStatus === "generating" || input.projectStatus === "draft") return {
    kind: "generating",
    blocksNormalAccess: true,
    eyebrow: "Generation status",
    title: input.projectStatus === "draft" ? "Project is not ready" : "Project generation in progress",
    message: "The project cannot be opened or changed until generation finishes and the completed result is verified.",
  };
  if (!capabilities.canView) return {
    kind: "unavailable",
    blocksNormalAccess: true,
    eyebrow: "Project status",
    title: "Project is unavailable",
    message: "This project is not currently available for normal viewing or changes.",
  };
  if (input.capabilityProfile === "legacy_view_only" || input.projectStatus === "archived"
    || !capabilities.canApplyAiSuggestion || !capabilities.canSelectScheme
    || !capabilities.canGenerateRender || !capabilities.canRetryRender) return {
    kind: "view_only",
    blocksNormalAccess: false,
    eyebrow: input.projectStatus === "archived" ? "Archived result" : "Legacy result",
    title: "Saved results only",
    message: PROJECT_VIEW_ONLY_EXPLANATION,
  };
  return null;
}

export function ProjectCapabilityNotice({
  presentation,
  compact = false,
}: {
  presentation: ProjectCapabilityPresentation;
  compact?: boolean;
}) {
  const Icon = presentation.kind === "deleting" || presentation.kind === "generating" ? Clock3
    : presentation.kind === "view_only" ? LockKeyhole : CircleAlert;

  if (compact) return <aside aria-label="Project access status" className="border border-[#c97940]/55 bg-[#17120e] p-4" role="status">
    <div className="flex items-start gap-3"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#ff8d49]" /><div><p className="text-[0.62rem] font-extrabold uppercase tracking-[0.13em] text-[#c97940]">{presentation.eyebrow} · {presentation.title}</p><p className="mt-2 text-xs leading-5 text-[#b5a697]">{presentation.message}</p></div></div>
  </aside>;

  return <section aria-label="Project access status" className="mx-auto max-w-2xl border border-[#c97940]/60 bg-[#11100e] p-7" role="status">
    <Icon className="h-6 w-6 text-[#ff8d49]" />
    <p className="mt-5 text-[0.63rem] font-extrabold uppercase tracking-[0.14em] text-[#c97940]">{presentation.eyebrow}</p>
    <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl">{presentation.title}</h1>
    <p className="mt-3 text-sm leading-6 text-[#b5a697]">{presentation.message}</p>
    <Link className="mt-6 inline-flex min-h-11 items-center border border-[#c97940] px-4 py-3 text-xs font-bold uppercase tracking-[0.12em]" href="/dashboard">Open dashboard</Link>
  </section>;
}
