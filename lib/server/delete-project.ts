import { createHash } from "node:crypto";

import { and, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  generatedAssets,
  generationJobs,
  layoutVersions,
  projectDeletionJobs,
  projects,
} from "@/lib/db/schema";
import { applyReplicatePrediction, reconcileReplicateJob } from "@/lib/render/finalize-job";
import { cancelReplicatePrediction } from "@/lib/render/replicate";
import { deleteStoredAssetsExact } from "@/lib/render/storage";
import {
  ACTIVE_GENERATION_STATUSES,
  emitLifecycleEvent,
  isFinalizingLeaseStale,
  lockProjectLifecycle,
} from "@/lib/server/project-lifecycle";
import { resolveProjectCapabilities } from "@/lib/server/project-capabilities";
import { recoverStaleDispatchClaim } from "@/lib/server/render-dispatch";

const EXECUTION_LEASE_MS = 2 * 60 * 1_000;
const SOURCE_ROLES = new Set(["plan_reference", "massing_front", "massing_collage", "massing_top"]);

export type ProjectDeletionJob = typeof projectDeletionJobs.$inferSelect;

export type DeletionRequestResult =
  | { status: "not_found" }
  | { status: "confirmation_mismatch" }
  | { status: "not_deletable" }
  | { status: "accepted"; job: ProjectDeletionJob }
  | { status: "existing"; job: ProjectDeletionJob };

function safeBinding(value: unknown) {
  return String(value ?? "unknown").replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function candidateAssetKeysForRenderJob(job: {
  id: string;
  layoutVersionId: string;
  requestPayload: Record<string, unknown>;
}) {
  const keys: string[] = [];
  const payload = job.requestPayload;
  const purpose = typeof payload.renderPurpose === "string" ? safeBinding(payload.renderPurpose) : null;
  const requestedOutputCount = Number(payload.requestedOutputCount);
  if (purpose && Number.isInteger(requestedOutputCount) && requestedOutputCount >= 1 && requestedOutputCount <= 3) {
    for (let index = 1; index <= requestedOutputCount; index += 1) {
      keys.push(`renders/${job.layoutVersionId}/${job.id}/${purpose}-${index}.webp`);
    }
  }
  const packageId = typeof payload.packageId === "string" ? safeBinding(payload.packageId) : null;
  // Every accepted package contains the complete canonical four-reference set. Historical jobs
  // recorded only the role consumed by that purpose, so derive all exact package members.
  const roles = packageId ? [...SOURCE_ROLES] : [];
  if (packageId) {
    const binding = payload.schemeId
      ? safeBinding(payload.schemeId)
      : `legacy-${safeBinding(payload.geometryHash)}`;
    for (const role of roles) keys.push(`sources/${job.layoutVersionId}/${binding}/${packageId}/${role}.webp`);
    // Exact legacy package paths created before scheme-bound source storage.
    if (payload.schemeId == null) {
      for (const role of roles) keys.push(`sources/${job.layoutVersionId}/${packageId}/${role}.webp`);
    }
  }
  return keys;
}

export function buildExactDeletionManifest(
  assetKeys: readonly string[],
  renderJobs: readonly Parameters<typeof candidateAssetKeysForRenderJob>[0][],
) {
  return [...new Set([
    ...assetKeys,
    ...renderJobs.flatMap(candidateAssetKeysForRenderJob),
  ])].sort();
}

export function confirmationDigest(projectId: string, ownerId: string, title: string) {
  return createHash("sha256").update(`${projectId}\0${ownerId}\0${title}`).digest("hex");
}

export function publicDeletionJob(job: ProjectDeletionJob) {
  return {
    id: job.id,
    originalProjectId: job.originalProjectId,
    state: job.state,
    attemptCount: job.attemptCount,
    lastError: job.lastError,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export async function requestProjectDeletion(
  projectId: string,
  ownerId: string,
  confirmedTitle: string,
): Promise<DeletionRequestResult> {
  return db.transaction(async (transaction) => {
    await lockProjectLifecycle(transaction, projectId);
    const [project] = await transaction.select().from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)))
      .limit(1);
    if (!project) return { status: "not_found" as const };
    const [existing] = await transaction.select().from(projectDeletionJobs)
      .where(eq(projectDeletionJobs.originalProjectId, projectId))
      .limit(1);
    if (existing) return { status: "existing" as const, job: existing };
    if (confirmedTitle !== project.title) return { status: "confirmation_mismatch" as const };
    if (!resolveProjectCapabilities(project.capabilityProfile, project.status).canDelete) {
      return { status: "not_deletable" as const };
    }
    const now = new Date();
    const [job] = await transaction.insert(projectDeletionJobs).values({
      originalProjectId: project.id,
      ownerId,
      confirmationDigest: confirmationDigest(project.id, ownerId, project.title),
      manifestKeys: [],
      state: "pending",
      updatedAt: now,
    }).returning();
    await transaction.update(projects).set({ status: "deleting", updatedAt: now })
      .where(and(eq(projects.id, project.id), eq(projects.ownerId, ownerId)));
    emitLifecycleEvent("deletion_requested", { projectId, deletionJobId: job.id, ownerId });
    return { status: "accepted" as const, job };
  });
}

export async function deletionJobForOwner(jobId: string, ownerId: string) {
  const [job] = await db.select().from(projectDeletionJobs)
    .where(and(eq(projectDeletionJobs.id, jobId), eq(projectDeletionJobs.ownerId, ownerId)))
    .limit(1);
  return job ?? null;
}

async function setDeletionState(
  jobId: string,
  leaseToken: string,
  state: ProjectDeletionJob["state"],
  values: Partial<Pick<ProjectDeletionJob, "manifestKeys" | "lastError">> = {},
) {
  const [job] = await db.update(projectDeletionJobs).set({
    state,
    ...values,
    leaseToken: null,
    leaseAcquiredAt: null,
    updatedAt: new Date(),
  }).where(and(eq(projectDeletionJobs.id, jobId), eq(projectDeletionJobs.leaseToken, leaseToken))).returning();
  if (job) emitLifecycleEvent("deletion_state", {
    projectId: job.originalProjectId,
    deletionJobId: job.id,
    state: job.state,
    attemptCount: job.attemptCount,
    hasError: Boolean(job.lastError),
  });
  return job ?? null;
}

async function failDeletion(job: ProjectDeletionJob, leaseToken: string, error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
  emitLifecycleEvent("deletion_failed", {
    projectId: job.originalProjectId,
    deletionJobId: job.id,
    attemptCount: job.attemptCount,
    error: message,
  });
  return setDeletionState(job.id, leaseToken, "failed", { lastError: message });
}

async function acquireExecutionLease(jobId: string) {
  const now = new Date();
  const leaseToken = crypto.randomUUID();
  const expiredBefore = new Date(now.getTime() - EXECUTION_LEASE_MS);
  const [job] = await db.update(projectDeletionJobs).set({
    leaseToken,
    leaseAcquiredAt: now,
    state: "quiescing",
    attemptCount: sql`${projectDeletionJobs.attemptCount} + 1`,
    lastError: null,
    updatedAt: now,
  }).where(and(
    eq(projectDeletionJobs.id, jobId),
    ne(projectDeletionJobs.state, "completed"),
    or(isNull(projectDeletionJobs.leaseAcquiredAt), lt(projectDeletionJobs.leaseAcquiredAt, expiredBefore)),
  )).returning();
  return job ? { job, leaseToken } : null;
}

async function activeJobsForProject(projectId: string) {
  return db.select({ job: generationJobs }).from(generationJobs)
    .innerJoin(layoutVersions, eq(generationJobs.layoutVersionId, layoutVersions.id))
    .where(and(
      eq(layoutVersions.projectId, projectId),
      inArray(generationJobs.status, [...ACTIVE_GENERATION_STATUSES]),
    ));
}

async function quiesceProject(job: ProjectDeletionJob) {
  const queued = await db.transaction(async (transaction) => {
    await lockProjectLifecycle(transaction, job.originalProjectId);
    const active = await transaction.select({ job: generationJobs }).from(generationJobs)
      .innerJoin(layoutVersions, eq(generationJobs.layoutVersionId, layoutVersions.id))
      .where(and(
        eq(layoutVersions.projectId, job.originalProjectId),
        inArray(generationJobs.status, [...ACTIVE_GENERATION_STATUSES]),
      ));
    const queuedIds = active.filter(({ job: activeJob }) => activeJob.status === "queued").map(({ job: activeJob }) => activeJob.id);
    if (queuedIds.length > 0) {
      const now = new Date();
      await transaction.update(generationJobs).set({
        status: "canceled",
        failureReason: "Canceled because project deletion started",
        completedAt: now,
        updatedAt: now,
      }).where(inArray(generationJobs.id, queuedIds));
    }
    return active.filter(({ job: activeJob }) => activeJob.status !== "queued").map(({ job: activeJob }) => activeJob);
  });

  for (const active of queued.filter((candidate) => candidate.status === "processing")) {
    if (active.provider === "replicate" && !active.providerJobId && await recoverStaleDispatchClaim(active.id)) {
      continue;
    }
    if (active.provider !== "replicate" || !active.providerJobId) {
      throw new Error(`Active ${active.provider} job ${active.id} cannot be canceled safely`);
    }
    const canceled = await cancelReplicatePrediction(active.providerJobId);
    if (canceled.prediction) await applyReplicatePrediction(active.id, canceled.prediction);
    else {
      const now = new Date();
      await db.update(generationJobs).set({
        status: "canceled",
        failureReason: "Provider job was already absent during project deletion",
        completedAt: now,
        updatedAt: now,
      }).where(and(eq(generationJobs.id, active.id), eq(generationJobs.status, "processing")));
    }
    emitLifecycleEvent("provider_cancel", {
      projectId: job.originalProjectId,
      generationJobId: active.id,
      providerJobId: active.providerJobId,
      disposition: canceled.disposition,
    });
  }

  const afterCancel = await activeJobsForProject(job.originalProjectId);
  for (const { job: active } of afterCancel.filter(({ job: activeJob }) => activeJob.status === "finalizing")) {
    if (isFinalizingLeaseStale(active.finalizingStartedAt) && active.provider === "replicate" && active.providerJobId) {
      await reconcileReplicateJob(active.id);
    }
  }
  return activeJobsForProject(job.originalProjectId);
}

async function snapshotManifest(job: ProjectDeletionJob, leaseToken: string) {
  return db.transaction(async (transaction) => {
    await lockProjectLifecycle(transaction, job.originalProjectId);
    const active = await transaction.select({ id: generationJobs.id }).from(generationJobs)
      .innerJoin(layoutVersions, eq(generationJobs.layoutVersionId, layoutVersions.id))
      .where(and(
        eq(layoutVersions.projectId, job.originalProjectId),
        inArray(generationJobs.status, [...ACTIVE_GENERATION_STATUSES]),
      ));
    if (active.length > 0) return null;
    const assets = await transaction.select({ storageKey: generatedAssets.storageKey }).from(generatedAssets)
      .where(eq(generatedAssets.projectId, job.originalProjectId));
    const jobs = await transaction.select({
      id: generationJobs.id,
      layoutVersionId: generationJobs.layoutVersionId,
      requestPayload: generationJobs.requestPayload,
    }).from(generationJobs)
      .innerJoin(layoutVersions, eq(generationJobs.layoutVersionId, layoutVersions.id))
      .where(and(eq(layoutVersions.projectId, job.originalProjectId), eq(generationJobs.kind, "render")));
    const manifestKeys = buildExactDeletionManifest(assets.map((asset) => asset.storageKey), jobs);
    const [updated] = await transaction.update(projectDeletionJobs).set({
      state: "deleting_assets",
      manifestKeys,
      updatedAt: new Date(),
    }).where(and(eq(projectDeletionJobs.id, job.id), eq(projectDeletionJobs.leaseToken, leaseToken))).returning();
    return updated ?? null;
  });
}

export async function executeProjectDeletion(jobId: string) {
  const leased = await acquireExecutionLease(jobId);
  if (!leased) {
    const [current] = await db.select().from(projectDeletionJobs).where(eq(projectDeletionJobs.id, jobId)).limit(1);
    return current ?? null;
  }
  let { job } = leased;
  const { leaseToken } = leased;
  try {
    const [project] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.id, job.originalProjectId), eq(projects.ownerId, job.ownerId)))
      .limit(1);
    if (!project) return setDeletionState(job.id, leaseToken, "completed", { lastError: null });

    const active = await quiesceProject(job);
    if (active.length > 0) {
      const waiting = active.map(({ job: activeJob }) => `${activeJob.id}:${activeJob.status}`).join(",");
      emitLifecycleEvent("deletion_quiescence_wait", {
        projectId: job.originalProjectId,
        deletionJobId: job.id,
        activeJobs: waiting,
      });
      return setDeletionState(job.id, leaseToken, "quiescing", {
        lastError: `Waiting for active generation jobs: ${waiting}`,
      });
    }

    const snapshotted = await snapshotManifest(job, leaseToken);
    if (!snapshotted) return setDeletionState(job.id, leaseToken, "quiescing", { lastError: "Generation became active while deletion was quiescing" });
    job = snapshotted;
    const deletion = await deleteStoredAssetsExact(job.manifestKeys);
    if (deletion.failed.length > 0) {
      emitLifecycleEvent("storage_compensation_failure", {
        projectId: job.originalProjectId,
        deletionJobId: job.id,
        failedObjectCount: deletion.failed.length,
      });
      throw new Error(`Unable to delete ${deletion.failed.length} exact storage object(s): ${deletion.failed.map((item) => item.storageKey).join(", ")}`);
    }

    await db.update(projectDeletionJobs).set({ state: "deleting_database", updatedAt: new Date() })
      .where(and(eq(projectDeletionJobs.id, job.id), eq(projectDeletionJobs.leaseToken, leaseToken)));
    await db.transaction(async (transaction) => {
      await lockProjectLifecycle(transaction, job.originalProjectId);
      const [deleted] = await transaction.delete(projects).where(and(
        eq(projects.id, job.originalProjectId),
        eq(projects.ownerId, job.ownerId),
        eq(projects.status, "deleting"),
      )).returning({ id: projects.id });
      if (!deleted) throw new Error("Project left the deleting state before database removal");
    });
    return setDeletionState(job.id, leaseToken, "completed", { lastError: null });
  } catch (error) {
    return failDeletion(job, leaseToken, error);
  }
}

export async function retryProjectDeletion(jobId: string, ownerId: string) {
  const job = await deletionJobForOwner(jobId, ownerId);
  if (!job) return null;
  if (job.state === "completed") return job;
  return executeProjectDeletion(job.id);
}

export async function unresolvedDeletionJobsReport(now = new Date()) {
  const threshold = new Date(now.getTime() - 15 * 60 * 1_000);
  return db.select({
    id: projectDeletionJobs.id,
    originalProjectId: projectDeletionJobs.originalProjectId,
    state: projectDeletionJobs.state,
    attemptCount: projectDeletionJobs.attemptCount,
    lastError: projectDeletionJobs.lastError,
    updatedAt: projectDeletionJobs.updatedAt,
  }).from(projectDeletionJobs).where(or(
    eq(projectDeletionJobs.state, "failed"),
    and(ne(projectDeletionJobs.state, "completed"), lt(projectDeletionJobs.updatedAt, threshold)),
  ));
}
