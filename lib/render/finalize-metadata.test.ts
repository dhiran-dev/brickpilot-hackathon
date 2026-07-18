import { describe, expect, test } from "bun:test";

import { createCurrentRequirements, DEFAULT_INTAKE_DRAFT } from "@/components/guided-intake/model";
import { generateV3PhysicalStage } from "@/lib/building/generate-v3-physical";
import { buildCurrentRenderSpecs } from "@/lib/render/current-prompts";

process.env.DATABASE_URL ||= "postgres://brickpilot:brickpilot@127.0.0.1:5432/brickpilot_test";
const { parseRenderJobMetadata } = await import("@/lib/render/finalize-job");

describe("render finalization metadata integrity", () => {
  test("keeps accepting frozen and in-flight v2 metadata", () => {
    expect(parseRenderJobMetadata({ renderContractVersion: 2, renderPurpose: "exterior_front", requestedOutputCount: 1 }))
      .toEqual({ purpose: "exterior_front", requestedOutputCount: 1, releaseEval: null });
    expect(parseRenderJobMetadata({ renderContractVersion: 1, renderPurpose: "exterior", requestedOutputCount: 2 }))
      .toEqual({ purpose: "exterior", requestedOutputCount: 2, releaseEval: null });
  });

  test("accepts a fully geometry-bound v3 primary elevation record", () => {
    const requirements = createCurrentRequirements({ ...DEFAULT_INTAKE_DRAFT, roofCharacter: "sloped" });
    const building = generateV3PhysicalStage(requirements).schemes[0].building;
    const selected = building.floors.flatMap((floor) => floor.spaces).find((space) => space.type === "living")!;
    const spec = buildCurrentRenderSpecs({ building, requirements, selectedInteriorSpaceId: selected.id })[0];
    const metadata = parseRenderJobMetadata({
      renderContractVersion: 3,
      renderPurpose: spec.purpose,
      requestedOutputCount: 1,
      geometryHash: building.candidate.geometryHash,
      promptVersion: spec.promptVersion,
      prompt: spec.prompt,
      semanticCamera: spec.semanticCamera,
      geometryLock: spec.geometryLock,
      releaseEvalTarget: spec.releaseEvalTarget,
      providerModelVersion: "openai/gpt-image-2",
      inputReferences: [{ role: spec.sourceRole, storageKey: "sources/layout/scheme/package/massing_front.webp", checksum: "checksum" }],
    });
    expect(metadata.releaseEval).toMatchObject({ geometryHash: building.candidate.geometryHash, providerModelVersion: "openai/gpt-image-2" });
  });

  test("rejects camera and canonical geometry mismatch before output storage", () => {
    expect(() => parseRenderJobMetadata({
      renderContractVersion: 3,
      renderPurpose: "exterior_front",
      requestedOutputCount: 1,
      geometryHash: "canonical-hash",
      promptVersion: "architectural-edit-v3.0.0",
      prompt: "x".repeat(150),
      semanticCamera: { view: "primary_road_elevation", targetOpeningId: "entry", geometryHash: "stale-hash" },
      geometryLock: { geometryHash: "canonical-hash" },
      releaseEvalTarget: "gpt_image_2_designer_elevation",
      providerModelVersion: "openai/gpt-image-2",
      inputReferences: [{ role: "massing_front", storageKey: "source.webp", checksum: "checksum" }],
    })).toThrow("geometry binding");
  });
});
