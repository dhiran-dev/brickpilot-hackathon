import { describe, expect, test } from "bun:test";

import { generateBuilding } from "@/lib/building/generate";
import { squareMetresToMm2, type BuildingRequirements } from "@/lib/building/requirements";
import { buildDrawing } from "@/lib/drawing/build-drawing";
import { planPrimitives } from "@/components/deck/planPrimitives";

function requirements(): BuildingRequirements {
  return {
    requirementSchemaVersion: 2,
    projectName: "Plan primitives fixture residence",
    buildingType: "detached_house",
    region: { countryCode: "IN", adminArea: "Karnataka", locality: "Bengaluru", locale: "en-IN", currency: "INR" },
    displayUnit: "metric",
    site: { widthMm: 12_000, depthMm: 18_000, facing: "east", roadEdges: ["east"], irregular: false, setbacksMm: { north: 1000, east: 1000, south: 1000, west: 1000 } },
    floors: [{ id: "F0", label: "Ground", level: 0, floorHeightMm: 3000 }],
    rooms: [
      { id: "living", name: "Living", type: "living", floorId: "F0", minAreaMm2: squareMetresToMm2(13.5), targetAreaMm2: squareMetresToMm2(18), privacy: "public", preferredZone: "any", mustBeExterior: false, accessible: false },
      { id: "kitchen", name: "Kitchen", type: "kitchen", floorId: "F0", minAreaMm2: squareMetresToMm2(7.5), targetAreaMm2: squareMetresToMm2(10), privacy: "service", preferredZone: "any", mustBeExterior: false, accessible: false },
      { id: "bed1", name: "Bedroom 1", type: "bedroom", floorId: "F0", minAreaMm2: squareMetresToMm2(10.5), targetAreaMm2: squareMetresToMm2(14), privacy: "private", preferredZone: "any", mustBeExterior: false, accessible: false },
      { id: "bath1", name: "Bathroom 1", type: "bathroom", floorId: "F0", minAreaMm2: squareMetresToMm2(3.75), targetAreaMm2: squareMetresToMm2(5), privacy: "service", preferredZone: "any", mustBeExterior: false, accessible: false },
    ],
    relationships: [],
    household: { occupants: 4, accessibilityRequired: false },
    vertical: { stairFamily: "dog_leg", stairWidthMm: 1000, liftProvision: false },
    architecture: { style: "contemporary_tropical", formStrategy: "compact", roofCharacter: "flat_parapet", materialDirection: "warm_natural" },
    budget: { qualityTier: "standard", contingencyPercent: 7.5, taxPercent: 0 },
    seed: 42,
  };
}

describe("planPrimitives", () => {
  const artifact = buildDrawing(generateBuilding(requirements()).building).floors[0];
  const plan = planPrimitives(artifact);

  test("emits every wall, room, label, furniture item and opening from the artifact", () => {
    expect(plan.walls).toHaveLength(artifact.walls.length);
    expect(plan.roomFills).toHaveLength(artifact.rooms.length);
    expect(plan.roomLabels).toHaveLength(artifact.rooms.length);
    expect(plan.furniture).toHaveLength(artifact.furniture.length);
    expect(plan.openings).toHaveLength(artifact.openings.length);
    expect(plan.roomLabels.every((label) => label.name === label.name.toUpperCase())).toBe(true);
    expect(plan.areaLabels.every((label) => label.label.endsWith(" M²"))).toBe(true);
  });

  test("crops the view below the full sheet depth and still contains the site", () => {
    // The drawing sheet's viewBox includes a title-block band below the plan;
    // the deck crop drops it but keeps side geometry (roads, dimensions).
    expect(plan.view.depth).toBeLessThan(artifact.viewBox.depth);
    expect(plan.view.x).toBeLessThanOrEqual(artifact.siteBounds.x);
    expect(plan.view.y).toBeLessThanOrEqual(artifact.siteBounds.y);
    expect(plan.view.x + plan.view.width).toBeGreaterThanOrEqual(artifact.siteBounds.x + artifact.siteBounds.width);
    expect(plan.view.y + plan.view.depth).toBeGreaterThanOrEqual(artifact.siteBounds.y + artifact.siteBounds.depth);
  });

  test("samples door swings into arc points and keeps windows as parallel lines", () => {
    const door = plan.openings.find((opening) => opening.kind === "door");
    expect(door).toBeDefined();
    expect(door!.arcPoints.length).toBeGreaterThan(2);
    expect(door!.lines.some((line) => line.stroke === "#fff6ea")).toBe(true);
    const window = plan.openings.find((opening) => opening.kind === "window");
    if (window) {
      expect(window.lines).toHaveLength(2);
      expect(window.arcPoints).toHaveLength(0);
    }
  });

  test("marks the entrance opening with an arrow shaft and head", () => {
    const entrance = plan.openings.find((opening) => opening.entrance);
    expect(entrance).toBeDefined();
    expect(entrance!.entrance!.head).toHaveLength(3);
  });
});
