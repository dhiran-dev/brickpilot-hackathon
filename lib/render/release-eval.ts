import { z } from "zod";

import { SEMANTIC_CAMERA_VERSION, SEMANTIC_RENDER_VIEWS } from "@/lib/render/camera";
import { CURRENT_PROMPT_VERSION } from "@/lib/render/current-prompts";
import { RENDER_EVAL_SAMPLE_COUNT } from "@/lib/building/v3-constants";

export const RENDER_EVAL_RUBRIC_VERSION = "render-eval-rubric-v1.0.0" as const;
export const RENDER_EVAL_EVALUATOR_VERSION = "human-or-approved-vision-v1" as const;

export const STRUCTURAL_RENDER_CRITERIA = [
  "primary_facade_and_camera_match",
  "main_entry_visible_and_distinct",
  "roof_geometry_preserved",
  "supports_preserved",
  "guards_preserved",
  "open_pergola_preserved",
  "footprint_preserved",
  "openings_preserved",
] as const;

export const AESTHETIC_RENDER_CRITERIA = [
  "primary_facade_material_sophistication",
  "primary_secondary_facade_hierarchy",
  "coherent_buildable_palette",
] as const;

const structuralResultSchema = z.object(Object.fromEntries(STRUCTURAL_RENDER_CRITERIA.map((criterion) => [criterion, z.boolean()])) as {
  [Criterion in typeof STRUCTURAL_RENDER_CRITERIA[number]]: z.ZodBoolean;
});
const aestheticResultSchema = z.object(Object.fromEntries(AESTHETIC_RENDER_CRITERIA.map((criterion) => [criterion, z.boolean()])) as {
  [Criterion in typeof AESTHETIC_RENDER_CRITERIA[number]]: z.ZodBoolean;
});

const semanticCameraRecordSchema = z.object({
  cameraVersion: z.literal(SEMANTIC_CAMERA_VERSION),
  view: z.enum(SEMANTIC_RENDER_VIEWS),
  facadeSide: z.enum(["north", "east", "south", "west"]),
  facadeRole: z.enum(["primary_road_elevation", "secondary_road_elevation", "garden", "service"]),
  targetWallIds: z.array(z.string().min(1)).min(1),
  targetOpeningId: z.string().min(1).optional(),
  positionMm: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  targetMm: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  mainEntryMustBeVisible: z.boolean(),
  geometryHash: z.string().min(1),
});

export const renderEvalSampleSchema = z.object({
  event: z.literal("render_release_eval_sample"),
  recordVersion: z.literal(1),
  sampleId: z.string().min(1),
  sampleIndex: z.number().int().min(1).max(RENDER_EVAL_SAMPLE_COUNT),
  providerJobId: z.string().min(1),
  provider: z.string().min(1),
  modelVersion: z.string().min(1),
  promptVersion: z.literal(CURRENT_PROMPT_VERSION),
  prompt: z.string().min(100),
  inputReferences: z.array(z.object({ role: z.string().min(1), storageKey: z.string().min(1), checksum: z.string().min(1) })).min(1),
  semanticCamera: semanticCameraRecordSchema,
  geometryHash: z.string().min(1),
  output: z.object({ storageKey: z.string().min(1), contentType: z.string().min(1), checksum: z.string().min(1) }),
  evaluator: z.object({ kind: z.enum(["human", "approved_vision_evaluator"]), id: z.string().min(1), version: z.literal(RENDER_EVAL_EVALUATOR_VERSION) }),
  rubricVersion: z.literal(RENDER_EVAL_RUBRIC_VERSION),
  structural: structuralResultSchema,
  aesthetic: aestheticResultSchema,
  structuralPass: z.boolean(),
  aestheticPass: z.boolean(),
  humanDisposition: z.object({ reviewerId: z.string().min(1), disposition: z.enum(["approved", "rejected"]), note: z.string().max(2_000).optional() }).nullable(),
  evaluatedAt: z.string().datetime(),
}).superRefine((record, context) => {
  const structuralPass = STRUCTURAL_RENDER_CRITERIA.every((criterion) => record.structural[criterion]);
  const aestheticPass = AESTHETIC_RENDER_CRITERIA.every((criterion) => record.aesthetic[criterion]);
  if (record.structuralPass !== structuralPass) context.addIssue({ code: "custom", path: ["structuralPass"], message: "Structural pass must be derived from every hard criterion." });
  if (record.aestheticPass !== aestheticPass) context.addIssue({ code: "custom", path: ["aestheticPass"], message: "Aesthetic pass must be derived from every aesthetic criterion." });
  if (record.geometryHash !== record.semanticCamera.geometryHash) context.addIssue({ code: "custom", path: ["geometryHash"], message: "Camera and output evaluation must bind the same canonical geometry hash." });
  if (record.semanticCamera.view !== "primary_road_elevation"
    || record.semanticCamera.facadeRole !== "primary_road_elevation"
    || !record.semanticCamera.mainEntryMustBeVisible
    || !record.semanticCamera.targetOpeningId) {
    context.addIssue({ code: "custom", path: ["semanticCamera"], message: "Release evaluation is only valid for the GPT image 2 primary-road/main-entry camera." });
  }
});

export type RenderEvalSample = z.infer<typeof renderEvalSampleSchema>;
export type StructuralRenderResults = z.infer<typeof structuralResultSchema>;
export type AestheticRenderResults = z.infer<typeof aestheticResultSchema>;

export const renderEvalAggregateSchema = z.object({
  event: z.literal("render_release_eval_aggregate"),
  recordVersion: z.literal(1),
  rubricVersion: z.literal(RENDER_EVAL_RUBRIC_VERSION),
  geometryHash: z.string().min(1),
  sampleIds: z.array(z.string().min(1)).length(RENDER_EVAL_SAMPLE_COUNT),
  providerJobIds: z.array(z.string().min(1)).length(RENDER_EVAL_SAMPLE_COUNT),
  sampleCount: z.literal(RENDER_EVAL_SAMPLE_COUNT),
  structuralPassedCount: z.number().int().min(0).max(RENDER_EVAL_SAMPLE_COUNT),
  aestheticPassedCount: z.number().int().min(0).max(RENDER_EVAL_SAMPLE_COUNT),
  structuralPassRate: z.number().min(0).max(1),
  aestheticPassRate: z.number().min(0).max(1),
  humanReviewerId: z.string().min(1).nullable(),
  humanApprovedCount: z.number().int().min(0).max(RENDER_EVAL_SAMPLE_COUNT),
  releaseGatePassed: z.boolean(),
  generatedAt: z.string().datetime(),
});

export type RenderEvalAggregate = z.infer<typeof renderEvalAggregateSchema>;

export function deriveRenderEvalResult(input: {
  structural: StructuralRenderResults;
  aesthetic: AestheticRenderResults;
}) {
  return {
    structuralPass: STRUCTURAL_RENDER_CRITERIA.every((criterion) => input.structural[criterion]),
    aestheticPass: AESTHETIC_RENDER_CRITERIA.every((criterion) => input.aesthetic[criterion]),
  };
}

/** Aggregates stored offline/real provider evaluations. It never calls an image provider. */
export function aggregateRenderReleaseEval(samples: RenderEvalSample[], generatedAt = new Date().toISOString()): RenderEvalAggregate {
  const parsed = samples.map((sample) => renderEvalSampleSchema.parse(sample));
  if (parsed.length !== RENDER_EVAL_SAMPLE_COUNT) throw new Error(`RENDER_EVAL_REQUIRES_${RENDER_EVAL_SAMPLE_COUNT}_INDEPENDENT_SAMPLES`);
  if (new Set(parsed.map((sample) => sample.sampleId)).size !== RENDER_EVAL_SAMPLE_COUNT
    || new Set(parsed.map((sample) => sample.providerJobId)).size !== RENDER_EVAL_SAMPLE_COUNT
    || new Set(parsed.map((sample) => sample.sampleIndex)).size !== RENDER_EVAL_SAMPLE_COUNT) {
    throw new Error("RENDER_EVAL_SAMPLES_MUST_BE_INDEPENDENT");
  }
  if (new Set(parsed.map((sample) => sample.geometryHash)).size !== 1) throw new Error("RENDER_EVAL_GEOMETRY_BINDING_MISMATCH");
  const batchBindings = parsed.map((sample) => JSON.stringify({
    provider: sample.provider,
    modelVersion: sample.modelVersion,
    promptVersion: sample.promptVersion,
    prompt: sample.prompt,
    inputReferences: sample.inputReferences,
    semanticCamera: sample.semanticCamera,
  }));
  if (new Set(batchBindings).size !== 1) throw new Error("RENDER_EVAL_BATCH_BINDING_MISMATCH");
  const structuralPassedCount = parsed.filter((sample) => sample.structuralPass).length;
  const aestheticPassedCount = parsed.filter((sample) => sample.aestheticPass).length;
  const approved = parsed.filter((sample) => sample.humanDisposition?.disposition === "approved");
  const reviewerIds = [...new Set(approved.map((sample) => sample.humanDisposition!.reviewerId))];
  const humanReviewerId = approved.length === RENDER_EVAL_SAMPLE_COUNT && reviewerIds.length === 1 ? reviewerIds[0] : null;
  return renderEvalAggregateSchema.parse({
    event: "render_release_eval_aggregate",
    recordVersion: 1,
    rubricVersion: RENDER_EVAL_RUBRIC_VERSION,
    geometryHash: parsed[0].geometryHash,
    sampleIds: parsed.map((sample) => sample.sampleId),
    providerJobIds: parsed.map((sample) => sample.providerJobId),
    sampleCount: RENDER_EVAL_SAMPLE_COUNT,
    structuralPassedCount,
    aestheticPassedCount,
    structuralPassRate: structuralPassedCount / RENDER_EVAL_SAMPLE_COUNT,
    aestheticPassRate: aestheticPassedCount / RENDER_EVAL_SAMPLE_COUNT,
    humanReviewerId,
    humanApprovedCount: approved.length,
    releaseGatePassed: structuralPassedCount === RENDER_EVAL_SAMPLE_COUNT
      && aestheticPassedCount >= 4
      && humanReviewerId !== null,
    generatedAt,
  });
}
