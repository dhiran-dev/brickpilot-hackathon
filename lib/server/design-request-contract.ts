import {
  currentBuildingRequirementsSchema,
  legacyBuildingRequirementsSchema,
} from "@/lib/building/requirements";
import type { DesignPipelineContractVersion } from "@/lib/server/design-pipeline";

/** Selects the exact issued mutation contract without silently adapting versions. */
export function parseIssuedDesignRequirements(body: unknown, contract: DesignPipelineContractVersion) {
  const envelope = body && typeof body === "object" ? body as Record<string, unknown> : null;
  const primaryCandidate = envelope && "requirements" in envelope ? envelope.requirements : body;
  const candidate = contract === "v3"
    ? primaryCandidate
    : envelope && "legacyRequirements" in envelope
      ? envelope.legacyRequirements
      : primaryCandidate;
  return contract === "v3"
    ? currentBuildingRequirementsSchema.safeParse(candidate)
    : legacyBuildingRequirementsSchema.safeParse(candidate);
}
