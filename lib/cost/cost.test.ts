import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import type { BuildingRequirements } from "@/lib/building/requirements";
import type { Building } from "@/lib/building/schema";
import {
  costEstimateSchema,
  estimateBuildingCost,
  estimateReconciles,
  formatCurrencyMinor,
  formatEstimateRange,
  INDIA_DELHI_FEASIBILITY_2026_07,
  ratePackSchema,
  selectRatePack,
} from "@/lib/cost";
import { deriveQuantityTakeoff } from "@/lib/cost/quantity";

function requirements(overrides: Partial<BuildingRequirements["region"]> = {}): BuildingRequirements {
  return {
    requirementSchemaVersion: 2,
    projectName: "Cost test house",
    buildingType: "detached_house",
    region: {
      countryCode: "IN",
      adminArea: "Delhi",
      locality: "New Delhi",
      locale: "en-IN",
      currency: "INR",
      ...overrides,
    },
    displayUnit: "metric",
    site: {
      widthMm: 12_000,
      depthMm: 18_000,
      facing: "south",
      roadEdges: ["south"],
      irregular: false,
      setbacksMm: { north: 1_000, east: 1_000, south: 1_000, west: 1_000 },
    },
    floors: [{ id: "F0", label: "Ground", level: 0, floorHeightMm: 3_000 }],
    rooms: [{
      id: "living",
      name: "Living",
      type: "living",
      floorId: "F0",
      minAreaMm2: 12_000_000,
      targetAreaMm2: 20_000_000,
      privacy: "public",
      preferredZone: "any",
      mustBeExterior: true,
      accessible: false,
    }],
    relationships: [],
    household: { occupants: 4, accessibilityRequired: false },
    vertical: { stairFamily: "dog_leg", stairWidthMm: 1_000, liftProvision: false },
    architecture: { style: "contemporary_tropical", formStrategy: "stepped_terraces", roofCharacter: "mixed", materialDirection: "warm_natural" },
    budget: { qualityTier: "standard", contingencyPercent: 7.5, taxPercent: 18 },
    seed: 42,
  };
}

const building: Building = {
  buildingSchemaVersion: 2,
  algorithmVersion: "test",
  rulePackVersion: "test",
  rendererVersion: "test",
  seed: 42,
  candidate: { generatorId: "test", index: 0, score: 1, geometryHash: "test" },
  site: {
    widthMm: 12_000,
    depthMm: 18_000,
    facing: "south",
    roadEdges: ["south"],
    buildableEnvelope: { x: 1_000, y: 1_000, width: 10_000, depth: 16_000 },
  },
  floors: [{
    id: "F0",
    label: "Ground",
    level: 0,
    elevationMm: 0,
    floorHeightMm: 3_000,
    envelope: { x: 1_000, y: 1_000, width: 10_000, depth: 10_000 },
    spaces: [{
      id: "living",
      floorId: "F0",
      name: "Living",
      type: "living",
      planningCellPolygon: { points: [{ x: 1_000, y: 1_000 }, { x: 11_000, y: 1_000 }, { x: 11_000, y: 11_000 }, { x: 1_000, y: 11_000 }] },
      bounds: { x: 1_000, y: 1_000, width: 10_000, depth: 10_000 },
      areaMm2: 100_000_000,
      occupied: true,
      accessible: false,
    }],
    walls: [],
    openings: [],
  }],
  verticalConnectors: [],
};

describe("regional cost engine", () => {
  test("produces integer minor-unit bands that reconcile exactly", () => {
    const estimate = estimateBuildingCost(building, requirements(), {
      generatedAt: new Date("2026-07-15T00:00:00.000Z"),
    });

    expect(estimate.status).toBe("available");
    expect(costEstimateSchema.parse(estimate)).toEqual(estimate);
    expect(estimateReconciles(estimate)).toBe(true);
    if (estimate.status !== "available") throw new Error("Expected an available estimate");
    expect(estimate.quantities.grossFloorAreaMm2).toBe(100_000_000);
    expect(estimate.lineItems.every((line) => Object.values(line.amounts).every(Number.isSafeInteger))).toBe(true);

    const lineTotal = estimate.lineItems.reduce((sum, line) => sum + line.amounts.expectedMinor, 0);
    expect(lineTotal).toBe(estimate.total.expectedMinor);
    expect(estimate.subtotals.construction.expectedMinor).toBe(
      estimate.lineItems[0]!.amounts.expectedMinor + estimate.lineItems[1]!.amounts.expectedMinor,
    );
  });

  test("does not count open terrace or courtyard voids as gross floor area", () => {
    const withOpenArea = structuredClone(building);
    withOpenArea.floors[0].spaces[0].bounds.width = 8_000;
    withOpenArea.floors[0].spaces[0].planningCellPolygon.points[1].x = 9_000;
    withOpenArea.floors[0].spaces[0].planningCellPolygon.points[2].x = 9_000;
    withOpenArea.floors[0].spaces[0].areaMm2 = 80_000_000;
    withOpenArea.floors[0].spaces.push({
      id: "open-terrace",
      floorId: "F0",
      name: "Open terrace / unbuilt",
      type: "terrace",
      planningCellPolygon: { points: [{ x: 9_000, y: 1_000 }, { x: 11_000, y: 1_000 }, { x: 11_000, y: 11_000 }, { x: 9_000, y: 11_000 }] },
      bounds: { x: 9_000, y: 1_000, width: 2_000, depth: 10_000 },
      areaMm2: 20_000_000,
      occupied: false,
      accessible: false,
    });
    expect(deriveQuantityTakeoff(withOpenArea).grossFloorAreaMm2).toBe(80_000_000);
  });

  test("counts covered open-sided verandahs at half area", () => {
    const withVerandah = structuredClone(building);
    withVerandah.floors[0].spaces.push({
      id: "front-verandah",
      floorId: "F0",
      name: "Front verandah",
      type: "verandah",
      planningCellPolygon: { points: [{ x: 1_000, y: 11_000 }, { x: 11_000, y: 11_000 }, { x: 11_000, y: 13_000 }, { x: 1_000, y: 13_000 }] },
      bounds: { x: 1_000, y: 11_000, width: 10_000, depth: 2_000 },
      areaMm2: 20_000_000,
      occupied: false,
      accessible: false,
    });

    expect(deriveQuantityTakeoff(withVerandah).grossFloorAreaMm2).toBe(110_000_000);
  });

  test("selects locality, admin-area, and labelled India reference fallback in order", () => {
    const packs = [INDIA_DELHI_FEASIBILITY_2026_07];
    const date = new Date("2026-07-15T00:00:00.000Z");
    const locality = selectRatePack(requirements(), packs, date);
    const admin = selectRatePack(requirements({ locality: undefined }), packs, date);
    const fallback = selectRatePack(requirements({ adminArea: "Kerala", locality: "Kochi" }), packs, date);

    expect(locality.status === "selected" && locality.match).toBe("locality");
    expect(admin.status === "selected" && admin.match).toBe("admin_area");
    expect(fallback.status === "selected" && fallback.match).toBe("country_reference");
    expect(fallback.status === "selected" && fallback.confidence).toBe("C");
    expect(fallback.warnings.map((warning) => warning.code)).toContain("REFERENCE_FALLBACK");
  });

  test("formats native INR without converting the estimate", () => {
    expect(formatCurrencyMinor(1_234_567_800, "INR", "en-IN")).toBe("₹1,23,45,678");
    expect(formatCurrencyMinor(1_234, "JPY", "en-US")).toBe("¥1,234");
    expect(formatEstimateRange({ lowMinor: 10_000_000, expectedMinor: 12_000_000, highMinor: 15_000_000 }, "INR", "en-IN"))
      .toBe("₹1,00,000–₹1,50,000");
  });

  test("returns unavailable for an unsupported region instead of converting India rates", () => {
    const estimate = estimateBuildingCost(building, requirements({
      countryCode: "US",
      adminArea: "California",
      locality: "San Francisco",
      locale: "en-US",
      currency: "USD",
    }), { generatedAt: new Date("2026-07-15T00:00:00.000Z") });

    expect(estimate.status).toBe("unavailable");
    expect(estimate.confidence).toBe("unavailable");
    expect(estimate.warnings.map((warning) => warning.code)).toContain("COST_REGION_UNSUPPORTED");
  });

  test("refuses a mismatched display currency", () => {
    const estimate = estimateBuildingCost(building, requirements({ currency: "USD" }), {
      generatedAt: new Date("2026-07-15T00:00:00.000Z"),
    });
    expect(estimate.status).toBe("unavailable");
    expect(estimate.status === "unavailable" && estimate.reason).toBe("currency_mismatch");
    expect(estimate.warnings.map((warning) => warning.code)).toContain("CURRENCY_MISMATCH");
  });

  test("downgrades stale packs and exposes the warning", () => {
    const selection = selectRatePack(requirements(), [INDIA_DELHI_FEASIBILITY_2026_07], new Date("2029-01-01T00:00:00.000Z"));
    expect(selection.status).toBe("selected");
    expect(selection.status === "selected" && selection.stale).toBe(true);
    expect(selection.status === "selected" && selection.confidence).toBe("C");
    expect(selection.warnings.map((warning) => warning.code)).toContain("STALE_RATE_PACK");
  });

  test("supports the complete A/B/C/D/unavailable confidence contract", () => {
    const date = new Date("2026-07-15T00:00:00.000Z");
    const verifiedLocal = {
      ...INDIA_DELHI_FEASIBILITY_2026_07,
      status: "verified_local" as const,
      sourceConfidence: "A" as const,
    };
    const exact = selectRatePack(requirements(), [verifiedLocal], date);
    const reviewed = selectRatePack(requirements(), [INDIA_DELHI_FEASIBILITY_2026_07], date);
    const fallback = selectRatePack(requirements({ adminArea: "Kerala", locality: "Kochi" }), [INDIA_DELHI_FEASIBILITY_2026_07], date);
    const staleFallback = selectRatePack(requirements({ adminArea: "Kerala", locality: "Kochi" }), [INDIA_DELHI_FEASIBILITY_2026_07], new Date("2029-01-01T00:00:00.000Z"));
    const unavailable = selectRatePack(requirements({ countryCode: "US", adminArea: "California", currency: "USD" }), [INDIA_DELHI_FEASIBILITY_2026_07], date);

    expect(exact.status === "selected" && exact.confidence).toBe("A");
    expect(reviewed.status === "selected" && reviewed.confidence).toBe("B");
    expect(fallback.status === "selected" && fallback.confidence).toBe("C");
    expect(staleFallback.status === "selected" && staleFallback.confidence).toBe("D");
    expect(unavailable.status).toBe("unavailable");
  });

  test("ships a schema-valid, explicit feasibility reference artifact", () => {
    expect(ratePackSchema.parse(INDIA_DELHI_FEASIBILITY_2026_07)).toEqual(INDIA_DELHI_FEASIBILITY_2026_07);
    expect(INDIA_DELHI_FEASIBILITY_2026_07.name).toContain("feasibility reference");
    expect(INDIA_DELHI_FEASIBILITY_2026_07.sources.some((source) => source.note?.includes("not represented as a verbatim CPWD rate"))).toBe(true);
    const { checksum, ...payload } = INDIA_DELHI_FEASIBILITY_2026_07;
    const calculated = `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
    expect(checksum).toBe(calculated);
  });
});
