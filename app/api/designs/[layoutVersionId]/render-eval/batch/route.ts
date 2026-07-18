import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { trustedEvaluatorTokenMatches } from "@/app/api/designs/[layoutVersionId]/render-eval/route";
import { readableBuildingRequirementsSchema } from "@/lib/building/requirements";
import { readableBuildingSchema } from "@/lib/building/schema";
import { RENDER_EVAL_SAMPLE_COUNT } from "@/lib/building/v3-constants";
import { db } from "@/lib/db";
import { generationJobs, layoutVersions, projectRequirements, projects, renderEvalSamples } from "@/lib/db/schema";
import { CURRENT_PROMPT_VERSION, type CurrentRenderSpec } from "@/lib/render/current-prompts";
import { dispatchRenderSpecs, renderEligibleInteriorSpace } from "@/lib/render/dispatch";
import { applyReplicatePrediction } from "@/lib/render/finalize-job";
import { claimAndArmProviderDispatch, createAndAttachProviderPrediction, ProviderAcceptedBeforeAttachError } from "@/lib/render/provider-dispatch";
import { cancelReplicatePrediction, createReplicatePrediction, ReplicateCreateAmbiguousError, replicateModelVersion, replicateWebhookUrl } from "@/lib/render/replicate";
import { readStoredAsset } from "@/lib/render/storage";
import { ACTIVE_GENERATION_STATUSES, lockProjectLifecycle } from "@/lib/server/project-lifecycle";
import { armProviderDispatch, attachProviderPredictionByDispatchToken, claimProviderDispatch, drainStaleDispatchClaims } from "@/lib/server/render-dispatch";

const requestSchema = z.object({ geometryHash: z.string().min(1).max(200) }).strict();

function errorResponse(message: string, status: number, code: string) {
  return NextResponse.json({ error: message, code }, { status });
}

export function releaseEvalBatchReservationCount(input: { sampleJobIds: readonly string[]; jobs: readonly { id: string; status: string }[] }) {
  const sampled = new Set(input.sampleJobIds);
  const outstanding = input.jobs.filter((job) => !sampled.has(job.id) && ACTIVE_GENERATION_STATUSES.includes(job.status as typeof ACTIVE_GENERATION_STATUSES[number])).length;
  return Math.max(0, RENDER_EVAL_SAMPLE_COUNT - sampled.size - outstanding);
}

function currentPrimarySpec(value: unknown): value is CurrentRenderSpec {
  return Boolean(value && typeof value === "object" && "promptVersion" in value
    && value.promptVersion === CURRENT_PROMPT_VERSION
    && "releaseEvalTarget" in value
    && value.releaseEvalTarget === "gpt_image_2_designer_elevation");
}

export async function POST(request: Request, context: { params: Promise<{ layoutVersionId: string }> }) {
  if (!trustedEvaluatorTokenMatches(request.headers.get("authorization"), process.env.RENDER_EVAL_SERVICE_SECRET)) {
    return errorResponse("Trusted evaluator authorization is required.", 401, "EVALUATOR_AUTH_REQUIRED");
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse("Canonical geometry confirmation is required.", 400, "INVALID_RELEASE_EVAL_BATCH");
  const { layoutVersionId } = await context.params;
  const [row] = await db.select({
    projectId: projects.id,
    projectStatus: projects.status,
    building: layoutVersions.layoutJson,
    selectedSchemeId: layoutVersions.selectedSchemeId,
    requirements: projectRequirements.inputJson,
  }).from(layoutVersions)
    .innerJoin(projects, eq(layoutVersions.projectId, projects.id))
    .innerJoin(projectRequirements, eq(layoutVersions.requirementVersionId, projectRequirements.id))
    .where(eq(layoutVersions.id, layoutVersionId)).limit(1);
  if (!row || row.projectStatus !== "ready") return errorResponse("Study not found or not ready.", 404, "STUDY_NOT_READY");
  const building = readableBuildingSchema.safeParse(row.building);
  const requirements = readableBuildingRequirementsSchema.safeParse(row.requirements);
  if (!building.success || building.data.buildingSchemaVersion !== 3 || !requirements.success || requirements.data.requirementSchemaVersion !== 3) {
    return errorResponse("Release evaluation requires a current v3 study.", 409, "RELEASE_EVAL_REQUIRES_V3");
  }
  if (building.data.candidate.geometryHash !== parsed.data.geometryHash) return errorResponse("The canonical geometry changed.", 409, "STALE_GEOMETRY");
  await drainStaleDispatchClaims(layoutVersionId);
  const interior = building.data.floors.flatMap((floor) => floor.spaces)
    .find((space) => Boolean(renderEligibleInteriorSpace(building.data, space.id)));
  if (!interior) return errorResponse("No eligible interior space is available.", 409, "INVALID_INTERIOR_SPACE");
  const dispatch = dispatchRenderSpecs({ building: building.data, requirements: requirements.data, selectedInteriorSpaceId: interior.id });
  const spec = dispatch.specs.find((candidate) => currentPrimarySpec(candidate));
  if (!spec || !currentPrimarySpec(spec)) return errorResponse("Primary release-evaluation render is unavailable.", 409, "RELEASE_EVAL_SPEC_UNAVAILABLE");

  const existingRenderJobs = await db.select().from(generationJobs).where(and(
    eq(generationJobs.layoutVersionId, layoutVersionId),
    eq(generationJobs.kind, "render"),
  ));
  const sourceJob = existingRenderJobs.find((job) => (
    job.requestPayload.geometryHash === parsed.data.geometryHash
    && job.requestPayload.renderPurpose === "exterior_front"
    && job.requestPayload.schemeDisposition !== "previous"
    && Array.isArray(job.requestPayload.inputReferences)
  ));
  const sourceReference = Array.isArray(sourceJob?.requestPayload.inputReferences)
    ? sourceJob.requestPayload.inputReferences.find((item) => item && typeof item === "object" && "role" in item && item.role === "massing_front")
    : null;
  if (!sourceReference || typeof sourceReference !== "object" || !("storageKey" in sourceReference) || typeof sourceReference.storageKey !== "string"
    || !("checksum" in sourceReference) || typeof sourceReference.checksum !== "string") {
    return errorResponse("Capture a canonical render reference package before starting release evaluation.", 409, "RELEASE_EVAL_SOURCE_REQUIRED");
  }
  const storedSource = await readStoredAsset(sourceReference.storageKey).catch(() => null);
  if (!storedSource || !new Set(["image/png", "image/jpeg", "image/webp"]).has(storedSource.contentType)) {
    return errorResponse("The canonical release-evaluation source is unavailable.", 409, "RELEASE_EVAL_SOURCE_UNAVAILABLE");
  }
  const dataUri = `data:${storedSource.contentType};base64,${Buffer.from(storedSource.bytes).toString("base64")}`;

  const reserved = await db.transaction(async (transaction) => {
    await lockProjectLifecycle(transaction, row.projectId);
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`brickpilot:render-contract:${layoutVersionId}`}, 0))`);
    const [current] = await transaction.select({ status: projects.status, building: layoutVersions.layoutJson, selectedSchemeId: layoutVersions.selectedSchemeId })
      .from(layoutVersions).innerJoin(projects, eq(layoutVersions.projectId, projects.id))
      .where(eq(layoutVersions.id, layoutVersionId)).limit(1);
    const currentBuilding = readableBuildingSchema.safeParse(current?.building);
    if (!current || current.status !== "ready" || !currentBuilding.success || currentBuilding.data.candidate.geometryHash !== parsed.data.geometryHash) {
      throw new Error("STALE_GEOMETRY");
    }
    const samples = await transaction.select({ generationJobId: renderEvalSamples.generationJobId }).from(renderEvalSamples).where(and(
      eq(renderEvalSamples.layoutVersionId, layoutVersionId),
      eq(renderEvalSamples.geometryHash, parsed.data.geometryHash),
    ));
    const allJobs = await transaction.select().from(generationJobs).where(and(
      eq(generationJobs.layoutVersionId, layoutVersionId),
      eq(generationJobs.kind, "render"),
    ));
    const batchJobs = allJobs.filter((job) => job.requestPayload.releaseEvalBatch === true && job.requestPayload.geometryHash === parsed.data.geometryHash);
    const needed = releaseEvalBatchReservationCount({ sampleJobIds: samples.map((sample) => sample.generationJobId), jobs: batchJobs });
    const packageId = crypto.randomUUID();
    const jobs: Array<typeof generationJobs.$inferSelect> = batchJobs.filter((job) => (
      job.status === "queued" && job.dispatchState === "reserved" && Boolean(job.dispatchToken) && !job.providerJobId
    ));
    for (let index = 0; index < needed; index += 1) {
      const dispatchToken = crypto.randomUUID();
      const [job] = await transaction.insert(generationJobs).values({
        layoutVersionId,
        kind: "render",
        provider: "replicate",
        dispatchToken,
        dispatchState: "reserved",
        idempotencyKey: `render-eval:${layoutVersionId}:${parsed.data.geometryHash}:${packageId}:${index + 1}`,
        status: "queued",
        requestPayload: {
          packageId,
          releaseEvalBatch: true,
          renderContractVersion: 3,
          renderPurpose: spec.purpose,
          requestedOutputCount: 1,
          geometryHash: parsed.data.geometryHash,
          schemeId: current.selectedSchemeId ?? undefined,
          selectedInteriorSpaceId: interior.id,
          referenceRoles: [spec.sourceRole],
          prompt: spec.prompt,
          buildingSchemaVersion: 3,
          providerModelVersion: replicateModelVersion(),
          promptVersion: spec.promptVersion,
          semanticView: spec.semanticView,
          semanticCamera: spec.semanticCamera,
          geometryLock: spec.geometryLock,
          releaseEvalTarget: spec.releaseEvalTarget,
          inputReferences: [{ role: "massing_front", storageKey: sourceReference.storageKey, checksum: sourceReference.checksum }],
        },
        updatedAt: new Date(),
      }).returning();
      jobs.push(job);
    }
    return { jobs, needed, existingSamples: samples.length, outstanding: batchJobs.filter((job) => ACTIVE_GENERATION_STATUSES.includes(job.status as typeof ACTIVE_GENERATION_STATUSES[number])).length };
  }).catch((error) => {
    if (error instanceof Error && error.message === "STALE_GEOMETRY") return null;
    throw error;
  });
  if (!reserved) return errorResponse("The canonical geometry changed.", 409, "STALE_GEOMETRY");

  for (const job of reserved.jobs) {
    try {
      const armed = await claimAndArmProviderDispatch({
        claim: () => claimProviderDispatch(row.projectId, job.id),
        arm: (claim) => claim.leaseToken
          ? armProviderDispatch(row.projectId, job.id, claim.leaseToken)
          : Promise.resolve(null),
      });
      if (!armed?.dispatchToken) continue;
      const prediction = await createAndAttachProviderPrediction({
        create: () => createReplicatePrediction(spec, [dataUri], { dispatchToken: armed.dispatchToken! }),
        attach: async (created) => {
          const attached = await attachProviderPredictionByDispatchToken(armed.dispatchToken!, created);
          if (!attached?.attached) throw new Error("PROVIDER_DISPATCH_ATTACHMENT_REJECTED");
        },
      });
      await applyReplicatePrediction(job.id, prediction);
    } catch (error) {
      if (error instanceof ProviderAcceptedBeforeAttachError) {
        if (job.dispatchToken && !replicateWebhookUrl(job.dispatchToken)) {
          const canceled = await cancelReplicatePrediction(error.prediction.id).catch(() => null);
          const terminal = canceled?.prediction ?? { ...error.prediction, status: "canceled" as const, output: null };
          await attachProviderPredictionByDispatchToken(job.dispatchToken, terminal).catch(() => null);
          await applyReplicatePrediction(job.id, terminal).catch(() => null);
        }
        continue;
      }
      if (error instanceof ReplicateCreateAmbiguousError && job.dispatchToken && replicateWebhookUrl(job.dispatchToken)) continue;
      const now = new Date();
      await db.update(generationJobs).set({
        status: "failed",
        dispatchState: "failed",
        dispatchLeaseToken: null,
        dispatchLeaseAcquiredAt: null,
        failureReason: error instanceof Error ? error.message : "Release-eval dispatch failed",
        completedAt: now,
        updatedAt: now,
      })
        .where(and(eq(generationJobs.id, job.id), inArray(generationJobs.status, [...ACTIVE_GENERATION_STATUSES])));
    }
  }
  return NextResponse.json({ reserved: reserved.needed, existingSamples: reserved.existingSamples, jobs: reserved.jobs.map((job) => job.id) }, { status: 202 });
}
