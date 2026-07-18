import { emitLifecycleEvent } from "@/lib/server/project-lifecycle";

export type ProjectCapabilityProfile = "legacy_view_only" | "current_v2" | "current_v3";

export type ProjectLifecycleStatus = "draft" | "generating" | "ready" | "failed" | "archived" | "deleting";

export type ProjectCapabilities = {
  canView: boolean;
  canReadAssets: boolean;
  canDelete: boolean;
  canApplyAiSuggestion: boolean;
  canSelectScheme: boolean;
  canGenerateRender: boolean;
  canRetryRender: boolean;
};

const NONE: ProjectCapabilities = {
  canView: false,
  canReadAssets: false,
  canDelete: false,
  canApplyAiSuggestion: false,
  canSelectScheme: false,
  canGenerateRender: false,
  canRetryRender: false,
};

const VIEW_ONLY: ProjectCapabilities = {
  canView: true,
  canReadAssets: true,
  canDelete: true,
  canApplyAiSuggestion: false,
  canSelectScheme: false,
  canGenerateRender: false,
  canRetryRender: false,
};

const CURRENT: ProjectCapabilities = {
  ...VIEW_ONLY,
  canApplyAiSuggestion: true,
  canSelectScheme: true,
  canGenerateRender: true,
  canRetryRender: true,
};

const CURRENT_V3: ProjectCapabilities = { ...CURRENT };

export function resolveProjectCapabilities(
  profile: ProjectCapabilityProfile,
  status: ProjectLifecycleStatus,
): ProjectCapabilities {
  if (status === "deleting" || status === "draft" || status === "generating") return { ...NONE };
  if (status === "failed") return { ...NONE, canDelete: true };
  if (status === "archived") return { ...VIEW_ONLY };
  if (profile === "legacy_view_only") return { ...VIEW_ONLY };
  return profile === "current_v3" ? { ...CURRENT_V3 } : { ...CURRENT };
}

export type MutationCapability = "canApplyAiSuggestion" | "canSelectScheme" | "canGenerateRender" | "canRetryRender";

export function emitProjectMutationDenial(input: {
  projectId: string;
  layoutVersionId?: string;
  capability: MutationCapability;
  profile: ProjectCapabilityProfile;
  status: ProjectLifecycleStatus;
  phase: "preflight" | "transaction_recheck" | "provider_dispatch";
  code: "PROJECT_VIEW_ONLY" | "PROJECT_DELETING" | "PROJECT_NOT_READY";
}) {
  emitLifecycleEvent("capability_denial", {
    projectId: input.projectId,
    layoutVersionId: input.layoutVersionId,
    capability: input.capability,
    capabilityProfile: input.profile,
    projectStatus: input.status,
    phase: input.phase,
    code: input.code,
  });
}

export function projectCapabilityMetadata(
  profile: ProjectCapabilityProfile,
  status: ProjectLifecycleStatus,
  generatorContractVersion: number,
) {
  return {
    projectStatus: status,
    capabilityProfile: profile,
    generatorContractVersion,
    capabilities: resolveProjectCapabilities(profile, status),
  };
}

export function projectMutationDenial(
  profile: ProjectCapabilityProfile,
  status: ProjectLifecycleStatus,
  capability: MutationCapability,
): { code: "PROJECT_VIEW_ONLY" | "PROJECT_DELETING" | "PROJECT_NOT_READY"; message: string } | null {
  if (resolveProjectCapabilities(profile, status)[capability]) return null;
  if (status === "deleting") return { code: "PROJECT_DELETING", message: "This project is being deleted." };
  if (profile === "legacy_view_only" && (status === "ready" || status === "archived")) {
    return { code: "PROJECT_VIEW_ONLY", message: "This legacy project is view-only. Its saved results remain available." };
  }
  return { code: "PROJECT_NOT_READY", message: "This project is not ready for changes." };
}
