import type { ReadableBuildingRequirements } from "@/lib/building/requirements";
import type { ConfidenceGrade, CostWarning, RatePack } from "@/lib/cost/schema";

export type RatePackSelection =
  | { status: "selected"; pack: RatePack; match: "locality" | "admin_area" | "country_reference"; confidence: Exclude<ConfidenceGrade, "unavailable">; stale: boolean; warnings: CostWarning[] }
  | { status: "unavailable"; reason: "unsupported_region" | "currency_mismatch" | "no_rate_pack"; warnings: CostWarning[] };

function normalizeRegion(value: string | undefined) {
  return value?.trim().toLocaleLowerCase("en") ?? "";
}

function addMonths(date: Date, months: number) {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

function lowerGrade(grade: Exclude<ConfidenceGrade, "unavailable">): Exclude<ConfidenceGrade, "unavailable"> {
  return grade === "A" ? "B" : grade === "B" ? "C" : "D";
}

export function selectRatePack(
  requirements: ReadableBuildingRequirements,
  packs: readonly RatePack[],
  asOf: Date = new Date(),
): RatePackSelection {
  const country = requirements.region.countryCode.toUpperCase();
  const currency = requirements.region.currency.toUpperCase();
  const locality = normalizeRegion(requirements.region.locality);
  const adminArea = normalizeRegion(requirements.region.adminArea);
  const countryPacks = packs.filter((pack) => pack.region.countryCode.toUpperCase() === country || pack.region.referenceFallbackCountryCodes.includes(country));

  if (countryPacks.length === 0) {
    return {
      status: "unavailable",
      reason: "unsupported_region",
      warnings: [{ code: "COST_REGION_UNSUPPORTED", message: `No reviewed native rate pack covers ${requirements.region.adminArea}, ${country}.` }],
    };
  }

  const currencyPacks = countryPacks.filter((pack) => pack.currency === currency);
  if (currencyPacks.length === 0) {
    return {
      status: "unavailable",
      reason: "currency_mismatch",
      warnings: [{ code: "CURRENCY_MISMATCH", message: `Available regional packs use ${countryPacks[0]?.currency}; BrickPilot will not relabel converted rates as ${currency}.` }],
    };
  }

  const localityPack = locality
    ? currencyPacks.find((pack) => pack.region.localities.some((entry) => normalizeRegion(entry) === locality))
    : undefined;
  const adminPack = currencyPacks.find((pack) => normalizeRegion(pack.region.adminArea) === adminArea);
  const pack = localityPack ?? adminPack ?? currencyPacks.find((candidate) => candidate.region.referenceFallbackCountryCodes.includes(country));

  if (!pack) {
    return { status: "unavailable", reason: "no_rate_pack", warnings: [{ code: "COST_REGION_UNSUPPORTED", message: "No reviewed rate pack matches this locality." }] };
  }

  const match = localityPack ? "locality" : adminPack ? "admin_area" : "country_reference";
  let confidence: Exclude<ConfidenceGrade, "unavailable"> = pack.sourceConfidence;
  const warnings: CostWarning[] = [];
  if (match === "country_reference") {
    confidence = confidence === "A" || confidence === "B" ? "C" : "D";
    warnings.push({ code: "REFERENCE_FALLBACK", message: `${pack.name} is a national feasibility fallback for ${requirements.region.adminArea}, not a locality-specific rate.` });
  }

  const stale = asOf > addMonths(new Date(`${pack.effectiveDate}T00:00:00.000Z`), pack.staleAfterMonths);
  if (stale) {
    confidence = lowerGrade(confidence);
    warnings.push({ code: "STALE_RATE_PACK", message: `${pack.name} is beyond its ${pack.staleAfterMonths}-month review window.` });
  }

  return { status: "selected", pack, match, confidence, stale, warnings };
}
