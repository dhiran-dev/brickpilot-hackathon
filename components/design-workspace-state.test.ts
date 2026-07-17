import { describe, expect, test } from "bun:test";

import { explainGenerationFailure, parseWorkspaceStep, relaxationNotice, restoredWorkspaceStep, schemeEvidenceLabels } from "@/components/design-workspace-state";

describe("workspace design state matrix", () => {
  test("names compact fallback without hiding earlier ladder rungs", () => {
    expect(relaxationNotice(0)).toBeNull();
    expect(relaxationNotice(2)).toBe("Relaxation rung 2");
    expect(relaxationNotice(3)).toBe("Compact fallback used");
  });

  test("never presents stale cost or review evidence as current", () => {
    expect(schemeEvidenceLabels({ previewIsCanonical: false, selecting: false, costStatus: "available", reviewStatus: "reviewed" }))
      .toEqual({ busy: false, cost: "Updates on select", review: "Updates on select" });
    expect(schemeEvidenceLabels({ previewIsCanonical: true, selecting: true, costStatus: "available", reviewStatus: "reviewed" }))
      .toEqual({ busy: true, cost: "Updating…", review: "Updating…" });
    expect(schemeEvidenceLabels({ previewIsCanonical: true, selecting: false, costStatus: "unavailable", reviewStatus: "unavailable" }))
      .toEqual({ busy: false, cost: "Unavailable", review: "Unavailable" });
  });

  test("maps the typed watchdog timeout to an honest retry state with no partial result", () => {
    const state = explainGenerationFailure({
      code: "GENERATION_TIMEOUT",
      details: { constructedCandidateCount: 12, plannedCandidateCount: 18, watchdogMs: 8_000 },
    });

    expect(state).toEqual({
      title: "Generation took longer than the safe search window",
      message: "No partial scheme was saved. Retry the same brief, or simplify one optional room or court if the timeout repeats.",
      code: "GENERATION_TIMEOUT",
      actions: ["Retry the unchanged brief.", "Reduce one optional space or use the compact form strategy."],
    });
  });

  test("turns rung-4 exhaustion into floor-specific, reversible rescue guidance", () => {
    const state = explainGenerationFailure({
      code: "NO_FEASIBLE_LAYOUT",
      details: [{
        floorId: "floor-2",
        ruleId: "CIRCULATION_REACHABLE",
        message: "Bedroom 4 cannot reach the stair lobby.",
        suggestedAction: "Remove one bedroom from Floor 2.",
      }],
    });

    expect(state.message).toContain("Blocking condition on floor-2: Bedroom 4 cannot reach the stair lobby.");
    expect(state.actions[0]).toBe("Remove one bedroom from Floor 2.");
    expect(state.actions).toContain("Move one or more ground-floor rooms to an upper floor.");
    expect(state.code).toBe("NO_FEASIBLE_LAYOUT");
  });

  test("preserves the capacity error's blocking floor and offers reductions", () => {
    const state = explainGenerationFailure({
      code: "UNSUPPORTED_PROGRAM_TOPOLOGY",
      error: "Floor 3 needs 72.0 m² but only 61.4 m² remains after the stair core.",
    });

    expect(state.message).toStartWith("Floor 3 needs");
    expect(state.actions).toEqual([
      "Reduce room counts or optional spaces.",
      "Move rooms to another floor.",
      "Use a larger buildable envelope.",
    ]);
  });
});

describe("workspace step derivation", () => {
  test("parses only the two in-page steps from the URL", () => {
    expect(parseWorkspaceStep("directions")).toBe("directions");
    expect(parseWorkspaceStep("plan")).toBe("plan");
    expect(parseWorkspaceStep("massing")).toBeNull();
    expect(parseWorkspaceStep("")).toBeNull();
    expect(parseWorkspaceStep(null)).toBeNull();
    expect(parseWorkspaceStep(undefined)).toBeNull();
  });

  test("deep-linked steps win over the returning-user default", () => {
    expect(restoredWorkspaceStep({ requestedStep: "directions", rackVisible: true, schemeSelected: true })).toBe("directions");
    expect(restoredWorkspaceStep({ requestedStep: "plan", rackVisible: true, schemeSelected: false })).toBe("plan");
  });

  test("a returning user lands on the plan unless the rack still needs a selection", () => {
    expect(restoredWorkspaceStep({ requestedStep: null, rackVisible: false, schemeSelected: true })).toBe("plan");
    expect(restoredWorkspaceStep({ requestedStep: null, rackVisible: true, schemeSelected: true })).toBe("plan");
    expect(restoredWorkspaceStep({ requestedStep: undefined, rackVisible: true, schemeSelected: false })).toBe("directions");
  });
});
