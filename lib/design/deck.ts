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
  | "render_gallery"
  | "room_schedule"
  | "validation"
  | "cost"
  | "rationale"
  | "back_cover";

export type DeckSlide =
  | { kind: "cover" }
  | { kind: "overview" }
  | { kind: "floor_plan"; floorId: string; floorLabel: string; floorIndex: number }
  | { kind: "render_gallery" }
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
  render_gallery: "Concept Renders",
  room_schedule: "Room Schedule",
  validation: "Validation Report",
  cost: "Cost Estimate",
  rationale: "Design Rationale",
  back_cover: "Back Cover",
};

export function deriveDeckSlides(payload: DeckPayload): DeckSlideWithSheet[] {
  const floorSlides: DeckSlide[] = payload.building.floors.map((floor, index) => ({
    kind: "floor_plan",
    floorId: floor.id,
    floorLabel: floor.label,
    floorIndex: index,
  }));
  const slides: DeckSlide[] = [
    { kind: "cover" },
    { kind: "overview" },
    ...floorSlides,
    { kind: "render_gallery" },
    { kind: "room_schedule" },
    { kind: "validation" },
    { kind: "cost" },
    { kind: "rationale" },
    { kind: "back_cover" },
  ];
  return slides.map((slide, index) => ({
    ...slide,
    title: slide.kind === "floor_plan" ? `${slide.floorLabel} Plan` : SLIDE_TITLES[slide.kind],
    sheetNumber: index + 1,
    sheetTotal: slides.length,
  }));
}
