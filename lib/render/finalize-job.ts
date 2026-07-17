import { and, eq, inArray } from "drizzle-orm";

import { buildingSchema } from "@/lib/building/schema";
import { db } from "@/lib/db";
import { generatedAssets, generationJobs, layoutVersions } from "@/lib/db/schema";
import { isRenderPurpose } from "@/lib/render/prompts";
import { getReplicatePrediction, predictionOutputs, providerStatus, safePredictionPayload, type ReplicatePrediction } from "@/lib/render/replicate";
import { storeRemoteRender } from "@/lib/render/storage";

const ACTIVE_STATUSES = ["queued", "processing"] as const;

export function renderJobMatchesCanonical(payload: Record<string, unknown>, selectedSchemeId: string | null, geometryHash: string | null) {
  if (payload.schemeDisposition === "previous" || !geometryHash || payload.geometryHash !== geometryHash) return false;
  if (selectedSchemeId) return payload.schemeId === selectedSchemeId;
  return payload.schemeId == null;
}

function requestMetadata(value: Record<string, unknown>) {
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
  return { purpose, requestedOutputCount } as const;
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
      selectedSchemeId: layoutVersions.selectedSchemeId,
      building: layoutVersions.layoutJson,
    })
    .from(generationJobs)
    .innerJoin(layoutVersions, eq(generationJobs.layoutVersionId, layoutVersions.id))
    .where(eq(generationJobs.id, jobId))
    .limit(1);
  if (!row || row.job.provider !== "replicate") return;
  if (["completed", "failed", "canceled"].includes(row.job.status)) return;
  if (row.job.providerJobId && row.job.providerJobId !== prediction.id) return;
  const canonicalBuilding = buildingSchema.safeParse(row.building);
  const canonicalGeometryHash = canonicalBuilding.success ? canonicalBuilding.data.candidate.geometryHash : null;
  if (!renderJobMatchesCanonical(row.job.requestPayload, row.selectedSchemeId, canonicalGeometryHash)) {
    await failJob(jobId, "Render source no longer matches the selected canonical scheme");
    return;
  }

  const normalized = providerStatus(prediction.status);
  const safePayload = safePredictionPayload(prediction) as Record<string, unknown>;
  const now = new Date();
  if (normalized === "processing") {
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

  let metadata: ReturnType<typeof requestMetadata>;
  try {
    metadata = requestMetadata(row.job.requestPayload);
  } catch (error) {
    await failJob(jobId, error instanceof Error ? error.message : "Render job metadata is invalid", safePayload);
    return;
  }
  const outputs = predictionOutputs(prediction);
  if (outputs.length !== metadata.requestedOutputCount) {
    await failJob(jobId, `Replicate returned ${outputs.length} of ${metadata.requestedOutputCount} expected images`, safePayload);
    return;
  }

  try {
    const stored = await Promise.all(outputs.map((url, index) => storeRemoteRender(
      url,
      `renders/${row.job.layoutVersionId}/${row.job.id}/${metadata.purpose}-${index + 1}.webp`,
    )));
    await db.transaction(async (transaction) => {
      for (const asset of stored) {
        await transaction.insert(generatedAssets).values({
          projectId: row.projectId,
          layoutVersionId: row.job.layoutVersionId,
          type: "render",
          role: metadata.purpose,
          provider: "replicate",
          status: "completed",
          providerJobId: prediction.id,
          storageKey: asset.storageKey,
          url: asset.url,
          contentType: asset.contentType,
        }).onConflictDoNothing();
      }
      await transaction.update(generationJobs).set({
        status: "completed",
        responsePayload: safePayload,
        failureReason: null,
        completedAt: now,
        updatedAt: now,
      }).where(and(eq(generationJobs.id, jobId), inArray(generationJobs.status, [...ACTIVE_STATUSES])));
    });
  } catch (error) {
    await failJob(jobId, `Durable render storage failed: ${error instanceof Error ? error.message : "unknown error"}`, safePayload);
  }
}

export async function reconcileReplicateJob(jobId: string) {
  const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId)).limit(1);
  if (!job || job.provider !== "replicate" || !job.providerJobId || ["completed", "failed", "canceled"].includes(job.status)) return;
  const prediction = await getReplicatePrediction(job.providerJobId);
  await applyReplicatePrediction(job.id, prediction);
}
