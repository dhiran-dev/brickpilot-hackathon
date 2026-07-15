import type { RatePack } from "@/lib/cost/schema";

/**
 * A BrickPilot feasibility rate pack, not an official CPWD schedule.
 *
 * The expected rate and uncertainty bounds are product calibration assumptions
 * informed by the named official source families. They must be reviewed against
 * current local drawings, specifications, indices, taxes, and quotations before
 * any investment or contracting decision.
 */
export const INDIA_DELHI_FEASIBILITY_2026_07: RatePack = {
  schemaVersion: 1,
  ratePackVersion: "in-delhi-feasibility-2026.07-r1",
  checksum: "sha256:96f0d8eb126d5e4bdfc6168fe3f20f10cf3cfd0f2afce229c991a967925cd07a",
  name: "BrickPilot Delhi residential feasibility reference — July 2026",
  status: "reviewed_reference",
  region: {
    countryCode: "IN",
    adminArea: "Delhi",
    localities: ["Delhi", "New Delhi"],
    referenceFallbackCountryCodes: ["IN"],
  },
  currency: "INR",
  locale: "en-IN",
  measurement: {
    rateUnit: "currency_minor_per_square_metre_gfa",
    standard: "BrickPilot gross-floor-area feasibility basis",
    note: "Gross floor area is the sum of canonical floor planning-cell areas. It is not a contractor BOQ or a permit-authority plinth-area certificate.",
  },
  effectiveDate: "2025-04-01",
  staleAfterMonths: 18,
  sourceConfidence: "B",
  sources: [
    {
      title: "CPWD Plinth Area Rates circular family",
      url: "https://cpwd.gov.in/AllCirculars.aspx?Type=54",
      publisher: "Central Public Works Department, Government of India",
      effectiveDate: "2025-04-01",
      ingestionDate: "2026-07-15",
      sourceKind: "calibration_reference",
      note: "Official source family used for calibration context. The BrickPilot rate below is not represented as a verbatim CPWD rate.",
    },
    {
      title: "CPWD Building Cost Indices circular family",
      url: "https://cpwd.gov.in/AllCirculars.aspx?Type=33",
      publisher: "Central Public Works Department, Government of India",
      effectiveDate: "2025-04-01",
      ingestionDate: "2026-07-15",
      sourceKind: "official_index",
      note: "Index source family is disclosed for review; no live index is silently applied at generation time.",
    },
  ],
  // INR 27,200 / 32,000 / 38,400 per m², stored in paise.
  baseRate: { lowMinor: 2_720_000, expectedMinor: 3_200_000, highMinor: 3_840_000 },
  factorsBasisPoints: {
    qualityTier: { essential: 8_500, standard: 10_000, premium: 13_500 },
    floorCount: { one: 10_000, two: 10_600, three: 11_100, four: 11_600 },
    siteConditions: 10_000,
    localityIndex: 10_000,
  },
  allowancesBasisPoints: {
    externalWorks: 500,
    professionalFees: 600,
  },
  inclusions: [
    "Residential substructure and superstructure on ordinary assumed ground",
    "Ordinary internal and external finishes appropriate to the selected quality tier",
    "Ordinary internal plumbing, sanitary, and electrical services",
    "Fixed contractor overhead and ordinary construction preliminaries within the feasibility rate",
  ],
  exclusions: [
    "Land purchase, finance, legal, approval, and statutory submission costs",
    "Abnormal foundations, rock excavation, dewatering, retaining systems, and contaminated soil",
    "Loose furniture, appliances, specialist interiors, solar systems, lifts, pools, and premium imported equipment",
    "Utility authority deposits, off-site infrastructure, escalation after the pack effective date, and contractor-specific risk pricing",
  ],
  assumptions: [
    "Rectangular detached residential building with conventional construction and ordinary site access",
    "External works are added as a separate feasibility allowance and are not duplicated in the base rate",
    "Professional fees are an explicit allowance; taxes and contingency use the project requirements",
    "No currency conversion is performed",
  ],
  disclaimer: "Concept-stage feasibility estimate only. Obtain a region-specific quantity surveyor or contractor estimate from coordinated drawings before budgeting, procurement, finance, or construction decisions.",
};

export const BUILTIN_RATE_PACKS: readonly RatePack[] = [INDIA_DELHI_FEASIBILITY_2026_07];
