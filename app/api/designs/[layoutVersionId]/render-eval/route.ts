import { timingSafeEqual } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { readableBuildingSchema } from "@/lib/building/schema";
import { db } from "@/lib/db";
import { layoutVersions, projects, renderEvalAggregates, renderEvalSamples } from "@/lib/db/schema";
import {
  AESTHETIC_RENDER_CRITERIA,
  aggregateRenderReleaseEval,
  deriveRenderEvalResult,
  RENDER_EVAL_EVALUATOR_VERSION,
  RENDER_EVAL_RUBRIC_VERSION,
  renderEvalSampleSchema,
  STRUCTURAL_RENDER_CRITERIA,
  type RenderEvalSample,
} from "@/lib/render/release-eval";

const structuralSchema = z.object(Object.fromEntries(STRUCTURAL_RENDER_CRITERIA.map((criterion) => [criterion, z.boolean()])) as {
  [Criterion in typeof STRUCTURAL_RENDER_CRITERIA[number]]: z.ZodBoolean;
});
const aestheticSchema = z.object(Object.fromEntries(AESTHETIC_RENDER_CRITERIA.map((criterion) => [criterion, z.boolean()])) as {
  [Criterion in typeof AESTHETIC_RENDER_CRITERIA[number]]: z.ZodBoolean;
});
export const ownerDispositionSchema = z.object({
  sampleId: z.string().uuid(),
  disposition: z.enum(["approved", "rejected"]),
  note: z.string().max(2_000).optional(),
}).strict();
const evaluatorResultSchema = z.object({
  sampleId: z.string().uuid(),
  structural: structuralSchema,
  aesthetic: aestheticSchema,
}).strict();

function errorResponse(message: string, status: number, code: string) {
  return NextResponse.json({ error: message, code }, { status });
}

export function releaseEvalOwnerScope(requestUserId: string, projectOwnerId: string) {
  return requestUserId === projectOwnerId;
}

export function trustedEvaluatorTokenMatches(provided: string | null, expected: string | undefined) {
  if (!provided?.startsWith("Bearer ") || !expected) return false;
  const actual = Buffer.from(provided.slice("Bearer ".length));
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

function currentGeometryHash(layoutJson: unknown) {
  const building = readableBuildingSchema.safeParse(layoutJson);
  return building.success ? building.data.candidate.geometryHash : null;
}

async function ownedLayout(layoutVersionId: string, userId: string) {
  const [row] = await db.select({ projectId: projects.id, ownerId: projects.ownerId, layoutJson: layoutVersions.layoutJson })
    .from(layoutVersions)
    .innerJoin(projects, eq(layoutVersions.projectId, projects.id))
    .where(and(eq(layoutVersions.id, layoutVersionId), eq(projects.ownerId, userId)))
    .limit(1);
  if (!row) return null;
  const geometryHash = currentGeometryHash(row.layoutJson);
  return geometryHash ? { ...row, geometryHash } : null;
}

async function canonicalLayout(layoutVersionId: string) {
  const [row] = await db.select({ projectId: projects.id, layoutJson: layoutVersions.layoutJson })
    .from(layoutVersions)
    .innerJoin(projects, eq(layoutVersions.projectId, projects.id))
    .where(eq(layoutVersions.id, layoutVersionId))
    .limit(1);
  if (!row) return null;
  const geometryHash = currentGeometryHash(row.layoutJson);
  return geometryHash ? { ...row, geometryHash } : null;
}

type StoredEvalRow = typeof renderEvalSamples.$inferSelect;

function completeRecord(row: StoredEvalRow, humanDisposition: RenderEvalSample["humanDisposition"]): RenderEvalSample | null {
  if (!row.evaluator || !row.structural || !row.aesthetic || row.structuralPass == null || row.aestheticPass == null || !row.evaluatedAt) return null;
  const parsed = renderEvalSampleSchema.safeParse({
    event: "render_release_eval_sample",
    recordVersion: 1,
    sampleId: row.id,
    sampleIndex: row.sampleIndex,
    providerJobId: row.providerJobId,
    provider: row.provider,
    modelVersion: row.modelVersion,
    promptVersion: row.promptVersion,
    prompt: row.prompt,
    inputReferences: row.inputReferences,
    semanticCamera: row.semanticCamera,
    geometryHash: row.geometryHash,
    output: row.output,
    evaluator: row.evaluator,
    rubricVersion: row.rubricVersion,
    structural: row.structural,
    aesthetic: row.aesthetic,
    structuralPass: row.structuralPass,
    aestheticPass: row.aestheticPass,
    humanDisposition,
    evaluatedAt: row.evaluatedAt.toISOString(),
  });
  return parsed.success ? parsed.data : null;
}

async function upsertAggregate(projectId: string, layoutVersionId: string, geometryHash: string, now: Date) {
  const stored = await db.select().from(renderEvalSamples).where(and(
    eq(renderEvalSamples.layoutVersionId, layoutVersionId),
    eq(renderEvalSamples.projectId, projectId),
    eq(renderEvalSamples.geometryHash, geometryHash),
  )).orderBy(renderEvalSamples.sampleIndex);
  const records = stored.map((sample) => completeRecord(sample, sample.humanDisposition as RenderEvalSample["humanDisposition"]))
    .filter((sample): sample is RenderEvalSample => Boolean(sample));
  if (records.length !== 5) return null;
  const aggregate = aggregateRenderReleaseEval(records, now.toISOString());
  await db.insert(renderEvalAggregates).values({
    projectId,
    layoutVersionId,
    geometryHash,
    rubricVersion: RENDER_EVAL_RUBRIC_VERSION,
    aggregate,
    releaseGatePassed: aggregate.releaseGatePassed,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [renderEvalAggregates.layoutVersionId, renderEvalAggregates.geometryHash],
    set: { aggregate, releaseGatePassed: aggregate.releaseGatePassed, updatedAt: now },
  });
  return aggregate;
}

export async function GET(request: Request, context: { params: Promise<{ layoutVersionId: string }> }) {
  const user = await requireUser(request);
  if (!user) return errorResponse("Authentication is required.", 401, "AUTH_REQUIRED");
  const { layoutVersionId } = await context.params;
  const owned = await ownedLayout(layoutVersionId, user.id);
  if (!owned) return errorResponse("Study not found.", 404, "STUDY_NOT_FOUND");
  const samples = await db.select().from(renderEvalSamples)
    .where(and(
      eq(renderEvalSamples.layoutVersionId, layoutVersionId),
      eq(renderEvalSamples.projectId, owned.projectId),
      eq(renderEvalSamples.geometryHash, owned.geometryHash),
    ))
    .orderBy(renderEvalSamples.sampleIndex);
  const [aggregate] = await db.select().from(renderEvalAggregates)
    .where(and(
      eq(renderEvalAggregates.layoutVersionId, layoutVersionId),
      eq(renderEvalAggregates.projectId, owned.projectId),
      eq(renderEvalAggregates.geometryHash, owned.geometryHash),
    )).limit(1);
  return NextResponse.json({
    sampleCount: samples.length,
    evaluatedCount: samples.filter((sample) => sample.evaluatedAt).length,
    samples: samples.map((sample) => ({
      id: sample.id,
      sampleIndex: sample.sampleIndex,
      providerJobId: sample.providerJobId,
      geometryHash: sample.geometryHash,
      output: sample.output,
      evaluated: Boolean(sample.evaluatedAt),
      structuralPass: sample.structuralPass,
      aestheticPass: sample.aestheticPass,
      humanDisposition: sample.humanDisposition,
    })),
    aggregate: aggregate?.aggregate ?? null,
    releaseGatePassed: aggregate?.releaseGatePassed ?? false,
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ layoutVersionId: string }> }) {
  const user = await requireUser(request);
  if (!user) return errorResponse("Authentication is required.", 401, "AUTH_REQUIRED");
  const { layoutVersionId } = await context.params;
  const owned = await ownedLayout(layoutVersionId, user.id);
  if (!owned) return errorResponse("Study not found.", 404, "STUDY_NOT_FOUND");
  const parsed = ownerDispositionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse("Release-evaluation disposition is invalid.", 400, "INVALID_RENDER_EVAL_DISPOSITION");
  const [row] = await db.select().from(renderEvalSamples).where(and(
    eq(renderEvalSamples.id, parsed.data.sampleId),
    eq(renderEvalSamples.layoutVersionId, layoutVersionId),
    eq(renderEvalSamples.projectId, owned.projectId),
    eq(renderEvalSamples.geometryHash, owned.geometryHash),
  )).limit(1);
  if (!row) return errorResponse("Release-evaluation sample not found.", 404, "RENDER_EVAL_SAMPLE_NOT_FOUND");

  if (!row.evaluator || !row.structural || !row.aesthetic || row.structuralPass == null || row.aestheticPass == null || !row.evaluatedAt) {
    return errorResponse("An approved evaluator result is required before human disposition.", 409, "RENDER_EVAL_RESULT_REQUIRED");
  }
  const now = new Date();
  const humanDisposition = { reviewerId: user.id, disposition: parsed.data.disposition, note: parsed.data.note };
  const candidate = completeRecord({
    ...row,
    humanDisposition,
  }, humanDisposition);
  if (!candidate) return errorResponse("Stored render metadata failed integrity validation.", 409, "RENDER_EVAL_METADATA_INVALID");

  await db.update(renderEvalSamples).set({
    humanDisposition,
    updatedAt: now,
  }).where(and(eq(renderEvalSamples.id, row.id), eq(renderEvalSamples.geometryHash, owned.geometryHash)));

  const aggregate = await upsertAggregate(owned.projectId, layoutVersionId, owned.geometryHash, now);
  return NextResponse.json({ sample: candidate, aggregate });
}

/** Trusted evaluator-only rubric ingestion. Project owners cannot reach this path with a session. */
export async function PUT(request: Request, context: { params: Promise<{ layoutVersionId: string }> }) {
  if (!trustedEvaluatorTokenMatches(request.headers.get("authorization"), process.env.RENDER_EVAL_SERVICE_SECRET)) {
    return errorResponse("Trusted evaluator authorization is required.", 401, "EVALUATOR_AUTH_REQUIRED");
  }
  const evaluatorId = process.env.RENDER_EVAL_EVALUATOR_ID?.trim();
  if (!evaluatorId) return errorResponse("Trusted evaluator identity is not configured.", 503, "EVALUATOR_NOT_CONFIGURED");
  const { layoutVersionId } = await context.params;
  const canonical = await canonicalLayout(layoutVersionId);
  if (!canonical) return errorResponse("Study not found.", 404, "STUDY_NOT_FOUND");
  const parsed = evaluatorResultSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse("Evaluator result is invalid.", 400, "INVALID_RENDER_EVAL_RESULT");
  const [row] = await db.select().from(renderEvalSamples).where(and(
    eq(renderEvalSamples.id, parsed.data.sampleId),
    eq(renderEvalSamples.layoutVersionId, layoutVersionId),
    eq(renderEvalSamples.projectId, canonical.projectId),
    eq(renderEvalSamples.geometryHash, canonical.geometryHash),
  )).limit(1);
  if (!row) return errorResponse("Release-evaluation sample not found.", 404, "RENDER_EVAL_SAMPLE_NOT_FOUND");
  const result = deriveRenderEvalResult(parsed.data);
  const now = new Date();
  const evaluator = { kind: "approved_vision_evaluator" as const, id: evaluatorId, version: RENDER_EVAL_EVALUATOR_VERSION };
  await db.update(renderEvalSamples).set({
    evaluator,
    structural: parsed.data.structural,
    aesthetic: parsed.data.aesthetic,
    ...result,
    evaluatedAt: now,
    updatedAt: now,
  }).where(and(eq(renderEvalSamples.id, row.id), eq(renderEvalSamples.geometryHash, canonical.geometryHash)));
  const aggregate = await upsertAggregate(canonical.projectId, layoutVersionId, canonical.geometryHash, now);
  return NextResponse.json({ sampleId: row.id, ...result, aggregate });
}
