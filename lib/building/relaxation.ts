import type { PartiId } from "@/lib/building/partis";

export const PRESERVED_HARD_SHAPE_RULES = Object.freeze([
  "ROOM_PROPORTION",
  "PARALLEL_BANDS",
  "CIRCULATION_RATIO",
  "GALLERY_LENGTH",
  "FLOATING_VOLUME",
] as const);

export type RelaxationRungId = "preferred_parti" | "alternate_parti" | "simplified_court" | "compact_fallback";

export type RelaxationAttempt = {
  rung: 0 | 1 | 2 | 3;
  id: RelaxationRungId;
  partiId: PartiId;
  simplifiedCourt: boolean;
  preservedHardRules: typeof PRESERVED_HARD_SHAPE_RULES;
};

function attempt(
  rung: RelaxationAttempt["rung"],
  id: RelaxationRungId,
  partiId: PartiId,
  simplifiedCourt = false,
): RelaxationAttempt {
  return { rung, id, partiId, simplifiedCourt, preservedHardRules: PRESERVED_HARD_SHAPE_RULES };
}

/** Preference relaxes in bounded steps; hard geometry validation never does. */
export function buildRelaxationLadder(partis: readonly PartiId[]): RelaxationAttempt[] {
  const preferred = partis[0] ?? "compact";
  const alternatives = partis.filter((partiId, index) => index > 0 && partiId !== "compact");
  const ladder = [
    attempt(0, "preferred_parti", preferred),
    ...alternatives.map((partiId) => attempt(1, "alternate_parti", partiId)),
  ];
  if (partis.includes("t_hub")) ladder.push(attempt(2, "simplified_court", "t_hub", true));
  if (preferred !== "compact") ladder.push(attempt(3, "compact_fallback", "compact"));
  return ladder;
}
