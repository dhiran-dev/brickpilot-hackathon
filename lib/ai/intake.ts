import { DEFAULT_INTAKE_DRAFT, createRequirements, normalizeFloorProgram, type IntakeDraft } from "@/components/guided-intake/model";
import { regionForCountry } from "@/components/guided-intake/region-options";
import { AiProviderError, callJsonModeCompletion } from "@/lib/ai/client";
import { nlIntakeExtractionSchema, type NlIntakeExtraction } from "@/lib/ai/intake-schema";
import type { BuildingRequirements } from "@/lib/building/requirements";

export type IntakeParseResult =
  | { status: "parsed"; requirements: BuildingRequirements; assumptions: string[] }
  | { status: "failed"; reason: "provider_unavailable" | "could_not_extract"; message: string };

const SYSTEM_PROMPT = `Extract only facts explicitly stated in a residential home-design brief. Return one JSON object. Omit unknown fields.
Allowed fields: projectName, countryCode, adminArea, locality, currency, siteWidthFeet, siteDepthFeet, siteWidthMetres, siteDepthMetres, facing, roadEdges, floorCount, floorHeightMetres, stairWidthMm, occupants, floorPrograms, bedroomsGroundFloor, bathroomsGroundFloor, includeParking, includePooja, includeUtility, includeCourtyard, socialSpaceMode, qualityTier, budgetLowMajor, budgetHighMajor.
floorPrograms is an array of { level: 0-3, bedrooms?, bathrooms?, attachedBathrooms?, studies?, balcony? }.
Never emit a seed, room id, area, cost in minor units, coordinate, wall, opening, or geometry. Plot dimensions may be feet or metres, never both. Return JSON only.`;

const MAX_ATTEMPTS = 2;

function groundExtractionToSentence(extraction: NlIntakeExtraction, sentence: string): NlIntakeExtraction {
  const mentionsBathroom = /\b(bath(?:room)?s?|toilets?|washrooms?)\b/i.test(sentence);
  const mentionsAttachedBathroom = /\b(attached|en[ -]?suite)\b/i.test(sentence) && mentionsBathroom;
  const mentions = {
    includeParking: /\b(parking|garage|carport)\b/i.test(sentence),
    includePooja: /\b(pooja|puja|prayer room)\b/i.test(sentence),
    includeUtility: /\b(utility|laundry)\b/i.test(sentence),
    includeCourtyard: /\b(courtyard|atrium)\b/i.test(sentence),
  };
  const grounded: NlIntakeExtraction = {
    ...extraction,
    bedroomsGroundFloor: extraction.bedroomsGroundFloor,
    bathroomsGroundFloor: mentionsBathroom ? extraction.bathroomsGroundFloor : undefined,
    floorPrograms: extraction.floorPrograms?.map((program) => ({
      ...program,
      bathrooms: mentionsBathroom ? program.bathrooms : undefined,
      attachedBathrooms: mentionsAttachedBathroom ? program.attachedBathrooms : undefined,
    })),
  };
  for (const key of Object.keys(mentions) as Array<keyof typeof mentions>) {
    if (!mentions[key]) grounded[key] = undefined;
  }
  return grounded;
}

function cloneDefaultDraft(): IntakeDraft {
  return {
    ...DEFAULT_INTAKE_DRAFT,
    roadEdges: [...DEFAULT_INTAKE_DRAFT.roadEdges],
    setbacks: { ...DEFAULT_INTAKE_DRAFT.setbacks },
    programs: DEFAULT_INTAKE_DRAFT.programs.map(() => ({ bedrooms: 0, bathrooms: 0, attachedBathrooms: 0, studies: 0, balcony: false })),
    includeParking: false,
    includePooja: false,
    includeUtility: false,
    includeCourtyard: false,
    socialSpaceMode: "combined",
    budgetLowMajor: 0,
    budgetHighMajor: 0,
  };
}

function draftFromExtraction(extraction: NlIntakeExtraction): IntakeDraft {
  const draft = cloneDefaultDraft();
  const extractedRegion = extraction.countryCode ? regionForCountry(extraction.countryCode.toUpperCase()) : undefined;
  const extractedAdminArea = extractedRegion
    ? extractedRegion.adminAreas.find((adminArea) => adminArea.value === extraction.adminArea) ?? extractedRegion.adminAreas.at(-1)!
    : undefined;
  const extractedLocality = extractedAdminArea
    ? extractedAdminArea.localities.find((locality) => locality.value === extraction.locality) ?? extractedAdminArea.localities.at(-1)!
    : undefined;
  const inferredFloorCount = extraction.floorPrograms?.reduce((maximum, program) => Math.max(maximum, program.level + 1), 0) ?? 0;
  const floorCount = Math.max(extraction.floorCount ?? 0, inferredFloorCount, draft.floorCount);
  let programs = draft.programs.map((program, level) => {
    const extracted = extraction.floorPrograms?.find((item) => item.level === level);
    const legacyGround = level === 0 ? {
      bedrooms: extraction.bedroomsGroundFloor,
      bathrooms: extraction.bathroomsGroundFloor,
    } : {};
    return normalizeFloorProgram({ ...program, ...legacyGround, ...extracted }, program);
  });
  const hasBedrooms = programs.some((program, level) => level < floorCount && program.bedrooms > 0);
  const hasBathrooms = programs.some((program, level) => level < floorCount && program.bathrooms > 0);
  if (hasBedrooms && !hasBathrooms) programs = programs.map((program, level) => level === 0 ? { ...program, bathrooms: 1 } : program);

  const plotInMetres = extraction.siteWidthMetres !== undefined;
  const siteWidth = plotInMetres
    ? extraction.siteWidthMetres!
    : extraction.siteWidthFeet !== undefined
      ? extraction.siteWidthFeet * 0.3048
      : draft.siteWidth;
  const siteDepth = plotInMetres
    ? extraction.siteDepthMetres!
    : extraction.siteDepthFeet !== undefined
      ? extraction.siteDepthFeet * 0.3048
      : draft.siteDepth;
  const facing = extraction.facing ?? draft.facing;

  return {
    ...draft,
    projectName: extraction.projectName ?? draft.projectName,
    countryCode: extractedRegion?.countryCode ?? draft.countryCode,
    adminArea: extractedAdminArea?.value ?? extraction.adminArea ?? draft.adminArea,
    locality: extractedLocality?.value ?? extraction.locality ?? draft.locality,
    currency: extractedRegion?.defaultCurrency ?? extraction.currency?.toUpperCase() ?? draft.currency,
    locale: extractedRegion?.defaultLocale ?? draft.locale,
    displayUnit: "metric",
    siteWidth,
    siteDepth,
    facing,
    roadEdges: extraction.roadEdges ?? (extraction.facing ? [facing] : draft.roadEdges),
    floorCount,
    floorHeightM: extraction.floorHeightMetres ?? draft.floorHeightM,
    stairWidthMm: extraction.stairWidthMm ?? draft.stairWidthMm,
    occupants: extraction.occupants ?? draft.occupants,
    programs,
    includeParking: extraction.includeParking ?? draft.includeParking,
    includePooja: extraction.includePooja ?? draft.includePooja,
    includeUtility: extraction.includeUtility ?? draft.includeUtility,
    includeCourtyard: extraction.includeCourtyard ?? draft.includeCourtyard,
    socialSpaceMode: extraction.socialSpaceMode ?? draft.socialSpaceMode,
    qualityTier: extraction.qualityTier ?? draft.qualityTier,
    budgetLowMajor: extraction.budgetLowMajor ?? draft.budgetLowMajor,
    budgetHighMajor: extraction.budgetHighMajor ?? draft.budgetHighMajor,
  };
}

function assumptionsFor(extraction: NlIntakeExtraction): string[] {
  const assumptions: string[] = [];
  const inferredFloorCount = extraction.floorPrograms?.reduce((maximum, program) => Math.max(maximum, program.level + 1), 0) ?? 0;
  const effectiveFloorCount = Math.max(extraction.floorCount ?? 0, inferredFloorCount, 1);
  if (extraction.floorCount === undefined && inferredFloorCount <= 1) assumptions.push("Assumed a single ground floor; mention a storey count to change it.");
  if (extraction.occupants === undefined) assumptions.push(`Assumed ${DEFAULT_INTAKE_DRAFT.occupants} occupants.`);
  if (extraction.countryCode === undefined) assumptions.push(`Assumed region ${DEFAULT_INTAKE_DRAFT.adminArea}, ${DEFAULT_INTAKE_DRAFT.countryCode}.`);
  else {
    const region = regionForCountry(extraction.countryCode.toUpperCase());
    if (!region.adminAreas.some((adminArea) => adminArea.value === extraction.adminArea)) assumptions.push(`Used the general ${region.label} region because no matching state or province was stated.`);
    if (extraction.currency && extraction.currency.toUpperCase() !== region.defaultCurrency) assumptions.push(`Normalized currency to ${region.defaultCurrency} to match the selected country.`);
  }
  if (extraction.qualityTier === undefined) assumptions.push("Assumed a standard finish quality tier.");
  if (extraction.socialSpaceMode === undefined) assumptions.push("Assumed a combined living and dining space.");
  if ([extraction.includeParking, extraction.includePooja, extraction.includeUtility, extraction.includeCourtyard].every((value) => value === undefined)) {
    assumptions.push("Did not add optional parking, pooja, utility, or courtyard spaces unless mentioned.");
  }
  const statedBathrooms = extraction.bathroomsGroundFloor !== undefined || extraction.floorPrograms?.some((program) => program.bathrooms !== undefined);
  const statedBedrooms = extraction.bedroomsGroundFloor !== undefined || extraction.floorPrograms?.some((program) => (program.bedrooms ?? 0) > 0);
  if (statedBedrooms && !statedBathrooms) assumptions.push("Assumed one shared ground-floor bathroom because none was stated.");
  if (extraction.floorHeightMetres === undefined) assumptions.push(`Assumed ${DEFAULT_INTAKE_DRAFT.floorHeightM.toFixed(1)} m floor-to-floor height.`);
  if (effectiveFloorCount > 1 && extraction.stairWidthMm === undefined) assumptions.push(`Assumed a ${DEFAULT_INTAKE_DRAFT.stairWidthMm} mm residential stair width.`);
  if (inferredFloorCount > 1 && extraction.floorCount === undefined) assumptions.push("Inferred the storey count from the highest floor allocation mentioned.");
  return assumptions;
}

export async function parseNaturalLanguageIntake(
  sentence: string,
  options: { complete?: typeof callJsonModeCompletion } = {},
): Promise<IntakeParseResult> {
  const complete = options.complete ?? callJsonModeCompletion;
  let lastError: string | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let raw: unknown;
    try {
      raw = await complete({
        systemPrompt: SYSTEM_PROMPT,
        userPayload: lastError ? { sentence, previousValidationError: lastError } : { sentence },
        maxTokens: 900,
        timeoutMs: 15_000,
      });
    } catch (error) {
      const message = error instanceof AiProviderError ? error.message : "The AI intake service is unavailable.";
      return { status: "failed", reason: "provider_unavailable", message };
    }

    const parsed = nlIntakeExtractionSchema.safeParse(raw);
    if (parsed.success) {
      try {
        const extraction = groundExtractionToSentence(parsed.data, sentence);
        return {
          status: "parsed",
          requirements: createRequirements(draftFromExtraction(extraction)),
          assumptions: assumptionsFor(extraction),
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : "The extracted brief is inconsistent.";
        continue;
      }
    }
    lastError = parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ");
  }

  return {
    status: "failed",
    reason: "could_not_extract",
    message: "Could not extract enough concrete home requirements. Try a clearer sentence or choose a tuned example.",
  };
}
