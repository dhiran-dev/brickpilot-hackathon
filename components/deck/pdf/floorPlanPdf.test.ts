import { describe, expect, test } from "bun:test";

import { generateBuilding } from "@/lib/building/generate";
import { squareMetresToMm2, type BuildingRequirements } from "@/lib/building/requirements";
import { buildDrawing } from "@/lib/drawing/build-drawing";
import { floorPlanToPdfPrimitives } from "@/components/deck/pdf/floorPlanPdf";

function requirements(): BuildingRequirements {
  return {
    requirementSchemaVersion: 2,
    projectName: "PDF fixture residence",
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

describe("floorPlanToPdfPrimitives", () => {
  test("emits walls, room labels, area labels, and dimensions from the drawing artifact", () => {
    const req = requirements();
    const generated = generateBuilding(req);
    const drawing = buildDrawing(generated.building);
    const artifact = drawing.floors[0];
    const primitives = floorPlanToPdfPrimitives(artifact);
    expect(primitives.walls).toHaveLength(artifact.walls.length);
    expect(primitives.roomLabels).toHaveLength(artifact.rooms.length);
    expect(primitives.areaLabels).toHaveLength(artifact.rooms.length);
    expect(primitives.roomLabels.every((label) => label.name === label.name.toUpperCase())).toBe(true);
    expect(primitives.areaLabels.every((label) => label.label.endsWith(" SQM"))).toBe(true);
  });
});
