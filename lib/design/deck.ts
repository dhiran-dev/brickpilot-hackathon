import type { BuildingRequirements } from "@/lib/building/requirements";
import type { Building } from "@/lib/building/schema";
import type { CostEstimate } from "@/lib/cost/schema";
import type { PersistedScheme } from "@/lib/design/persisted-study";
import type { ArchitecturalReviewResult } from "@/lib/ai/schema";
import type { ValidationReport } from "@/lib/validation";

export type DeckRenderAsset = {
  id: string;
  role: "exterior_front" | "exterior_collage" | "exterior_top" | "interior" | string;
  url: string;
  contentType: string;
};

export type DeckRenders = {
  status: "idle" | "processing" | "partial" | "completed" | "failed";
  assets: DeckRenderAsset[];
};

export type DeckPayload = {
  projectId: string;
  designId: string;
  title: string;
  location: string;
  generatedAt: string;
  requirements: BuildingRequirements;
  building: Building;
  validation: ValidationReport;
  costEstimate: CostEstimate;
  aiReview: ArchitecturalReviewResult | null;
  scheme: PersistedScheme;
  intentAssumptions: string[];
  renders: DeckRenders;
};

export type DeckSlideKind =
  | "cover"
  | "overview"
  | "floor_plan"
  | "render"
  | "room_schedule"
  | "validation"
  | "cost"
  | "rationale"
  | "back_cover";

export type DeckSlide =
  | { kind: "cover" }
  | { kind: "overview" }
  | { kind: "floor_plan"; floorId: string; floorLabel: string; floorIndex: number }
  | { kind: "render"; role: string; label: string }
  | { kind: "room_schedule" }
  | { kind: "validation" }
  | { kind: "cost" }
  | { kind: "rationale" }
  | { kind: "back_cover" };

export type DeckSlideWithSheet = DeckSlide & { title: string; sheetNumber: number; sheetTotal: number };

const SLIDE_TITLES: Record<DeckSlideKind, string> = {
  cover: "Cover",
  overview: "Project Overview",
  floor_plan: "Floor Plan",
  render: "Concept Render",
  room_schedule: "Room Schedule",
  validation: "Validation Report",
  cost: "Cost Estimate",
  rationale: "Design Rationale",
  back_cover: "Back Cover",
};

const RENDER_TILES: Array<{ role: string; label: string }> = [
  { role: "exterior_front", label: "Front / road perspective" },
  { role: "exterior_collage", label: "Four-view collage" },
  { role: "exterior_top", label: "High front-right perspective" },
  { role: "interior", label: "Furnished interior concept" },
];

export function deriveDeckSlides(payload: DeckPayload): DeckSlideWithSheet[] {
  const floorSlides: DeckSlide[] = payload.building.floors.map((floor, index) => ({
    kind: "floor_plan",
    floorId: floor.id,
    floorLabel: floor.label,
    floorIndex: index,
  }));
  const renderSlides: DeckSlide[] = RENDER_TILES.map((tile) => ({
    kind: "render",
    role: tile.role,
    label: tile.label,
  }));
  const slides: DeckSlide[] = [
    { kind: "cover" },
    { kind: "overview" },
    ...floorSlides,
    ...renderSlides,
    { kind: "room_schedule" },
    { kind: "validation" },
    { kind: "cost" },
    { kind: "rationale" },
    { kind: "back_cover" },
  ];
  return slides.map((slide, index) => ({
    ...slide,
    title: slide.kind === "floor_plan" ? `${slide.floorLabel} Plan` : slide.kind === "render" ? slide.label : SLIDE_TITLES[slide.kind],
    sheetNumber: index + 1,
    sheetTotal: slides.length,
  }));
}
