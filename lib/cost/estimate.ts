import type { ReadableBuildingRequirements } from "@/lib/building/requirements";
import type { ReadableBuilding } from "@/lib/building/schema";
import { deriveQuantityTakeoff } from "@/lib/cost/quantity";
import type { CostEstimate, CostLineItem, EstimateBand, RatePack } from "@/lib/cost/schema";
import { selectRatePack } from "@/lib/cost/selection";
import { BUILTIN_RATE_PACKS } from "@/lib/cost/rate-packs/india-delhi-feasibility-2026-07";

const BASIS_POINTS = 10_000n;
const SQUARE_METRE_MM2 = 1_000_000n;

function safeNumber(value: bigint) {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new RangeError("Cost result exceeds safe integer range.");
  return result;
}

function roundDivide(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n) return -roundDivide(-numerator, denominator);
  return (numerator + denominator / 2n) / denominator;
}

function areaRate(areaMm2: number, rateMinorPerSquareMetre: number) {
  return safeNumber(roundDivide(BigInt(areaMm2) * BigInt(rateMinorPerSquareMetre), SQUARE_METRE_MM2));
}

function applyBasisPoints(amountMinor: number, basisPoints: number) {
  return safeNumber(roundDivide(BigInt(amountMinor) * BigInt(basisPoints), BASIS_POINTS));
}

function mapBand(band: EstimateBand, operation: (amount: number) => number): EstimateBand {
  return { lowMinor: operation(band.lowMinor), expectedMinor: operation(band.expectedMinor), highMinor: operation(band.highMinor) };
}

function addBands(...bands: EstimateBand[]): EstimateBand {
  return bands.reduce<EstimateBand>((sum, band) => ({
    lowMinor: sum.lowMinor + band.lowMinor,
    expectedMinor: sum.expectedMinor + band.expectedMinor,
    highMinor: sum.highMinor + band.highMinor,
  }), { lowMinor: 0, expectedMinor: 0, highMinor: 0 });
}

function factorForFloorCount(pack: RatePack, floorCount: number) {
  if (floorCount === 1) return pack.factorsBasisPoints.floorCount.one;
  if (floorCount === 2) return pack.factorsBasisPoints.floorCount.two;
  if (floorCount === 3) return pack.factorsBasisPoints.floorCount.three;
  return pack.factorsBasisPoints.floorCount.four;
}

function calculateBase(pack: RatePack, areaMm2: number, factors: number[]): EstimateBand {
  let band = mapBand(pack.baseRate, (rate) => areaRate(areaMm2, rate));
  for (const factor of factors) band = mapBand(band, (amount) => applyBasisPoints(amount, factor));
  return band;
}

function percentageLine(id: CostLineItem["id"], label: string, category: CostLineItem["category"], basis: string, base: EstimateBand, basisPoints: number): CostLineItem {
  return { id, label, category, basis, amounts: mapBand(base, (amount) => applyBasisPoints(amount, basisPoints)) };
}

export interface EstimateOptions {
  ratePacks?: readonly RatePack[];
  asOf?: Date;
  generatedAt?: Date;
}

export function estimateBuildingCost(building: ReadableBuilding, requirements: ReadableBuildingRequirements, options: EstimateOptions = {}): CostEstimate {
  const generatedAt = options.generatedAt ?? new Date();
  const selection = selectRatePack(requirements, options.ratePacks ?? BUILTIN_RATE_PACKS, options.asOf ?? generatedAt);
  const common = {
    estimateSchemaVersion: 1 as const,
    generatedAt: generatedAt.toISOString(),
    currency: requirements.region.currency,
    locale: requirements.region.locale,
    warnings: selection.warnings,
  };

  if (selection.status === "unavailable") {
    return {
      ...common,
      status: "unavailable",
      confidence: "unavailable",
      reason: selection.reason,
      improveConfidenceActions: ["Add or review a native-currency rate pack for this project locality.", "Request a local quantity surveyor or contractor feasibility estimate."],
    };
  }

  const { pack } = selection;
  const quantities = deriveQuantityTakeoff(building);
  const qualityFactor = pack.factorsBasisPoints.qualityTier[requirements.budget.qualityTier];
  const floorFactor = factorForFloorCount(pack, quantities.floorCount);
  const factors = [qualityFactor, floorFactor, pack.factorsBasisPoints.siteConditions, pack.factorsBasisPoints.localityIndex];
  const baseAmounts = calculateBase(pack, quantities.grossFloorAreaMm2, factors);
  const baseLine: CostLineItem = {
    id: "base-building",
    label: "Base building works",
    category: "base_building",
    basis: `${quantities.grossFloorAreaMm2} mm² GFA × feasibility rate × quality/floor/site/locality factors`,
    amounts: baseAmounts,
  };
  const externalLine = percentageLine("external-works", "External works allowance", "external_works", "Percentage of base building works", baseAmounts, pack.allowancesBasisPoints.externalWorks);
  const construction = addBands(baseLine.amounts, externalLine.amounts);
  const feesLine = percentageLine("professional-fees", "Professional fees allowance", "professional_fees", "Percentage of base building and external works", construction, pack.allowancesBasisPoints.professionalFees);
  const preContingency = addBands(construction, feesLine.amounts);
  const contingencyBasisPoints = Math.round(requirements.budget.contingencyPercent * 100);
  const contingencyLine = percentageLine("contingency", "Contingency", "contingency", "Project contingency percentage applied before tax", preContingency, contingencyBasisPoints);
  const preTax = addBands(preContingency, contingencyLine.amounts);
  const taxBasisPoints = Math.round(requirements.budget.taxPercent * 100);
  const taxLine = percentageLine("tax", "Tax allowance", "tax", "User-provided tax percentage applied after contingency", preTax, taxBasisPoints);
  const lineItems = [baseLine, externalLine, feesLine, contingencyLine, taxLine];
  const feesAndContingency = addBands(feesLine.amounts, contingencyLine.amounts);
  const total = addBands(...lineItems.map((line) => line.amounts));

  return {
    ...common,
    status: "available",
    confidence: selection.confidence,
    selection: {
      match: selection.match,
      ratePackVersion: pack.ratePackVersion,
      ratePackName: pack.name,
      effectiveDate: pack.effectiveDate,
      stale: selection.stale,
    },
    quantities,
    appliedFactors: [
      { id: "quality-tier", label: `${requirements.budget.qualityTier} specification`, basisPoints: qualityFactor },
      { id: "floor-count", label: `${quantities.floorCount}-floor structural allowance`, basisPoints: floorFactor },
      { id: "site-conditions", label: "ordinary assumed site conditions", basisPoints: pack.factorsBasisPoints.siteConditions },
      { id: "locality-index", label: selection.match === "country_reference" ? "reference locality index" : "pack locality index", basisPoints: pack.factorsBasisPoints.localityIndex },
    ],
    lineItems,
    subtotals: { construction, feesAndContingency, tax: taxLine.amounts },
    total,
    included: pack.inclusions,
    excluded: pack.exclusions,
    assumptions: [
      ...pack.assumptions,
      `Quality tier: ${requirements.budget.qualityTier}.`,
      `Contingency: ${requirements.budget.contingencyPercent}%; tax allowance: ${requirements.budget.taxPercent}%.`,
      ...(building.buildingSchemaVersion === 3 ? ["Roof surfaces, canopy/pergola posts and edge protection are reported as informational physical quantities and remain included in the GFA base rate; no separate unit rates or duplicate line items are applied."] : []),
    ],
    sources: pack.sources,
    disclaimer: pack.disclaimer,
    improveConfidenceActions: selection.match === "country_reference"
      ? ["Add a reviewed district/locality native-currency rate pack.", "Confirm quantities and specifications with a local quantity surveyor."]
      : ["Confirm ground conditions, specification, taxes, and quotations with local professionals.", "Replace feasibility allowances with a measured BOQ as design develops."],
  };
}

export function estimateReconciles(estimate: CostEstimate) {
  if (estimate.status === "unavailable") return true;
  const sum = addBands(...estimate.lineItems.map((line) => line.amounts));
  return sum.lowMinor === estimate.total.lowMinor && sum.expectedMinor === estimate.total.expectedMinor && sum.highMinor === estimate.total.highMinor;
}
