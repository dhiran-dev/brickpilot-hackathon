import type { CostEstimate } from "@/lib/cost/schema";
import type { GenerationDiagnostics } from "@/lib/building/generate";

export type GenerationConflict = {
  floorId?: string;
  message?: string;
  ruleId?: string;
  suggestedAction?: string;
};

export type GenerationDiagnosticsSummary = {
  constructedCandidateCount?: number;
  plannedCandidateCount?: number;
  watchdogMs?: number;
};

export type WorkspaceError = {
  title: string;
  message: string;
  code?: string;
  actions: string[];
};

const LEGACY_V3_RATIONALE = "Canonical v3 geometry passed the complete deterministic physical and circulation rule pack.";
const FRIENDLY_V3_RATIONALE = "The plan keeps the requested spaces, access routes, and physical systems coordinated.";

const REALIZED_EVIDENCE: Record<string, string> = {
  "entry.primarySide": "The main entrance is placed on the selected road-facing side.",
  roof: "Roof geometry is coordinated with the building model.",
  courtyard: "The courtyard choice is reflected in the plan.",
  aboveParkingUse: "The space above parking is used as requested.",
  outdoorAreas: "Requested balconies, verandahs, and terraces are included.",
  "parking.preferredSide": "Vehicle access is placed on the selected parking side.",
  shadeStructures: "Requested pergolas and canopies are included.",
};

function humanizeEvidencePath(path: string) {
  return path
    .replaceAll(".", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function normalizeSchemeEvidence(items: readonly string[]) {
  const normalized = items.map((item) => {
    const separator = item.lastIndexOf(":");
    if (separator < 1) return item;
    const path = item.slice(0, separator);
    const status = item.slice(separator + 1);
    if (status === "realized") return REALIZED_EVIDENCE[path] ?? `${humanizeEvidencePath(path)} is included as requested.`;
    if (status === "relaxed") return `${humanizeEvidencePath(path)} was adjusted to keep the plan feasible.`;
    if (status === "incompatible") return `${humanizeEvidencePath(path)} could not be included in this direction.`;
    return item;
  });
  return [...new Set(normalized)];
}

export function schemeRationaleForDisplay(rationale: string) {
  if (rationale === LEGACY_V3_RATIONALE) return FRIENDLY_V3_RATIONALE;
  return rationale.replace(/\s+at relaxation rung \d+(?=\.)/gi, "");
}

export function isLegacyGenerationDiagnostics(value: unknown): value is GenerationDiagnostics {
  if (!value || typeof value !== "object") return false;
  const diagnostics = value as Record<string, unknown>;
  if (!Array.isArray(diagnostics.quotaUsage)
    || typeof diagnostics.watchdogMs !== "number"
    || typeof diagnostics.candidateCeiling !== "number"
    || typeof diagnostics.plannedCandidateCount !== "number"
    || typeof diagnostics.constructedCandidateCount !== "number"
    || typeof diagnostics.evaluatedCandidateCount !== "number") return false;
  return diagnostics.quotaUsage.every((usage) => {
    if (!usage || typeof usage !== "object") return false;
    const entry = usage as Record<string, unknown>;
    return typeof entry.partiId === "string"
      && typeof entry.rung === "number"
      && typeof entry.relaxationId === "string"
      && typeof entry.simplifiedCourt === "boolean"
      && typeof entry.quota === "number"
      && typeof entry.attempted === "number";
  });
}

export function explainGenerationFailure(payload: {
  error?: string;
  code?: string;
  details?: GenerationConflict[] | GenerationDiagnosticsSummary;
}): WorkspaceError {
  const code = payload.code;
  if (code === "NO_FEASIBLE_LAYOUT") {
    const conflicts = Array.isArray(payload.details) ? payload.details : [];
    const reportedActions = conflicts
      .map((conflict) => conflict.suggestedAction)
      .filter((action): action is string => Boolean(action));
    const firstConflict = conflicts[0];
    const affectedFloors = [...new Set(conflicts
      .map((conflict) => conflict.floorId)
      .filter((floorId): floorId is string => Boolean(floorId)))];
    const affectedFloorDetail = affectedFloors.length > 0
      ? ` Affected floor${affectedFloors.length === 1 ? "" : "s"}: ${affectedFloors.join(", ")}.`
      : "";
    const blockingDetail = firstConflict?.message
      ? ` Blocking condition${firstConflict.floorId ? ` on ${firstConflict.floorId}` : ""}: ${firstConflict.message}`
      : "";
    const fallbackActions = [
      "Move one room from the affected floor to another modeled floor.",
      "Increase plot dimensions; reduce setbacks only where local rules permit.",
      "Reduce a flexible room-area target without going below its minimum.",
    ];
    return {
      title: "This brief needs adjustment",
      message: `BrickPilot could not arrange every requested space with valid room areas, frontage and protected circulation inside the current buildable envelope.${affectedFloorDetail}${blockingDetail}`,
      code,
      actions: [...new Set(reportedActions.length > 0 ? reportedActions : fallbackActions)].slice(0, 4),
    };
  }
  if (code === "GENERATION_TIMEOUT") return {
    title: "Generation took longer than the safe search window",
    message: "No partial scheme was saved. Retry the same brief, or simplify one optional room or court if the timeout repeats.",
    code,
    actions: ["Retry the unchanged brief.", "Reduce one optional space or use the compact form strategy."],
  };
  if (code === "UNSUPPORTED_PROGRAM_TOPOLOGY") return {
    title: "The room programme exceeds the available floor area",
    message: payload.error ?? "The minimum requested areas do not fit after setbacks and the stair core are reserved.",
    code,
    actions: ["Reduce room counts or optional spaces.", "Move rooms to another floor.", "Use a larger buildable envelope."],
  };
  if (code === "RATE_LIMITED") return {
    title: "Generation limit reached",
    message: payload.error ?? "Try again tomorrow.",
    code,
    actions: [],
  };
  if (code === "INCOMPLETE_ROOM_PROGRAM") return {
    title: "The room programme is incomplete",
    message: payload.error ?? "Add at least one bedroom and one bathroom.",
    code,
    actions: ["Open the Rooms step and add the missing core room."],
  };
  return {
    title: "Generation could not start",
    message: payload.error ?? "Unable to generate this study.",
    code,
    actions: ["Review the questionnaire and try again."],
  };
}

export function relaxationNotice(rung: number) {
  if (rung <= 0) return null;
  return rung === 3 ? "Compact fallback used" : `Relaxation rung ${rung}`;
}

export type SchemeEvidenceState = {
  busy: boolean;
  cost: "Updating…" | "Updates on select" | "Available" | "Unavailable";
  review: "Updating…" | "Updates on select" | "Reviewed" | "Unavailable";
};

// The two steps that live inside the workspace result view. Massing and render
// are separate routes, so they never appear in the ?step= param here.
export type WorkspaceStep = "directions" | "plan";

export function parseWorkspaceStep(value: string | null | undefined): WorkspaceStep | null {
  return value === "directions" || value === "plan" ? value : null;
}

// A study reopened from a deep link or the recent-study list lands on the 2D plan,
// because its direction was already chosen — except when the comparison rack is
// enabled and no scheme has been confirmed, which the directions step must resolve.
export function restoredWorkspaceStep(input: {
  requestedStep?: string | null;
  rackVisible: boolean;
  schemeSelected: boolean;
}): WorkspaceStep {
  const requested = parseWorkspaceStep(input.requestedStep);
  if (requested) return requested;
  return input.rackVisible && !input.schemeSelected ? "directions" : "plan";
}

export function schemeEvidenceLabels(input: {
  previewIsCanonical: boolean;
  selecting: boolean;
  costStatus: CostEstimate["status"];
  reviewStatus?: "reviewed" | "unavailable";
}): SchemeEvidenceState {
  if (input.selecting) return { busy: true, cost: "Updating…", review: "Updating…" } as const;
  if (!input.previewIsCanonical) return { busy: false, cost: "Updates on select", review: "Updates on select" } as const;
  return {
    busy: false,
    cost: input.costStatus === "available" ? "Available" : "Unavailable",
    review: input.reviewStatus === "reviewed" ? "Reviewed" : "Unavailable",
  } as const;
}
