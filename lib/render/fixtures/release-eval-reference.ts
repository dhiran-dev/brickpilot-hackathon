import type { SemanticRenderCamera } from "@/lib/render/camera";
import { CURRENT_PROMPT_VERSION } from "@/lib/render/current-prompts";
import {
  AESTHETIC_RENDER_CRITERIA,
  deriveRenderEvalResult,
  RENDER_EVAL_EVALUATOR_VERSION,
  RENDER_EVAL_RUBRIC_VERSION,
  renderEvalSampleSchema,
  STRUCTURAL_RENDER_CRITERIA,
  type RenderEvalSample,
} from "@/lib/render/release-eval";

/** Offline five-sample provider fixture. Provider job IDs are intentionally independent; no seed is claimed. */
export function buildOfflineRenderEvalSamples(input: {
  geometryHash: string;
  prompt: string;
  camera: SemanticRenderCamera;
  structuralFailures?: Partial<Record<number, typeof STRUCTURAL_RENDER_CRITERIA[number]>>;
  aestheticFailures?: Partial<Record<number, typeof AESTHETIC_RENDER_CRITERIA[number]>>;
  reviewerId?: string;
}): RenderEvalSample[] {
  return Array.from({ length: 5 }, (_, offset) => {
    const sampleIndex = offset + 1;
    const structural = Object.fromEntries(STRUCTURAL_RENDER_CRITERIA.map((criterion) => [criterion, input.structuralFailures?.[sampleIndex] !== criterion])) as RenderEvalSample["structural"];
    const aesthetic = Object.fromEntries(AESTHETIC_RENDER_CRITERIA.map((criterion) => [criterion, input.aestheticFailures?.[sampleIndex] !== criterion])) as RenderEvalSample["aesthetic"];
    const result = deriveRenderEvalResult({ structural, aesthetic });
    return renderEvalSampleSchema.parse({
      event: "render_release_eval_sample",
      recordVersion: 1,
      sampleId: `offline-reference-sample-${sampleIndex}`,
      sampleIndex,
      providerJobId: `offline-independent-provider-job-${sampleIndex}`,
      provider: "offline-fixture-provider",
      modelVersion: "offline-model-contract-v1",
      promptVersion: CURRENT_PROMPT_VERSION,
      prompt: input.prompt,
      inputReferences: [{ role: "massing_front", storageKey: "fixtures/reference-primary-road.webp", checksum: "source-primary-road-checksum" }],
      semanticCamera: input.camera,
      geometryHash: input.geometryHash,
      output: { storageKey: `fixtures/output-${sampleIndex}.webp`, contentType: "image/webp", checksum: `output-checksum-${sampleIndex}` },
      evaluator: { kind: "approved_vision_evaluator", id: "offline-evaluator", version: RENDER_EVAL_EVALUATOR_VERSION },
      rubricVersion: RENDER_EVAL_RUBRIC_VERSION,
      structural,
      aesthetic,
      ...result,
      humanDisposition: { reviewerId: input.reviewerId ?? "reviewer-1", disposition: "approved", note: "Offline contract fixture; replace with stored release evidence." },
      evaluatedAt: `2026-07-18T00:00:0${offset}.000Z`,
    });
  });
}
