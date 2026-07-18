import { describe, expect, test } from "bun:test";

import { createCurrentRequirements, DEFAULT_INTAKE_DRAFT } from "@/components/guided-intake/model";
import { generateV3PhysicalStage } from "@/lib/building/generate-v3-physical";
import { buildSemanticRenderCameras, SEMANTIC_CAMERA_VERSION } from "@/lib/render/camera";
import { buildCurrentRenderSpecs, compileCurrentGeometryLock, CURRENT_RENDER_CONTRACT_VERSION, currentRenderSpecPreservesGeometry } from "@/lib/render/current-prompts";

function fixture() {
  const requirements = createCurrentRequirements({
    ...DEFAULT_INTAKE_DRAFT,
    projectName: "WS9 road-side prompt fixture",
    roofCharacter: "sloped",
    includeParking: true,
  }, {
    shadeStructures: [{ id: "parking-open-pergola", type: "open_pergola", location: "parking", targetAreaM2: 12, source: "user" }],
  });
  const building = generateV3PhysicalStage(requirements).schemes[0].building;
  return { requirements, building };
}

describe("v3 semantic render camera and prompt", () => {
  test("derives the primary view from the canonical entry facade rather than site facing", () => {
    const { building } = fixture();
    const cameras = buildSemanticRenderCameras(building);
    const primaryFacade = building.facadeZones.find((zone) => zone.role === "primary_road_elevation")!;
    const main = building.floors.flatMap((floor) => floor.openings).find((opening) => opening.role === "main_entry")!;
    expect(cameras.primary_road_elevation).toMatchObject({
      cameraVersion: SEMANTIC_CAMERA_VERSION,
      view: "primary_road_elevation",
      facadeSide: primaryFacade.side,
      facadeRole: "primary_road_elevation",
      targetOpeningId: main.id,
      mainEntryMustBeVisible: true,
      geometryHash: building.candidate.geometryHash,
    });
    expect(cameras.primary_road_elevation.targetWallIds).toContain(main.wallId);
    expect(building.site.roadEdges).toContain(cameras.primary_road_elevation.facadeSide);
    if (primaryFacade.side === "south") expect(cameras.primary_road_elevation.positionMm.y).toBeGreaterThan(cameras.primary_road_elevation.targetMm.y);
    if (primaryFacade.side === "north") expect(cameras.primary_road_elevation.positionMm.y).toBeLessThan(cameras.primary_road_elevation.targetMm.y);
    if (primaryFacade.side === "east") expect(cameras.primary_road_elevation.positionMm.x).toBeGreaterThan(cameras.primary_road_elevation.targetMm.x);
    if (primaryFacade.side === "west") expect(cameras.primary_road_elevation.positionMm.x).toBeLessThan(cameras.primary_road_elevation.targetMm.x);
  });

  test("compiles deterministic image-2 facts for roofs, supports, guards, pergola and main door", () => {
    const { requirements, building } = fixture();
    const selected = building.floors[0].spaces.find((space) => space.type === "living")!;
    const first = buildCurrentRenderSpecs({ building, requirements, selectedInteriorSpaceId: selected.id });
    const second = buildCurrentRenderSpecs({ building, requirements, selectedInteriorSpaceId: selected.id });
    expect(first).toEqual(second);
    expect(CURRENT_RENDER_CONTRACT_VERSION).toBe(3);
    const image2 = first.find((spec) => spec.releaseEvalTarget === "gpt_image_2_designer_elevation")!;
    expect(image2.purpose).toBe("exterior_front");
    expect(image2.semanticView).toBe("primary_road_elevation");
    expect(image2.prompt).toContain("This is GPT IMAGE 2");
    expect(image2.prompt).toContain(`canonical camera position mm (${image2.semanticCamera!.positionMm.x}, ${image2.semanticCamera!.positionMm.y}, ${image2.semanticCamera!.positionMm.z})`);
    expect(image2.prompt).toContain("The complete main entry must remain plainly visible");
    expect(image2.prompt).toContain("Concentrate premium articulation on the canonical");
    expect(image2.prompt).toContain("Keep secondary facades quieter and subordinate");
    expect(image2.prompt).toContain("open and slatted, never a solid plane");
    for (const roof of building.roofSystems) expect(image2.prompt).toContain(roof.id);
    for (const support of building.secondaryRoofSupports) expect(image2.prompt).toContain(support.id);
    expect(image2.prompt).toContain(building.edgeProtections.length ? building.edgeProtections[0].id : "none required at this geometry");
    expect(image2.prompt).toContain("door.main-entry.warm-wood");
    expect(currentRenderSpecPreservesGeometry(image2, building)).toBe(true);
  });

  test("fails geometry-preservation binding after any lock or canonical hash change", () => {
    const { requirements, building } = fixture();
    const selected = building.floors[0].spaces.find((space) => space.type === "living")!;
    const spec = buildCurrentRenderSpecs({ building, requirements, selectedInteriorSpaceId: selected.id })[0];
    const changedSpec = structuredClone(spec);
    changedSpec.geometryLock.openingSignatures.pop();
    expect(currentRenderSpecPreservesGeometry(changedSpec, building)).toBe(false);
    expect(currentRenderSpecPreservesGeometry(spec, { ...building, candidate: { ...building.candidate, geometryHash: "changed-geometry" } })).toBe(false);
    expect(spec.geometryLock).toEqual(compileCurrentGeometryLock(building));
  });
});
