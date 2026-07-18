import { describe, expect, test } from "bun:test";

import { createCurrentRequirements, DEFAULT_INTAKE_DRAFT } from "@/components/guided-intake/model";
import { generateV3PhysicalStage } from "@/lib/building/generate-v3-physical";
import { buildSemanticRenderCameras } from "@/lib/render/camera";
import { buildCurrentRenderSpecs } from "@/lib/render/current-prompts";
import { buildOfflineRenderEvalSamples } from "@/lib/render/fixtures/release-eval-reference";
import { aggregateRenderReleaseEval, renderEvalSampleSchema } from "@/lib/render/release-eval";

function fixture() {
  const requirements = createCurrentRequirements({ ...DEFAULT_INTAKE_DRAFT, roofCharacter: "sloped" }, {
    shadeStructures: [{ id: "parking-open-pergola", type: "open_pergola", location: "parking", targetAreaM2: 12, source: "user" }],
  });
  const building = generateV3PhysicalStage(requirements).schemes[0].building;
  const selected = building.floors[0].spaces.find((space) => space.type === "living")!;
  const prompt = buildCurrentRenderSpecs({ building, requirements, selectedInteriorSpaceId: selected.id })[0].prompt;
  return { building, prompt, camera: buildSemanticRenderCameras(building).primary_road_elevation };
}

describe("offline five-sample render release evaluation", () => {
  test("passes only with 5/5 structural, at least 4/5 aesthetic and one human reviewer", () => {
    const { building, prompt, camera } = fixture();
    const samples = buildOfflineRenderEvalSamples({ geometryHash: building.candidate.geometryHash, prompt, camera, aestheticFailures: { 5: "coherent_buildable_palette" } });
    samples.forEach((sample) => expect(renderEvalSampleSchema.safeParse(sample).success).toBe(true));
    expect(samples.every((sample) => !("seed" in sample))).toBe(true);
    const aggregate = aggregateRenderReleaseEval(samples, "2026-07-18T01:00:00.000Z");
    expect(aggregate).toMatchObject({
      sampleCount: 5,
      structuralPassedCount: 5,
      aestheticPassedCount: 4,
      structuralPassRate: 1,
      aestheticPassRate: 0.8,
      humanReviewerId: "reviewer-1",
      humanApprovedCount: 5,
      releaseGatePassed: true,
    });
  });

  test("blocks release on one structural failure or insufficient aesthetic samples", () => {
    const { building, prompt, camera } = fixture();
    const structuralFailure = buildOfflineRenderEvalSamples({ geometryHash: building.candidate.geometryHash, prompt, camera, structuralFailures: { 3: "roof_geometry_preserved" } });
    expect(aggregateRenderReleaseEval(structuralFailure).releaseGatePassed).toBe(false);
    const aestheticFailures = buildOfflineRenderEvalSamples({
      geometryHash: building.candidate.geometryHash,
      prompt,
      camera,
      aestheticFailures: { 1: "coherent_buildable_palette", 2: "primary_secondary_facade_hierarchy" },
    });
    expect(aggregateRenderReleaseEval(aestheticFailures)).toMatchObject({ aestheticPassedCount: 3, releaseGatePassed: false });
  });

  test("rejects duplicate provider jobs, mixed geometry and incomplete batches", () => {
    const { building, prompt, camera } = fixture();
    const samples = buildOfflineRenderEvalSamples({ geometryHash: building.candidate.geometryHash, prompt, camera });
    expect(() => aggregateRenderReleaseEval(samples.slice(0, 4))).toThrow("RENDER_EVAL_REQUIRES_5_INDEPENDENT_SAMPLES");
    const duplicate = structuredClone(samples);
    duplicate[4].providerJobId = duplicate[0].providerJobId;
    expect(() => aggregateRenderReleaseEval(duplicate)).toThrow("RENDER_EVAL_SAMPLES_MUST_BE_INDEPENDENT");
    const duplicateIndex = structuredClone(samples);
    duplicateIndex[4].sampleIndex = duplicateIndex[0].sampleIndex;
    expect(() => aggregateRenderReleaseEval(duplicateIndex)).toThrow("RENDER_EVAL_SAMPLES_MUST_BE_INDEPENDENT");
    const mixed = structuredClone(samples);
    mixed[4].geometryHash = "other-hash";
    mixed[4].semanticCamera.geometryHash = "other-hash";
    expect(() => aggregateRenderReleaseEval(mixed)).toThrow("RENDER_EVAL_GEOMETRY_BINDING_MISMATCH");
    const changedPrompt = structuredClone(samples);
    changedPrompt[4].prompt = `${changedPrompt[4].prompt} changed`;
    expect(() => aggregateRenderReleaseEval(changedPrompt)).toThrow("RENDER_EVAL_BATCH_BINDING_MISMATCH");
  });
});
