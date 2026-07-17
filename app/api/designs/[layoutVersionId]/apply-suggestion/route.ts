import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { applyRequirementDelta, InvalidRequirementDeltaError } from "@/lib/ai/apply-delta";
import { architecturalReviewResultSchema } from "@/lib/ai/schema";
import { requireUser } from "@/lib/auth";
import { buildingRequirementsSchema } from "@/lib/building/requirements";
import { db } from "@/lib/db";
import { generationJobs, layoutVersions, projectRequirements, projects } from "@/lib/db/schema";
import { runDesignPipeline } from "@/lib/server/design-pipeline";

const MAX_AI_DELTA_VERSIONS = 3;

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status });
}

function jsonRecord(value: unknown) {
  return value as Record<string, unknown>;
}

function serverSeed() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0];
}

export function markRenderPayloadForRevision(payload: Record<string, unknown>, nextLayoutVersionId: string): Record<string, unknown> {
  return {
    ...payload,
    schemeDisposition: "previous",
    supersededByLayoutVersionId: nextLayoutVersionId,
  };
}

export async function POST(request: Request, context: { params: Promise<{ layoutVersionId: string }> }) {
  const user = await requireUser(request);
  if (!user) return errorResponse("Authentication is required.", 401, "AUTH_REQUIRED");

  const { layoutVersionId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400, "INVALID_JSON");
  }
  const deltaIndex = body && typeof body === "object" && "deltaIndex" in body
    ? Number((body as { deltaIndex: unknown }).deltaIndex)
    : Number.NaN;
  if (!Number.isInteger(deltaIndex) || deltaIndex < 0) return errorResponse("deltaIndex must be a non-negative integer.", 400, "INVALID_DELTA_INDEX");

  const [row] = await db
    .select({
      status: layoutVersions.status,
      version: layoutVersions.version,
      aiReview: layoutVersions.aiReview,
      projectId: projects.id,
      title: projects.title,
      requirements: projectRequirements.inputJson,
    })
    .from(layoutVersions)
    .innerJoin(projects, eq(layoutVersions.projectId, projects.id))
    .innerJoin(projectRequirements, eq(layoutVersions.requirementVersionId, projectRequirements.id))
    .where(and(eq(layoutVersions.id, layoutVersionId), eq(projects.ownerId, user.id)));
  if (!row) return errorResponse("Study not found.", 404, "STUDY_NOT_FOUND");
  if (row.status !== "completed") return errorResponse("This study version is not completed yet.", 409, "STUDY_NOT_COMPLETED");

  const [{ latestVersion: latestVersionBeforePipeline }] = await db
    .select({ latestVersion: sql<number>`coalesce(max(${layoutVersions.version}), 0)::integer` })
    .from(layoutVersions)
    .where(eq(layoutVersions.projectId, row.projectId));
  if (Number(latestVersionBeforePipeline) !== row.version) {
    return errorResponse("This suggestion belongs to an older study version. Open the latest version before applying another change.", 409, "STALE_STUDY_VERSION");
  }

  const parsedReview = architecturalReviewResultSchema.safeParse(row.aiReview);
  const delta = parsedReview.success && parsedReview.data.status === "reviewed"
    ? parsedReview.data.review.requirementDeltas[deltaIndex]
    : undefined;
  if (!delta) return errorResponse("No AI suggestion exists at that index for this study.", 404, "SUGGESTION_NOT_FOUND");

  const priorRequirements = buildingRequirementsSchema.safeParse(row.requirements);
  if (!priorRequirements.success) return errorResponse("The source requirements are incompatible with this application version.", 409, "INCOMPATIBLE_REQUIREMENTS");

  let nextRequirements;
  try {
    nextRequirements = {
      ...applyRequirementDelta(priorRequirements.data, delta),
      seed: serverSeed(),
    };
  } catch (error) {
    if (error instanceof InvalidRequirementDeltaError) return errorResponse(error.message, 422, "INVALID_SUGGESTION");
    throw error;
  }

  const [{ existingAiDeltaCount }] = await db
    .select({ existingAiDeltaCount: sql<number>`count(*)::integer` })
    .from(projectRequirements)
    .where(and(eq(projectRequirements.projectId, row.projectId), eq(projectRequirements.source, "ai_delta")));
  if (Number(existingAiDeltaCount) >= MAX_AI_DELTA_VERSIONS) {
    return errorResponse("This study has reached its limit of AI-informed revisions.", 409, "AI_DELTA_LIMIT_REACHED");
  }

  const pipelineResult = await runDesignPipeline(nextRequirements);
  if (pipelineResult.status === "failed") return errorResponse(pipelineResult.message, 422, pipelineResult.code);

  const now = new Date();
  let transactionResult;
  try {
    transactionResult = await db.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`brickpilot:render-contract:${layoutVersionId}`}, 0))`);
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`brickpilot:ai-delta:${row.projectId}`}, 0))`);
      const [{ latestVersion }] = await transaction
        .select({ latestVersion: sql<number>`coalesce(max(${layoutVersions.version}), 0)::integer` })
        .from(layoutVersions)
        .where(eq(layoutVersions.projectId, row.projectId));
      if (Number(latestVersion) !== row.version) return { status: "stale" as const };
      const [{ aiDeltaCount }] = await transaction
        .select({ aiDeltaCount: sql<number>`count(*)::integer` })
        .from(projectRequirements)
        .where(and(eq(projectRequirements.projectId, row.projectId), eq(projectRequirements.source, "ai_delta")));
      if (Number(aiDeltaCount) >= MAX_AI_DELTA_VERSIONS) return { status: "limit" as const };
      const priorRenderJobs = await transaction.select().from(generationJobs)
        .where(and(eq(generationJobs.layoutVersionId, layoutVersionId), eq(generationJobs.kind, "render")));
      if (priorRenderJobs.some((job) => job.status === "queued" || job.status === "processing")) return { status: "render_conflict" as const };

      const nextVersion = Number(latestVersion) + 1;
      const [requirement] = await transaction.insert(projectRequirements).values({
        projectId: row.projectId,
        version: nextVersion,
        inputJson: jsonRecord(nextRequirements),
        source: "ai_delta",
        editPrompt: delta.summary,
        updatedAt: now,
      }).returning();
      const [layout] = await transaction.insert(layoutVersions).values({
        projectId: row.projectId,
        requirementVersionId: requirement.id,
        version: nextVersion,
        prompt: `AI-informed revision: ${delta.summary}`,
        status: "completed",
        intent: jsonRecord(pipelineResult.intent),
        layoutJson: jsonRecord(pipelineResult.building),
        validation: jsonRecord(pipelineResult.validation),
        costEstimate: jsonRecord(pipelineResult.costEstimate),
        aiReview: jsonRecord(pipelineResult.aiReview),
        schemes: pipelineResult.schemes.map(jsonRecord),
        selectedSchemeId: pipelineResult.selectedSchemeId,
        updatedAt: now,
      }).returning();
      for (const job of priorRenderJobs) {
        await transaction.update(generationJobs).set({
          requestPayload: markRenderPayloadForRevision(job.requestPayload, layout.id),
          updatedAt: now,
        }).where(eq(generationJobs.id, job.id));
      }
      await transaction.update(projects).set({ status: "ready", updatedAt: now }).where(eq(projects.id, row.projectId));
      return { status: "created" as const, layout };
    });
  } catch (error) {
    console.error("AI-informed revision save failed", error);
    return errorResponse("Unable to save this revision safely.", 500, "REVISION_SAVE_FAILED");
  }
  if (transactionResult.status === "stale") return errorResponse("This suggestion was already applied or belongs to an older study version.", 409, "STALE_STUDY_VERSION");
  if (transactionResult.status === "limit") return errorResponse("This study has reached its limit of AI-informed revisions.", 409, "AI_DELTA_LIMIT_REACHED");
  if (transactionResult.status === "render_conflict") return errorResponse("Wait for the active render package to finish before creating a revised scheme set.", 409, "ACTIVE_RENDER_CONFLICT");

  return NextResponse.json({
    projectId: row.projectId,
    designId: transactionResult.layout.id,
    version: transactionResult.layout.version,
    title: row.title,
    requirements: nextRequirements,
    building: pipelineResult.building,
    validation: pipelineResult.validation,
    costEstimate: pipelineResult.costEstimate,
    intent: pipelineResult.intent,
    aiReview: pipelineResult.aiReview,
    schemes: pipelineResult.schemes,
    selectedSchemeId: pipelineResult.selectedSchemeId,
    diagnostics: pipelineResult.diagnostics,
  }, { status: 201 });
}
