import { formatCurrencyMinor } from "@/lib/cost/format";
import { deriveQuantityTakeoff } from "@/lib/cost/quantity";
import { buildDrawing } from "@/lib/drawing/build-drawing";
import type { ValidationCategoryV3 } from "@/lib/validation";
import type { DeckPayload } from "@/lib/design/deck";

/** Turn an enum token (`dog_leg`, `contemporary_tropical`) into display copy (`Dog leg`, `Contemporary tropical`). */
export function humanize(token: string) {
  const spaced = token.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function formatM2(areaMm2: number) {
  return `${(areaMm2 / 1_000_000).toFixed(1)} m²`;
}

export function deckDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { day: "2-digit", month: "long", year: "numeric" });
}

export function floorConfig(payload: DeckPayload) {
  const count = payload.building.floors.length;
  return count <= 1 ? "Ground only" : `G+${count - 1}`;
}

function siteSummary(payload: DeckPayload) {
  const { site } = payload.requirements;
  return `${(site.widthMm / 1000).toFixed(1)} × ${(site.depthMm / 1000).toFixed(1)} m`;
}

// ---------------------------------------------------------------------------
// Cover

export type DeckCoverView = {
  heroUrl: string | null;
  facts: Array<{ label: string; value: string }>;
};

export function deckCoverView(payload: DeckPayload): DeckCoverView {
  const facts = [
    { label: "Configuration", value: floorConfig(payload) },
    { label: "Location", value: payload.location },
    { label: "Plot", value: `${siteSummary(payload)} · ${payload.requirements.site.facing}-facing` },
    { label: "Total area", value: `${deckScheduleView(payload).grandTotalM2} m²` },
    { label: "Prepared", value: deckDate(payload.generatedAt) },
  ];
  return { heroUrl: payload.renders.assets.find((asset) => asset.role === "exterior_front")?.url ?? null, facts };
}

// ---------------------------------------------------------------------------
// Brief — the household's own inputs, reflected back in plain language.

export type DeckBriefView = {
  facts: Array<{ label: string; value: string }>;
  direction: Array<{ label: string; value: string }>;
  roomsByFloor: Array<{ floorLabel: string; rooms: Array<{ name: string; targetM2: string }> }>;
};

export function deckBriefView(payload: DeckPayload): DeckBriefView {
  const { requirements } = payload;
  const { site, household, vertical, architecture, budget } = requirements;
  const setbacks = site.setbacksMm;
  const uniformSetback = setbacks.north === setbacks.east && setbacks.east === setbacks.south && setbacks.south === setbacks.west;

  const facts: Array<{ label: string; value: string }> = [
    { label: "Plot", value: `${siteSummary(payload)} · ${site.facing}-facing` },
    { label: "Road access", value: site.roadEdges.map(humanize).join(" + ") || "—" },
    {
      label: "Setbacks",
      value: uniformSetback
        ? `${(setbacks.north / 1000).toFixed(1)} m all round`
        : `N ${(setbacks.north / 1000).toFixed(1)} · E ${(setbacks.east / 1000).toFixed(1)} · S ${(setbacks.south / 1000).toFixed(1)} · W ${(setbacks.west / 1000).toFixed(1)} m`,
    },
    { label: "Home", value: `${floorConfig(payload)} · ${requirements.floors.map((floor) => (floor.floorHeightMm / 1000).toFixed(1)).join(" / ")} m floor heights` },
    { label: "Household", value: `${household.occupants} occupants${household.accessibilityRequired ? " · step-free access required" : ""}` },
    { label: "Vertical", value: `${humanize(vertical.stairFamily)} stair, ${(vertical.stairWidthMm / 1000).toFixed(1)} m wide${vertical.liftProvision ? " · lift provision" : ""}` },
  ];

  const direction: Array<{ label: string; value: string }> = [
    { label: "Style", value: humanize(architecture.style) },
    { label: "Massing", value: humanize(architecture.formStrategy) },
    { label: "Roof", value: humanize(architecture.roofCharacter) },
    { label: "Materials", value: humanize(architecture.materialDirection) },
    { label: "Finish", value: `${humanize(budget.qualityTier)} · ${budget.contingencyPercent}% contingency${budget.taxPercent ? ` · ${budget.taxPercent}% tax` : ""}` },
  ];

  const roomsByFloor = requirements.floors.map((floor) => ({
    floorLabel: floor.label,
    rooms: requirements.rooms
      .filter((room) => room.floorId === floor.id)
      .map((room) => ({ name: room.name, targetM2: formatM2(room.targetAreaMm2) })),
  }));

  return { facts, direction, roomsByFloor };
}

// ---------------------------------------------------------------------------
// Overview — scheme rationale plus the numbers people screenshot.

export type DeckOverviewView = {
  builtUpM2: string;
  stats: Array<{ label: string; value: string }>;
  evidence: string[];
};

export function deckOverviewView(payload: DeckPayload): DeckOverviewView {
  const takeoff = deriveQuantityTakeoff(payload.building);
  const scheduled = deckScheduleView(payload);
  const bedroomCount = payload.requirements.rooms.filter((room) => room.type === "bedroom").length;
  const wetCount = payload.requirements.rooms.filter((room) => room.type === "bathroom").length;
  const expectedCost = payload.costEstimate.status === "available" ? formatCurrencyMinor(payload.costEstimate.total.expectedMinor, payload.costEstimate.currency, payload.costEstimate.locale) : null;

  const stats: Array<{ label: string; value: string }> = [
    { label: "Plot", value: siteSummary(payload) },
    { label: "Floors", value: `${takeoff.floorCount} (${floorConfig(payload)})` },
    { label: "Bedrooms", value: String(bedroomCount) },
    { label: "Bathrooms", value: String(wetCount) },
    { label: "Doors / windows", value: `${takeoff.doorCount} / ${takeoff.windowCount}` },
    { label: "Stairs", value: String(takeoff.stairCount) },
    { label: "Validation", value: `${payload.validation.score} / 100` },
  ];
  if (expectedCost) stats.push({ label: "Expected cost", value: expectedCost });

  return {
    builtUpM2: scheduled.grandTotalM2,
    stats,
    evidence: payload.scheme.evidence.slice(0, 4),
  };
}

// ---------------------------------------------------------------------------
// Room schedule — consolidated, grouped per floor, with targets.

export type DeckScheduleRow = { name: string; zone: string; achievedM2: string; targetM2: string | null; underTarget: boolean };
export type DeckScheduleView = {
  floors: Array<{ floorLabel: string; rows: DeckScheduleRow[]; totalM2: string }>;
  grandTotalM2: string;
};

export function deckScheduleView(payload: DeckPayload): DeckScheduleView {
  const drawing = buildDrawing(payload.building, { scheme: { name: payload.scheme.name, partiId: payload.scheme.partiId, style: payload.requirements.architecture.style } });
  let grandMm2 = 0;
  const floors = drawing.floors.map((floor) => {
    const rows: DeckScheduleRow[] = floor.areaSchedule.map((row) => ({
      name: row.name,
      zone: floor.rooms.find((room) => room.id === row.roomId)?.zone ?? "social",
      achievedM2: (row.achievedAreaMm2 / 1_000_000).toFixed(1),
      targetM2: row.targetAreaMm2 ? (row.targetAreaMm2 / 1_000_000).toFixed(1) : null,
      underTarget: row.underTarget,
    }));
    const floorMm2 = floor.areaSchedule.reduce((sum, row) => sum + row.achievedAreaMm2, 0);
    grandMm2 += floorMm2;
    return { floorLabel: floor.floorLabel, rows, totalM2: (floorMm2 / 1_000_000).toFixed(1) };
  });
  return { floors, grandTotalM2: (grandMm2 / 1_000_000).toFixed(1) };
}

// ---------------------------------------------------------------------------
// Validation — score, per-category status, ordered findings.

const CATEGORY_BLURB: Record<ValidationCategoryV3, string> = {
  geometry: "Rooms close, sizes hold, nothing overlaps",
  topology: "Every room reachable, no orphaned space",
  opening: "Doors and windows land on walls",
  vertical: "Stair and wet cores stack across floors",
  planning: "Zoning, privacy and daylight heuristics",
  structure: "Column grid coordinates across floors",
  cost: "Estimate inputs reconcile with quantities",
  circulation: "Routes, entrances and room access remain connected",
  accessibility: "Step-free and clear-width requirements are respected",
  architecture: "Entry, roof, shade and facade intent are realized",
  site: "Road orientation, setbacks and site limits are respected",
  safety: "Roof support and exposed edges have physical protection",
  scheme_set: "Alternatives remain meaningfully distinct",
};

const LEGACY_VALIDATION_CATEGORIES: ValidationCategoryV3[] = ["geometry", "topology", "opening", "vertical", "planning", "structure", "cost"];
const V3_VALIDATION_CATEGORIES = Object.keys(CATEGORY_BLURB) as ValidationCategoryV3[];

export type DeckValidationView = {
  score: number;
  counts: { error: number; warning: number; info: number };
  categories: Array<{ id: ValidationCategoryV3; label: string; blurb: string; findings: number; worst: "error" | "warning" | "info" | null }>;
  findings: Array<{ severity: "error" | "warning" | "info"; category: string; message: string; action: string | null }>;
  rulePackVersion: string;
};

export function deckValidationView(payload: DeckPayload): DeckValidationView {
  const { validation } = payload;
  const byCategory = new Map<ValidationCategoryV3, { findings: number; worst: "error" | "warning" | "info" | null }>();
  for (const finding of validation.findings) {
    const entry = byCategory.get(finding.category) ?? { findings: 0, worst: null };
    entry.findings += 1;
    if (finding.severity === "error" || (finding.severity === "warning" && entry.worst !== "error") || (finding.severity === "info" && entry.worst === null)) {
      entry.worst = finding.severity;
    }
    byCategory.set(finding.category, entry);
  }
  const categoryIds = "schemaVersion" in validation ? V3_VALIDATION_CATEGORIES : LEGACY_VALIDATION_CATEGORIES;
  const categories = categoryIds.map((id) => ({
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    blurb: CATEGORY_BLURB[id],
    findings: byCategory.get(id)?.findings ?? 0,
    worst: byCategory.get(id)?.worst ?? null,
  }));
  const order = { error: 0, warning: 1, info: 2 } as const;
  const findings = [...validation.findings]
    .sort((a, b) => order[a.severity] - order[b.severity])
    .map((finding) => ({
      severity: finding.severity,
      category: finding.category,
      message: finding.message,
      action: finding.suggestedAction ?? null,
    }));
  return { score: validation.score, counts: validation.counts, categories, findings, rulePackVersion: validation.rulePackVersion };
}

// ---------------------------------------------------------------------------
// Cost — band, line items, scope and provenance.

export type DeckCostView =
  | { status: "unavailable"; reason: string; actions: string[] }
  | {
      status: "available";
      expected: string;
      low: string;
      high: string;
      bandFraction: number;
      ratePerM2: string;
      confidence: string;
      match: string;
      packName: string;
      packVersion: string;
      effectiveDate: string;
      stale: boolean;
      lines: Array<{ label: string; basis: string; amount: string }>;
      included: string[];
      excluded: string[];
      assumptions: string[];
      improveActions: string[];
      disclaimer: string;
    };

export function deckCostView(payload: DeckPayload): DeckCostView {
  const { costEstimate } = payload;
  if (costEstimate.status === "unavailable") {
    const reason = costEstimate.reason === "unsupported_region"
      ? "This region does not yet have a supported cost rate pack."
      : costEstimate.reason === "currency_mismatch"
        ? "The requested currency does not match any available rate pack."
        : "No matching rate pack was found for this study.";
    return { status: "unavailable", reason, actions: costEstimate.improveConfidenceActions };
  }
  const { total, lineItems, currency, locale, confidence, selection, quantities } = costEstimate;
  const range = total.highMinor - total.lowMinor;
  const gfaM2 = quantities.grossFloorAreaMm2 / 1_000_000;
  const fmt = (minor: number) => formatCurrencyMinor(minor, currency, locale);
  return {
    status: "available",
    expected: fmt(total.expectedMinor),
    low: fmt(total.lowMinor),
    high: fmt(total.highMinor),
    bandFraction: range === 0 ? 0.5 : (total.expectedMinor - total.lowMinor) / range,
    ratePerM2: gfaM2 > 0 ? `${fmt(Math.round(total.expectedMinor / gfaM2))} / m²` : "—",
    confidence,
    match: humanize(selection.match),
    packName: selection.ratePackName,
    packVersion: selection.ratePackVersion,
    effectiveDate: selection.effectiveDate,
    stale: selection.stale,
    lines: lineItems.map((lineItem) => ({ label: lineItem.label, basis: lineItem.basis, amount: fmt(lineItem.amounts.expectedMinor) })),
    included: costEstimate.included,
    excluded: costEstimate.excluded,
    assumptions: costEstimate.assumptions,
    improveActions: costEstimate.improveConfidenceActions,
    disclaimer: costEstimate.disclaimer,
  };
}

// ---------------------------------------------------------------------------
// Rationale — scheme reasoning plus the architect-review verdict.

export type DeckReviewView = {
  verdict: "concurs" | "concurs_with_conditions" | "unavailable";
  confidence: string | null;
  concerns: Array<{ topic: string; recommendation: string; whyItMatters: string; whatItSaves: string }>;
  deltas: string[];
  rationale: string;
  assumptions: string[];
  evidence: string[];
};

export function deckReviewView(payload: DeckPayload): DeckReviewView {
  const review = payload.aiReview?.status === "reviewed" ? payload.aiReview.review : null;
  return {
    verdict: review ? (review.concurs && review.citedConcerns.length === 0 ? "concurs" : "concurs_with_conditions") : "unavailable",
    confidence: review ? review.confidence : null,
    concerns: (review?.citedConcerns ?? []).map((concern) => ({
      topic: humanize(concern.topic),
      recommendation: concern.recommendation,
      whyItMatters: concern.whyItMatters,
      whatItSaves: concern.whatItSaves,
    })),
    deltas: (review?.requirementDeltas ?? []).map((delta) => delta.summary),
    rationale: payload.scheme.rationale,
    assumptions: payload.intentAssumptions,
    evidence: payload.scheme.evidence,
  };
}
