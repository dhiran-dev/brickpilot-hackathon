import { describe, expect, test } from "bun:test";

import { createCurrentRequirements, DEFAULT_INTAKE_DRAFT } from "@/components/guided-intake/model";
import { planPrimitives } from "@/components/deck/planPrimitives";
import {
  V3_OUTPUT_CONSUMER_BUILDING,
  V3_OUTPUT_CONSUMER_BUILT_AREA_MM2,
  V3_OUTPUT_CONSUMER_UNBUILT_AREA_MM2,
} from "@/lib/building/fixtures/v3-output-consumer";
import { estimateBuildingCost } from "@/lib/cost/estimate";
import { deriveQuantityTakeoff } from "@/lib/cost/quantity";
import { quantityTakeoffSchema } from "@/lib/cost/schema";
import type { DeckPayload } from "@/lib/design/deck";
import { deckScheduleView, deckValidationView } from "@/lib/design/deck-content";
import { buildDrawing } from "@/lib/drawing/build-drawing";
import { massingMetrics } from "@/lib/render/massing";

const requirements = createCurrentRequirements({
  ...DEFAULT_INTAKE_DRAFT,
  projectName: "Output consumer fixture",
  roofCharacter: "sloped",
});

const validation = {
  schemaVersion: "validation-report-v3" as const,
  rulePackVersion: "rules-v3-fixture",
  valid: true,
  score: 100,
  counts: { error: 0, warning: 0, info: 0 },
  findings: [],
};

function payload(): DeckPayload {
  return {
    projectId: "fixture-project",
    designId: "fixture-design",
    title: "Output consumer fixture",
    location: "Fixture",
    generatedAt: "2026-07-18T00:00:00.000Z",
    requirements,
    building: V3_OUTPUT_CONSUMER_BUILDING,
    validation,
    costEstimate: {
      estimateSchemaVersion: 1,
      generatedAt: "2026-07-18T00:00:00.000Z",
      currency: requirements.region.currency,
      locale: requirements.region.locale,
      warnings: [],
      status: "unavailable",
      confidence: "unavailable",
      reason: "no_rate_pack",
      improveConfidenceActions: [],
    },
    aiReview: null,
    scheme: {
      schemeId: "fixture-scheme",
      partiId: "consumer-fixture",
      name: "Consumer fixture",
      rationale: "Stable hand-authored output fixture.",
      building: V3_OUTPUT_CONSUMER_BUILDING,
      validation,
      evidence: ["Manual partial-floor fixture"],
      ladderRung: 0,
    },
    intentAssumptions: [],
    renders: { status: "idle", assets: [] },
  };
}

describe("v3 drawing, deck, CAD and cost consistency", () => {
  test("keeps a partial floor versioned and excludes intentional-unbuilt area everywhere", () => {
    const drawing = buildDrawing(V3_OUTPUT_CONSUMER_BUILDING, {
      scheme: { name: "Consumer fixture", partiId: "consumer-fixture", style: requirements.architecture.style },
    });
    const floor = drawing.floors[0];
    const takeoff = deriveQuantityTakeoff(V3_OUTPUT_CONSUMER_BUILDING);
    const deck = deckScheduleView(payload());
    const massing = massingMetrics(V3_OUTPUT_CONSUMER_BUILDING);

    expect(drawing.artifactSchemaVersion).toBe(3);
    expect(floor.artifactSchemaVersion).toBe(3);
    expect(floor.areaSchedule.reduce((sum, row) => sum + row.achievedAreaMm2, 0)).toBe(V3_OUTPUT_CONSUMER_BUILT_AREA_MM2);
    expect(takeoff.grossFloorAreaMm2).toBe(V3_OUTPUT_CONSUMER_BUILT_AREA_MM2);
    expect(deck.grandTotalM2).toBe("24.0");
    expect(massing.builtAreaM2 * 1_000_000).toBe(V3_OUTPUT_CONSUMER_BUILT_AREA_MM2);
    expect(floor.floorRegions?.map((region) => region.kind)).toEqual(["interior", "interior", "intentional_unbuilt"]);
    expect(floor.areaSchedule.map((row) => row.roomId)).toContain("circulation");
    expect(floor.intentionalUnbuiltRegions).toHaveLength(1);
    expect(floor.intentionalUnbuiltRegions?.[0].polygon).toEqual(V3_OUTPUT_CONSUMER_BUILDING.floors[0].regions[2].polygon.points);
    expect(V3_OUTPUT_CONSUMER_BUILT_AREA_MM2 + V3_OUTPUT_CONSUMER_UNBUILT_AREA_MM2).toBe(36_000_000);
  });

  test("keeps safety overlays while omitting deferred roof geometry from floor-plan consumers", () => {
    const artifact = buildDrawing(V3_OUTPUT_CONSUMER_BUILDING).floors[0];
    const primitives = planPrimitives(artifact);
    expect(artifact.mainEntryId).toBe("door-main");
    expect(artifact.openings.find((opening) => opening.id === "door-main")).toMatchObject({ role: "main_entry", isMainEntry: true, widthMm: 1200 });
    expect(artifact.roofOverlay).toEqual([]);
    expect(artifact.supports?.map((support) => support.id)).toContain("column-southwest");
    expect(artifact.guards?.map((guard) => guard.id)).toContain("guard-future-edge");
    expect(primitives.intentionalUnbuilt).toHaveLength(1);
    expect(primitives.roofLines).toEqual([]);
    expect(primitives.supportPoints).toHaveLength(1);
    expect(primitives.guardLines).toHaveLength(1);
  });

  test("reports actual roof and edge quantities without adding physical-system cost lines", () => {
    const quantities = deriveQuantityTakeoff(V3_OUTPUT_CONSUMER_BUILDING);
    expect("quantitySchemaVersion" in quantities && quantities.quantitySchemaVersion).toBe(3);
    if (!("quantitySchemaVersion" in quantities) || quantities.quantitySchemaVersion !== 3) throw new Error("expected v3 quantities");
    expect(quantities.roofSurfaceAreaMm2).toBeGreaterThan(V3_OUTPUT_CONSUMER_BUILT_AREA_MM2);
    expect(quantities.edgeProtectionLengthMm).toBe(6000);
    expect(quantities.informationalBasis).toContain("no separate unit rates");
    expect(quantityTakeoffSchema.parse(quantities)).toEqual(quantities);

    const estimate = estimateBuildingCost(V3_OUTPUT_CONSUMER_BUILDING, requirements, { generatedAt: new Date("2026-07-18T00:00:00.000Z") });
    if (estimate.status === "available") {
      expect(estimate.lineItems.map((line) => line.id)).toEqual(["base-building", "external-works", "professional-fees", "contingency", "tax"]);
      expect(estimate.assumptions.some((assumption) => assumption.includes("no separate unit rates or duplicate line items"))).toBe(true);
    }
  });

  test("renders every v3 validation category without assuming the v2 category set", () => {
    const view = deckValidationView(payload());
    expect(view.categories.map((category) => category.id)).toEqual(expect.arrayContaining(["circulation", "accessibility", "architecture", "site", "safety", "scheme_set"]));
  });
});
