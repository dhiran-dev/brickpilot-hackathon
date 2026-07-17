import type { CostEstimate } from "@/lib/cost/schema";

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
    const blockingDetail = firstConflict?.message
      ? ` Blocking condition${firstConflict.floorId ? ` on ${firstConflict.floorId}` : ""}: ${firstConflict.message}`
      : "";
    return {
      title: "This brief needs adjustment",
      message: `BrickPilot could not connect every requested room with valid walls, doors and circulation inside the current buildable envelope.${blockingDetail}`,
      code,
      actions: [...new Set([
        ...reportedActions,
        "Move one or more ground-floor rooms to an upper floor.",
        "Remove an optional courtyard, parking bay or secondary room.",
        "Increase the plot or reduce setbacks only where local rules permit.",
      ])].slice(0, 4),
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
