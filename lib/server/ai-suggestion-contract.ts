import { applyRequirementDelta } from "@/lib/ai/apply-delta";
import type { RequirementDelta } from "@/lib/ai/schema";
import {
  currentBuildingRequirementsSchema,
  legacyBuildingRequirementsSchema,
  type CurrentBuildingRequirements,
  type LegacyBuildingRequirements,
} from "@/lib/building/requirements";
import type { ProjectCapabilityProfile } from "@/lib/server/project-capabilities";
import {
  runDesignPipelineForContract,
  type CurrentPipelineResult,
  type LegacyPipelineResult,
} from "@/lib/server/design-pipeline";

export type AiSuggestionSource =
  | { contract: "v2"; requirements: LegacyBuildingRequirements }
  | { contract: "v3"; requirements: CurrentBuildingRequirements };

export class AiSuggestionContractError extends Error {
  readonly code = "REQUIREMENTS_CONTRACT_MISMATCH";

  constructor(message: string) {
    super(message);
    this.name = "AiSuggestionContractError";
  }
}

export type AiSuggestionRevision =
  | { contract: "v2"; requirements: LegacyBuildingRequirements; pipelineResult: LegacyPipelineResult }
  | { contract: "v3"; requirements: CurrentBuildingRequirements; pipelineResult: CurrentPipelineResult };

export type PreparedAiSuggestionRevision =
  | { contract: "v2"; requirements: LegacyBuildingRequirements }
  | { contract: "v3"; requirements: CurrentBuildingRequirements };

export type AiSuggestionPipelineRunners = {
  v2: (requirements: LegacyBuildingRequirements) => Promise<LegacyPipelineResult>;
  v3: (requirements: CurrentBuildingRequirements) => Promise<CurrentPipelineResult>;
};

const DEFAULT_PIPELINE_RUNNERS: AiSuggestionPipelineRunners = {
  v2: (requirements) => runDesignPipelineForContract("v2", requirements),
  v3: (requirements) => runDesignPipelineForContract("v3", requirements),
};

/**
 * Resolves the exact mutation contract issued to the project. A profile/version disagreement is
 * treated as corrupted lifecycle state; silently upgrading or downgrading requirements would lose
 * provenance or expose v3-only intent to the frozen v2 generator.
 */
export function parseAiSuggestionSource(input: {
  capabilityProfile: ProjectCapabilityProfile;
  generatorContractVersion: number;
  requirements: unknown;
}): AiSuggestionSource {
  if (input.capabilityProfile === "current_v3" && input.generatorContractVersion === 3) {
    const parsed = currentBuildingRequirementsSchema.safeParse(input.requirements);
    if (parsed.success) return { contract: "v3", requirements: parsed.data };
    throw new AiSuggestionContractError("This project's requirements do not match its issued v3 generation contract.");
  }
  if (input.capabilityProfile === "current_v2" && input.generatorContractVersion === 2) {
    const parsed = legacyBuildingRequirementsSchema.safeParse(input.requirements);
    if (parsed.success) return { contract: "v2", requirements: parsed.data };
    throw new AiSuggestionContractError("This project's requirements do not match its issued v2 generation contract.");
  }
  throw new AiSuggestionContractError("The project capability profile and generation contract version do not agree.");
}

/** Applies only the bounded room delta and retains the exact issued schema. */
export function prepareAiSuggestionRevision(
  source: AiSuggestionSource,
  delta: RequirementDelta,
  seed: number,
): PreparedAiSuggestionRevision {
  if (source.contract === "v3") {
    const requirements = { ...applyRequirementDelta(source.requirements, delta), seed };
    return { contract: "v3", requirements };
  }
  const requirements = { ...applyRequirementDelta(source.requirements, delta), seed };
  return { contract: "v2", requirements };
}

/** Runs only the pipeline matching the already prepared requirement contract. */
export async function runPreparedAiSuggestionRevision(
  prepared: PreparedAiSuggestionRevision,
  runners: AiSuggestionPipelineRunners = DEFAULT_PIPELINE_RUNNERS,
): Promise<AiSuggestionRevision> {
  if (prepared.contract === "v3") {
    return { ...prepared, pipelineResult: await runners.v3(prepared.requirements) };
  }
  return { ...prepared, pipelineResult: await runners.v2(prepared.requirements) };
}

/** Convenience composition for non-transactional callers and focused contract tests. */
export async function createAiSuggestionRevision(
  source: AiSuggestionSource,
  delta: RequirementDelta,
  seed: number,
  runners: AiSuggestionPipelineRunners = DEFAULT_PIPELINE_RUNNERS,
): Promise<AiSuggestionRevision> {
  return runPreparedAiSuggestionRevision(prepareAiSuggestionRevision(source, delta, seed), runners);
}
