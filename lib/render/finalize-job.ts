import { and, eq, inArray } from "drizzle-orm";

import { readableBuildingSchema } from "@/lib/building/schema";
import { RENDER_EVAL_SAMPLE_COUNT } from "@/lib/building/v3-constants";
import { db } from "@/lib/db";
import { generatedAssets, generationJobs, layoutVersions, projects, renderEvalSamples } from "@/lib/db/schema";
import { CURRENT_PROMPT_VERSION } from "@/lib/render/current-prompts";
import { isSupportedRenderContractVersion } from "@/lib/render/dispatch";
import { isRenderPurpose } from "@/lib/render/prompts";
import { RENDER_EVAL_RUBRIC_VERSION } from "@/lib/render/release-eval";
import { cancelReplicatePrediction, getReplicatePrediction, predictionOutputs, providerStatus, safePredictionPayload, type ReplicatePrediction } from "@/lib/render/replicate";
import { compensateStoredAssets, settleAssetWrites, storeRemoteRender } from "@/lib/render/storage";
import { ACTIVE_GENERATION_STATUSES, emitLifecycleEvent, lockProjectLifecycle } from "@/lib/server/project-lifecycle";
import { recoverStaleDispatchClaim } from "@/lib/server/render-dispatch";

const ACTIVE_STATUSES = ACTIVE_GENERATION_STATUSES;

export function renderJobMatchesCanonical(payload: Record<string, unknown>, selectedSchemeId: string | null, geometryHash: string | null) {
  if (payload.schemeDisposition === "previous" || !geometryHash || payload.geometryHash !== geometryHash) return false;
  if (selectedSchemeId) return payload.schemeId === selectedSchemeId;
  return payload.schemeId == null;
}

export function nextReleaseEvalSampleIndex(existingIndices: readonly number[]) {
  const used = new Set(existingIndices);
  return Array.from({ length: RENDER_EVAL_SAMPLE_COUNT }, (_, index) => index + 1).find((candidate) => !used.has(candidate));
}

type ReleaseEvalReservationMetadata = {
  promptVersion: typeof CURRENT_PROMPT_VERSION;
  prompt: string;
  inputReferences: Array<{ role: string; storageKey: string; checksum: string }>;
  semanticCamera: Record<string, unknown> & { geometryHash: string; view: string; targetOpeningId?: string };
  geometryHash: string;
  providerModelVersion: string;
};

export function parseRenderJobMetadata(value: Record<string, unknown>) {
  // Keep accepting contract-v1 jobs that were already in flight during rollout.
  const purpose = isRenderPurpose(value.renderPurpose)
    ? value.renderPurpose
    : value.renderPurpose === "exterior" || value.renderPurpose === "interior"
      ? value.renderPurpose
      : null;
  const requestedOutputCount = Number(value.requestedOutputCount);
  if (!purpose || !Number.isInteger(requestedOutputCount) || requestedOutputCount < 1 || requestedOutputCount > 3) {
    throw new Error("Render job metadata is invalid");
  }
  if (value.renderContractVersion != null && value.renderContractVersion !== 1 && !isSupportedRenderContractVersion(value.renderContractVersion)) throw new Error("Render job metadata is invalid");
  let releaseEval: ReleaseEvalReservationMetadata | null = null;
  if (value.renderContractVersion === 3 && value.releaseEvalTarget === "gpt_image_2_designer_elevation") {
    const camera = value.semanticCamera;
    const lock = value.geometryLock;
    const references = value.inputReferences;
    if (purpose !== "exterior_front"
      || value.promptVersion !== CURRENT_PROMPT_VERSION
      || typeof value.prompt !== "string"
      || value.prompt.length < 100
      || typeof value.geometryHash !== "string"
      || typeof value.providerModelVersion !== "string"
      || !camera || typeof camera !== "object"
      || !lock || typeof lock !== "object"
      || !Array.isArray(references)) throw new Error("V3 render evaluation metadata is invalid");
    const semanticCamera = camera as ReleaseEvalReservationMetadata["semanticCamera"];
    const geometryLock = lock as { geometryHash?: unknown };
    const inputReferences = references as Array<Record<string, unknown>>;
    if (semanticCamera.geometryHash !== value.geometryHash
      || semanticCamera.view !== "primary_road_elevation"
      || !semanticCamera.targetOpeningId
      || geometryLock.geometryHash !== value.geometryHash
      || inputReferences.length !== 1
      || inputReferences.some((reference) => typeof reference.role !== "string" || typeof reference.storageKey !== "string" || typeof reference.checksum !== "string")) {
      throw new Error("V3 render evaluation geometry binding is invalid");
    }
    releaseEval = {
      promptVersion: CURRENT_PROMPT_VERSION,
      prompt: value.prompt,
      inputReferences: inputReferences as ReleaseEvalReservationMetadata["inputReferences"],
      semanticCamera,
      geometryHash: value.geometryHash,
      providerModelVersion: value.providerModelVersion,
    };
  }
  return { purpose, requestedOutputCount, releaseEval } as const;
}

async function failJob(jobId: string, message: string, payload?: Record<string, unknown>) {
  const now = new Date();
  await db.update(generationJobs).set({
    status: "failed",
    failureReason: message.slice(0, 1000),
    responsePayload: payload,
    completedAt: now,
    updatedAt: now,
  }).where(and(eq(generationJobs.id, jobId), inArray(generationJobs.status, [...ACTIVE_STATUSES])));
}

export async function applyReplicatePrediction(jobId: string, prediction: ReplicatePrediction) {
  const [row] = await db
    .select({
      job: generationJobs,
      projectId: layoutVersions.projectId,
      projectStatus: projects.status,
      selectedSchemeId: layoutVersions.selectedSchemeId,
      building: layoutVersions.layoutJson,
    })
    .from(generationJobs)
    .innerJoin(layoutVersions, eq(generationJobs.layoutVersionId, layoutVersions.id))
    .innerJoin(projects, eq(layoutVersions.projectId, projects.id))
    .where(eq(generationJobs.id, jobId))
    .limit(1);
  if (!row || row.job.provider !== "replicate") return;
  if (["completed", "failed", "canceled"].includes(row.job.status)) return;
  if (row.job.providerJobId && row.job.providerJobId !== prediction.id) return;
  if (row.projectStatus === "deleting") {
    if (prediction.status === "starting" || prediction.status === "processing") {
      try {
        const canceled = await cancelReplicatePrediction(prediction.id);
        if (canceled.prediction && (canceled.prediction.status === "starting" || canceled.prediction.status === "processing")) {
          await db.update(generationJobs).set({
            responsePayload: safePredictionPayload(canceled.prediction) as Record<string, unknown>,
            updatedAt: new Date(),
          }).where(and(eq(generationJobs.id, jobId), inArray(generationJobs.status, [...ACTIVE_STATUSES])));
          return;
        }
      } catch (error) {
        // Keep the job active so the durable deletion worker retries provider cancellation; never
        // make a still-running paid prediction disappear from quiescence accounting.
        emitLifecycleEvent("provider_cancel_retry_required", {
          projectId: row.projectId,
          generationJobId: jobId,
          providerJobId: prediction.id,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }
    const now = new Date();
    await db.update(generationJobs).set({
      status: "canceled",
      failureReason: "Render callback suppressed because project deletion started",
      completedAt: now,
      updatedAt: now,
    }).where(and(eq(generationJobs.id, jobId), inArray(generationJobs.status, [...ACTIVE_STATUSES])));
    emitLifecycleEvent("deleting_project_callback_suppressed", {
      projectId: row.projectId,
      generationJobId: jobId,
      providerJobId: prediction.id,
      providerStatus: prediction.status,
    });
    return;
  }
  const canonicalBuilding = readableBuildingSchema.safeParse(row.building);
  const canonicalGeometryHash = canonicalBuilding.success ? canonicalBuilding.data.candidate.geometryHash : null;
  if (!renderJobMatchesCanonical(row.job.requestPayload, row.selectedSchemeId, canonicalGeometryHash)) {
    await failJob(jobId, "Render source no longer matches the selected canonical scheme");
    return;
  }

  const normalized = providerStatus(prediction.status);
  const safePayload = safePredictionPayload(prediction) as Record<string, unknown>;
  const now = new Date();
  if (normalized === "processing") {
    if (row.job.status === "finalizing") return;
    await db.update(generationJobs).set({ status: "processing", responsePayload: safePayload, startedAt: row.job.startedAt ?? now, updatedAt: now })
      .where(and(eq(generationJobs.id, jobId), inArray(generationJobs.status, [...ACTIVE_STATUSES])));
    return;
  }
  if (normalized === "failed" || normalized === "canceled") {
    await db.update(generationJobs).set({
      status: normalized,
      responsePayload: safePayload,
      failureReason: normalized === "failed" ? String(prediction.error ?? "Replicate failed") : "Replicate canceled the job",
      completedAt: now,
      updatedAt: now,
    }).where(and(eq(generationJobs.id, jobId), inArray(generationJobs.status, [...ACTIVE_STATUSES])));
    return;
  }

  let metadata: ReturnType<typeof parseRenderJobMetadata>;
  try {
    metadata = parseRenderJobMetadata(row.job.requestPayload);
  } catch (error) {
    await failJob(jobId, error instanceof Error ? error.message : "Render job metadata is invalid", safePayload);
    return;
  }
  const outputs = predictionOutputs(prediction);
  if (outputs.length !== metadata.requestedOutputCount) {
    await failJob(jobId, `Replicate returned ${outputs.length} of ${metadata.requestedOutputCount} expected images`, safePayload);
    return;
  }

  const storageKeys = outputs.map((_, index) => (
    `renders/${row.job.layoutVersionId}/${row.job.id}/${metadata.purpose}-${index + 1}.webp`
  ));
  try {
    await db.transaction(async (transaction) => {
      await lockProjectLifecycle(transaction, row.projectId);
      const [project] = await transaction.select({ status: projects.status }).from(projects)
        .where(eq(projects.id, row.projectId)).limit(1);
      if (!project || project.status === "deleting") throw new Error("PROJECT_DELETING");
      const finalizingStartedAt = row.job.finalizingStartedAt ?? now;
      await transaction.update(generationJobs).set({
        status: "finalizing",
        finalizingStartedAt,
        responsePayload: safePayload,
        updatedAt: now,
      }).where(and(eq(generationJobs.id, jobId), inArray(generationJobs.status, [...ACTIVE_STATUSES])));
      for (const storageKey of storageKeys) {
        await transaction.insert(generatedAssets).values({
          projectId: row.projectId,
          layoutVersionId: row.job.layoutVersionId,
          type: "render",
          role: metadata.purpose,
          provider: "replicate",
          status: "finalizing",
          providerJobId: prediction.id,
          storageKey,
          url: `/api/assets/${storageKey.split("/").map(encodeURIComponent).join("/")}`,
          contentType: "application/octet-stream",
        }).onConflictDoNothing();
      }
    });
  } catch (error) {
    await failJob(jobId, error instanceof Error && error.message === "PROJECT_DELETING"
      ? "Render callback suppressed because project deletion started"
      : `Unable to reserve the durable output manifest: ${error instanceof Error ? error.message : "unknown error"}`, safePayload);
    return;
  }

  const writes = await settleAssetWrites(outputs.map((url, index) => () => storeRemoteRender(url, storageKeys[index])));
  if (writes.failures.length > 0) {
    const compensation = await compensateStoredAssets(writes.stored.map((item) => item.value));
    if (compensation.failed.length > 0) emitLifecycleEvent("storage_compensation_failure", {
      projectId: row.projectId,
      generationJobId: jobId,
      failedObjectCount: compensation.failed.length,
    });
    await failJob(jobId, `Durable render storage failed for ${writes.failures.length} output(s)`, safePayload);
    await db.update(generatedAssets).set({ status: "failed" }).where(and(
      eq(generatedAssets.providerJobId, prediction.id),
      eq(generatedAssets.status, "finalizing"),
    ));
    return;
  }

  try {
    await db.transaction(async (transaction) => {
      await lockProjectLifecycle(transaction, row.projectId);
      const [project] = await transaction.select({ status: projects.status }).from(projects)
        .where(eq(projects.id, row.projectId)).limit(1);
      if (!project || project.status === "deleting") throw new Error("PROJECT_DELETING_AFTER_UPLOAD");
      for (const { value: asset } of writes.stored) {
        await transaction.update(generatedAssets).set({
          status: "completed",
          url: asset.url,
          contentType: asset.contentType,
        }).where(eq(generatedAssets.storageKey, asset.storageKey));
      }
      await transaction.update(generationJobs).set({
        status: "completed",
        responsePayload: safePayload,
        failureReason: null,
        finalizingStartedAt: null,
        completedAt: now,
        updatedAt: now,
      }).where(and(eq(generationJobs.id, jobId), eq(generationJobs.status, "finalizing")));
      if (metadata.releaseEval) {
        const existing = await transaction.select({ sampleIndex: renderEvalSamples.sampleIndex }).from(renderEvalSamples)
          .where(and(
            eq(renderEvalSamples.layoutVersionId, row.job.layoutVersionId),
            eq(renderEvalSamples.geometryHash, metadata.releaseEval.geometryHash),
          ));
        const sampleIndex = nextReleaseEvalSampleIndex(existing.map((sample) => sample.sampleIndex));
        const output = writes.stored[0]?.value;
        if (sampleIndex && output) await transaction.insert(renderEvalSamples).values({
          projectId: row.projectId,
          layoutVersionId: row.job.layoutVersionId,
          generationJobId: row.job.id,
          sampleIndex,
          providerJobId: prediction.id,
          provider: row.job.provider,
          modelVersion: metadata.releaseEval.providerModelVersion,
          promptVersion: metadata.releaseEval.promptVersion,
          prompt: metadata.releaseEval.prompt,
          inputReferences: metadata.releaseEval.inputReferences,
          semanticCamera: metadata.releaseEval.semanticCamera,
          geometryHash: metadata.releaseEval.geometryHash,
          output: { storageKey: output.storageKey, contentType: output.contentType, checksum: output.checksum },
          rubricVersion: RENDER_EVAL_RUBRIC_VERSION,
          updatedAt: now,
        }).onConflictDoNothing();
      }
    });
  } catch (error) {
    const compensation = await compensateStoredAssets(writes.stored.map((item) => item.value));
    if (compensation.failed.length > 0) emitLifecycleEvent("storage_compensation_failure", {
      projectId: row.projectId,
      generationJobId: jobId,
      failedObjectCount: compensation.failed.length,
    });
    await failJob(jobId, `Post-upload finalization failed: ${error instanceof Error ? error.message : "unknown error"}`, safePayload);
  }
}

export async function reconcileReplicateJob(jobId: string) {
  const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId)).limit(1);
  if (!job || job.provider !== "replicate" || ["completed", "failed", "canceled"].includes(job.status)) return;
  if (!job.providerJobId) {
    await recoverStaleDispatchClaim(job.id);
    return;
  }
  const prediction = await getReplicatePrediction(job.providerJobId);
  await applyReplicatePrediction(job.id, prediction);
}
