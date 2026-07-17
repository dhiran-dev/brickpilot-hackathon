import type { BuildingRequirements } from "@/lib/building/requirements";

export type ClimateClass = "hot_humid" | "hot_dry" | "temperate" | "cold_continental" | "mediterranean";

type Architecture = BuildingRequirements["architecture"];
export type RegionalStyleDefault = Architecture["style"] | "regional_vernacular" | "modern_luxury";

export type RegionalMaterialPalette = {
  direction: Architecture["materialDirection"];
  exteriorWalls: string;
  accents: string;
  roof: string;
  shading: string;
};

export type RegionalPack = {
  climateClass: ClimateClass;
  defaultStyle: RegionalStyleDefault;
  intakeStyle: Architecture["style"];
  defaultFormStrategy: Architecture["formStrategy"];
  roofCharacter: Architecture["roofCharacter"];
  courtPreference: "courtyard_first" | "cross_ventilation_court" | "modest_court" | "compact_first" | "l_court";
  verandahPreference: "deep" | "shaded" | "optional" | "minimal";
  materialPalette: RegionalMaterialPalette;
  notes: readonly string[];
};

export const REGIONAL_PACKS: Record<ClimateClass, RegionalPack> = {
  hot_humid: {
    climateClass: "hot_humid",
    defaultStyle: "contemporary_tropical",
    intakeStyle: "contemporary_tropical",
    defaultFormStrategy: "articulated_wings",
    roofCharacter: "mixed",
    courtPreference: "cross_ventilation_court",
    verandahPreference: "deep",
    materialPalette: {
      direction: "warm_natural",
      exteriorWalls: "light mineral plaster",
      accents: "warm timber and local stone",
      roof: "deep-overhang pitched or mixed roof",
      shading: "timber screens and deep verandahs",
    },
    notes: ["Prioritize shade and cross-ventilation.", "Use deep overhangs and weather-protected openings."],
  },
  hot_dry: {
    climateClass: "hot_dry",
    defaultStyle: "regional_vernacular",
    // The conceptual label maps to the closest existing persisted style; no requirements migration is needed.
    intakeStyle: "courtyard_vernacular",
    defaultFormStrategy: "courtyard",
    roofCharacter: "flat_parapet",
    courtPreference: "courtyard_first",
    verandahPreference: "shaded",
    materialPalette: {
      direction: "earthy_textured",
      exteriorWalls: "earthen or lime plaster with shaded white surfaces",
      accents: "local stone",
      roof: "flat parapet roof",
      shading: "deep reveals and screened courts",
    },
    notes: ["Use a shaded court as the thermal heart.", "Keep west-facing openings small and protected."],
  },
  temperate: {
    climateClass: "temperate",
    defaultStyle: "warm_minimal",
    intakeStyle: "warm_minimal",
    defaultFormStrategy: "stepped_terraces",
    roofCharacter: "mixed",
    courtPreference: "modest_court",
    verandahPreference: "optional",
    materialPalette: {
      direction: "light_mineral",
      exteriorWalls: "warm-grey render",
      accents: "brick and restrained timber",
      roof: "mixed roof with a sun terrace",
      shading: "moderate seasonal shading",
    },
    notes: ["Balance winter sun with summer shade.", "A modest court or sun terrace is preferred over a deep void."],
  },
  cold_continental: {
    climateClass: "cold_continental",
    defaultStyle: "warm_minimal",
    intakeStyle: "warm_minimal",
    defaultFormStrategy: "compact",
    roofCharacter: "sloped",
    courtPreference: "compact_first",
    verandahPreference: "minimal",
    materialPalette: {
      direction: "warm_natural",
      exteriorWalls: "dark masonry with insulated warm interiors",
      accents: "durable timber",
      roof: "pitched roof",
      shading: "minimal fixed shade on equator-facing glazing",
    },
    notes: ["Prefer a compact envelope.", "Concentrate glazing toward the equator-facing side."],
  },
  mediterranean: {
    climateClass: "mediterranean",
    defaultStyle: "modern_luxury",
    // The conceptual label maps to the closest existing persisted style; no requirements migration is needed.
    intakeStyle: "modernist",
    defaultFormStrategy: "articulated_wings",
    roofCharacter: "sloped",
    courtPreference: "l_court",
    verandahPreference: "shaded",
    materialPalette: {
      direction: "earthy_textured",
      exteriorWalls: "light stucco",
      accents: "terracotta and natural stone",
      roof: "low-pitch terracotta roof",
      shading: "shaded terraces and pergolas",
    },
    notes: ["Prefer an L-shaped court or shaded terrace.", "Use pale walls with terracotta and stone accents."],
  },
};

/** Coarse v1 mapping; state/province refinement is intentionally limited to India. */
export const COUNTRY_CLIMATE_CLASSES: Readonly<Record<string, ClimateClass>> = {
  AE: "hot_dry", BH: "hot_dry", DZ: "hot_dry", EG: "hot_dry", IQ: "hot_dry", JO: "hot_dry", KW: "hot_dry", OM: "hot_dry", QA: "hot_dry", SA: "hot_dry",
  BD: "hot_humid", ID: "hot_humid", KH: "hot_humid", LK: "hot_humid", MY: "hot_humid", PH: "hot_humid", SG: "hot_humid", TH: "hot_humid", VN: "hot_humid",
  CA: "cold_continental", FI: "cold_continental", IS: "cold_continental", MN: "cold_continental", NO: "cold_continental", RU: "cold_continental", SE: "cold_continental",
  CY: "mediterranean", ES: "mediterranean", GR: "mediterranean", HR: "mediterranean", IL: "mediterranean", IT: "mediterranean", LB: "mediterranean", MT: "mediterranean", PT: "mediterranean", TR: "mediterranean",
  AR: "temperate", AU: "temperate", AT: "temperate", BE: "temperate", BR: "temperate", CH: "temperate", CL: "temperate", CN: "temperate", CZ: "temperate", DE: "temperate", DK: "temperate", FR: "temperate", GB: "temperate", IE: "temperate", JP: "temperate", KR: "temperate", NL: "temperate", NZ: "temperate", PL: "temperate", US: "temperate", ZA: "temperate",
  IN: "hot_dry",
};

type IndianAdminArea = { canonicalName: string; aliases: readonly string[]; climateClass: ClimateClass };

/**
 * Enumerated rather than fuzzy so short aliases do not accidentally match locality text.
 * Includes all Indian states and union territories, plus common current/legacy abbreviations.
 */
export const INDIAN_ADMIN_AREAS: readonly IndianAdminArea[] = [
  { canonicalName: "Andhra Pradesh", aliases: ["AP"], climateClass: "hot_humid" },
  { canonicalName: "Arunachal Pradesh", aliases: ["AR"], climateClass: "cold_continental" },
  { canonicalName: "Assam", aliases: ["AS"], climateClass: "hot_humid" },
  { canonicalName: "Bihar", aliases: ["BR"], climateClass: "hot_dry" },
  { canonicalName: "Chhattisgarh", aliases: ["CG", "CT"], climateClass: "hot_dry" },
  { canonicalName: "Goa", aliases: ["GA"], climateClass: "hot_humid" },
  { canonicalName: "Gujarat", aliases: ["GJ"], climateClass: "hot_dry" },
  { canonicalName: "Haryana", aliases: ["HR"], climateClass: "hot_dry" },
  { canonicalName: "Himachal Pradesh", aliases: ["HP"], climateClass: "cold_continental" },
  { canonicalName: "Jharkhand", aliases: ["JH"], climateClass: "hot_dry" },
  { canonicalName: "Karnataka", aliases: ["KA"], climateClass: "hot_humid" },
  { canonicalName: "Kerala", aliases: ["KL"], climateClass: "hot_humid" },
  { canonicalName: "Madhya Pradesh", aliases: ["MP"], climateClass: "hot_dry" },
  { canonicalName: "Maharashtra", aliases: ["MH"], climateClass: "hot_humid" },
  { canonicalName: "Manipur", aliases: ["MN"], climateClass: "hot_humid" },
  { canonicalName: "Meghalaya", aliases: ["ML"], climateClass: "hot_humid" },
  { canonicalName: "Mizoram", aliases: ["MZ"], climateClass: "hot_humid" },
  { canonicalName: "Nagaland", aliases: ["NL"], climateClass: "hot_humid" },
  { canonicalName: "Odisha", aliases: ["OD", "OR", "Orissa"], climateClass: "hot_humid" },
  { canonicalName: "Punjab", aliases: ["PB"], climateClass: "hot_dry" },
  { canonicalName: "Rajasthan", aliases: ["RJ"], climateClass: "hot_dry" },
  { canonicalName: "Sikkim", aliases: ["SK"], climateClass: "cold_continental" },
  { canonicalName: "Tamil Nadu", aliases: ["TN"], climateClass: "hot_humid" },
  { canonicalName: "Telangana", aliases: ["TS", "TG"], climateClass: "hot_dry" },
  { canonicalName: "Tripura", aliases: ["TR"], climateClass: "hot_humid" },
  { canonicalName: "Uttar Pradesh", aliases: ["UP"], climateClass: "hot_dry" },
  { canonicalName: "Uttarakhand", aliases: ["UK", "UA", "Uttaranchal"], climateClass: "cold_continental" },
  { canonicalName: "West Bengal", aliases: ["WB"], climateClass: "hot_humid" },
  { canonicalName: "Andaman and Nicobar Islands", aliases: ["AN", "Andaman & Nicobar"], climateClass: "hot_humid" },
  { canonicalName: "Chandigarh", aliases: ["CH"], climateClass: "hot_dry" },
  { canonicalName: "Dadra and Nagar Haveli and Daman and Diu", aliases: ["DN", "DD", "DNHDD"], climateClass: "hot_humid" },
  { canonicalName: "Delhi", aliases: ["DL", "NCT", "NCT of Delhi", "New Delhi"], climateClass: "hot_dry" },
  { canonicalName: "Jammu and Kashmir", aliases: ["JK", "J&K"], climateClass: "cold_continental" },
  { canonicalName: "Ladakh", aliases: ["LA"], climateClass: "cold_continental" },
  { canonicalName: "Lakshadweep", aliases: ["LD"], climateClass: "hot_humid" },
  { canonicalName: "Puducherry", aliases: ["PY", "Pondicherry"], climateClass: "hot_humid" },
];

function normalizedAlias(value: string) {
  return value.trim().toLocaleLowerCase("en").replace(/[^a-z0-9]+/g, " ").trim();
}

const INDIAN_ADMIN_BY_ALIAS = new Map(INDIAN_ADMIN_AREAS.flatMap((entry) => (
  [entry.canonicalName, ...entry.aliases].map((alias) => [normalizedAlias(alias), entry] as const)
)));

export type RegionalPackWarning = {
  code: "low_confidence_regional_defaults";
  severity: "warning";
  message: string;
};

export type RegionalPackResolution = {
  countryCode: string;
  climateClass: ClimateClass;
  confidence: "high" | "low";
  source: "admin_area" | "country" | "temperate_fallback";
  matchedAdminArea?: string;
  pack: RegionalPack;
  warning?: RegionalPackWarning;
};

export function resolveRegionalPack(countryCode: string, adminArea?: string): RegionalPackResolution {
  const normalizedCountryCode = countryCode.trim().toUpperCase();
  if (normalizedCountryCode === "IN" && adminArea) {
    const match = INDIAN_ADMIN_BY_ALIAS.get(normalizedAlias(adminArea));
    if (match) {
      return {
        countryCode: normalizedCountryCode,
        climateClass: match.climateClass,
        confidence: "high",
        source: "admin_area",
        matchedAdminArea: match.canonicalName,
        pack: REGIONAL_PACKS[match.climateClass],
      };
    }
  }

  const mapped = COUNTRY_CLIMATE_CLASSES[normalizedCountryCode];
  if (mapped) {
    return {
      countryCode: normalizedCountryCode,
      climateClass: mapped,
      confidence: "high",
      source: "country",
      pack: REGIONAL_PACKS[mapped],
    };
  }

  const printableCode = normalizedCountryCode || "the selected country";
  return {
    countryCode: normalizedCountryCode,
    climateClass: "temperate",
    confidence: "low",
    source: "temperate_fallback",
    pack: REGIONAL_PACKS.temperate,
    warning: {
      code: "low_confidence_regional_defaults",
      severity: "warning",
      message: `Low-confidence regional defaults: ${printableCode} has no climate-class mapping yet, so editable temperate suggestions were used.`,
    },
  };
}

export type RegionalIntakePrefill = {
  architecturalStyle: Architecture["style"];
  formStrategy: Architecture["formStrategy"];
  roofCharacter: Architecture["roofCharacter"];
  materialDirection: Architecture["materialDirection"];
  includeCourtyard: boolean;
};

export function regionalIntakePrefill(countryCode: string, adminArea?: string): RegionalIntakePrefill {
  const { pack } = resolveRegionalPack(countryCode, adminArea);
  return {
    architecturalStyle: pack.intakeStyle,
    formStrategy: pack.defaultFormStrategy,
    roofCharacter: pack.roofCharacter,
    materialDirection: pack.materialPalette.direction,
    includeCourtyard: pack.courtPreference !== "compact_first" && pack.courtPreference !== "modest_court",
  };
}
