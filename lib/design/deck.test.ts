import { describe, expect, test } from "bun:test";

import { generateBuilding } from "@/lib/building/generate";
import { squareMetresToMm2, type BuildingRequirements } from "@/lib/building/requirements";
import { estimateBuildingCost } from "@/lib/cost/estimate";
import { deriveDeckSlides, type DeckPayload } from "@/lib/design/deck";

function requirements(floorCount: 1 | 2): BuildingRequirements {
  const floors = Array.from({ length: floorCount }, (_, level) => ({
    id: `F${level}` as `F${0 | 1}`,
    label: level === 0 ? "Ground" : `Floor ${level}`,
    level,
    floorHeightMm: 3000,
  }));
  const roomTemplates = [
    { suffix: "living", name: "Living", type: "living" as const, area: 18, privacy: "public" as const, zone: "north" as const },
    { suffix: "kitchen", name: "Kitchen", type: "kitchen" as const, area: 10, privacy: "service" as const, zone: "southeast" as const },
    { suffix: "bed", name: "Bedroom", type: "bedroom" as const, area: 14, privacy: "private" as const, zone: "southwest" as const },
    { suffix: "bath", name: "Bathroom", type: "bathroom" as const, area: 5, privacy: "service" as const, zone: "west" as const },
  ];
  return {
    requirementSchemaVersion: 2,
    projectName: "Deck fixture residence",
    buildingType: "detached_house",
    region: { countryCode: "IN", adminArea: "Karnataka", locality: "Bengaluru", locale: "en-IN", currency: "INR" },
    displayUnit: "metric",
    site: { widthMm: 12_000, depthMm: 18_000, facing: "east", roadEdges: ["east"], irregular: false, setbacksMm: { north: 1000, east: 1000, south: 1000, west: 1000 } },
    floors,
    rooms: floors.flatMap((floor) => roomTemplates.map((room) => ({
      id: `${floor.id.toLowerCase()}-${room.suffix}`,
      name: `${room.name} ${floor.label}`,
      type: room.type,
      floorId: floor.id,
      minAreaMm2: squareMetresToMm2(room.area * 0.75),
      targetAreaMm2: squareMetresToMm2(room.area),
      privacy: room.privacy,
      preferredZone: room.zone,
      mustBeExterior: room.type === "living",
      accessible: floor.level === 0,
    }))),
    relationships: [],
    household: { occupants: 4, accessibilityRequired: false },
    vertical: { stairFamily: "dog_leg", stairWidthMm: 1000, liftProvision: false },
    architecture: { style: "contemporary_tropical", formStrategy: "stepped_terraces", roofCharacter: "mixed", materialDirection: "warm_natural" },
    budget: { qualityTier: "standard", contingencyPercent: 7.5, taxPercent: 0 },
    seed: 42,
  };
}

function fixturePayload(floorCount: 1 | 2): DeckPayload {
  const req = requirements(floorCount);
  const generated = generateBuilding(req);
  const cost = estimateBuildingCost(generated.building, req);
  return {
    projectId: "project-1",
    designId: "design-1",
    title: req.projectName,
    location: `${req.region.locality}, ${req.region.adminArea}`,
    generatedAt: new Date("2026-07-17T00:00:00.000Z").toISOString(),
    requirements: req,
    building: generated.building,
    validation: generated.validation,
    costEstimate: cost,
    aiReview: null,
    scheme: {
      schemeId: `fixture-${generated.building.candidate.geometryHash}`,
      partiId: generated.building.candidate.generatorId,
      name: "Fixture scheme",
      rationale: "Deterministic fixture scheme used for deck slide-derivation tests.",
      building: generated.building,
      validation: generated.validation,
      evidence: ["Zero overlaps across constructed candidates."],
      ladderRung: 0,
    },
    intentAssumptions: [],
    renders: { status: "idle", assets: [] },
  };
}

describe("deriveDeckSlides", () => {
  test("orders slides with one floor plan and four render slides for a single-floor building", () => {
    const slides = deriveDeckSlides(fixturePayload(1));
    expect(slides.map((slide) => slide.kind)).toEqual([
      "cover", "overview", "floor_plan", "render", "render", "render", "render", "room_schedule", "validation", "cost", "rationale", "back_cover",
    ]);
    expect(slides).toHaveLength(12);
    expect(slides[0].sheetTotal).toBe(12);
  });

  test("adds one floor-plan slide per additional floor, in floor order", () => {
    const slides = deriveDeckSlides(fixturePayload(2));
    const floorPlanSlides = slides.filter((slide): slide is Extract<typeof slides[number], { kind: "floor_plan" }> => slide.kind === "floor_plan");
    expect(floorPlanSlides).toHaveLength(2);
    expect(floorPlanSlides.map((slide) => slide.floorLabel)).toEqual(["Ground", "Floor 1"]);
    expect(slides).toHaveLength(13);
  });

  test("numbers every sheet sequentially starting at 1", () => {
    const slides = deriveDeckSlides(fixturePayload(1));
    expect(slides.map((slide) => slide.sheetNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  test("titles a floor-plan slide after its floor label", () => {
    const slides = deriveDeckSlides(fixturePayload(1));
    const floorPlan = slides.find((slide) => slide.kind === "floor_plan");
    expect(floorPlan?.title).toBe("Ground Plan");
  });

  test("titles each render slide after its tile label", () => {
    const slides = deriveDeckSlides(fixturePayload(1));
    const renderSlides = slides.filter((slide): slide is Extract<typeof slides[number], { kind: "render" }> => slide.kind === "render");
    expect(renderSlides).toHaveLength(4);
    expect(renderSlides.map((slide) => slide.label)).toEqual([
      "Front / road perspective",
      "Four-view collage",
      "High front-right perspective",
      "Furnished interior concept",
    ]);
  });
});
