import type { ProjectCapabilityProfile } from "@/lib/server/project-capabilities";
import type { DesignPipelineContractVersion } from "@/lib/server/design-pipeline";

export type ProjectIssuanceMode = "v2" | "v3_internal" | "v3_ga";

export type ProjectIssuance = {
  contract: DesignPipelineContractVersion;
  generatorContractVersion: 2 | 3;
  capabilityProfile: ProjectCapabilityProfile;
  rolloutEpoch: string;
};

function allowlistedOwners(value: string | undefined) {
  return new Set((value ?? "").split(",").map((ownerId) => ownerId.trim()).filter(Boolean));
}

export function resolveProjectIssuance(input: {
  ownerId: string;
  mode?: string;
  v3OwnerAllowlist?: string;
  rolloutEpoch?: string;
}): ProjectIssuance {
  const requestedMode = input.mode?.trim();
  const mode: ProjectIssuanceMode = requestedMode === undefined || requestedMode === ""
    ? "v3_ga"
    : requestedMode === "v2" || requestedMode === "v3_internal" || requestedMode === "v3_ga"
      ? requestedMode
      : "v2";
  const explicitEpoch = input.rolloutEpoch?.trim();
  const issueV3 = mode === "v3_ga"
    || (mode === "v3_internal" && allowlistedOwners(input.v3OwnerAllowlist).has(input.ownerId));

  if (issueV3) return {
    contract: "v3",
    generatorContractVersion: 3,
    capabilityProfile: "current_v3",
    rolloutEpoch: explicitEpoch || (mode === "v3_ga" ? "v3-ga" : "v3-internal"),
  };
  return {
    contract: "v2",
    generatorContractVersion: 2,
    capabilityProfile: "current_v2",
    rolloutEpoch: explicitEpoch || (mode === "v3_internal" ? "v3-internal-control" : "v2-safety-default"),
  };
}

export function configuredProjectIssuance(ownerId: string): ProjectIssuance {
  return resolveProjectIssuance({
    ownerId,
    mode: process.env.BRICKPILOT_DESIGN_ROLLOUT_MODE,
    v3OwnerAllowlist: process.env.BRICKPILOT_V3_OWNER_ALLOWLIST,
    rolloutEpoch: process.env.BRICKPILOT_ROLLOUT_EPOCH,
  });
}
