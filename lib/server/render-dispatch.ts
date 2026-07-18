import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { generationJobs, layoutVersions, projects } from "@/lib/db/schema";
import { safePredictionPayload, type ReplicatePrediction } from "@/lib/render/replicate";
import { lockProjectLifecycle } from "@/lib/server/project-lifecycle";

export const DISPATCH_CLAIM_LEASE_MS = 2 * 60 * 1_000;

export function dispatchClaimNeedsRecovery(input: {
  status: string;
  dispatchState: string | null;
  providerJobId: string | null;
  dispatchLeaseAcquiredAt: Date | null;
}, now = new Date()) {
  return input.status === "processing"
    && input.dispatchState === "claimed"
    && input.providerJobId == null
    && Boolean(input.dispatchLeaseAcquiredAt && now.getTime() - input.dispatchLeaseAcquiredAt.getTime() >= DISPATCH_CLAIM_LEASE_MS);
}

export async function recoverDispatchClaimWithCas(
  claim: Parameters<typeof dispatchClaimNeedsRecovery>[0] & { dispatchLeaseToken: string | null },
  now: Date,
  expire: (leaseToken: string) => Promise<boolean>,
) {
  if (!claim.dispatchLeaseToken || !dispatchClaimNeedsRecovery(claim, now)) return false;
  return expire(claim.dispatchLeaseToken);
}

export async function claimProviderDispatch(projectId: string, jobId: string) {
  return db.transaction(async (transaction) => {
    await lockProjectLifecycle(transaction, projectId);
    const [project] = await transaction.select({ status: projects.status }).from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project || project.status === "deleting") throw new Error("PROJECT_DELETING");
    const now = new Date();
    const leaseToken = crypto.randomUUID();
    const [claimed] = await transaction.update(generationJobs).set({
      status: "processing",
      dispatchState: "claimed",
      dispatchLeaseToken: leaseToken,
      dispatchLeaseAcquiredAt: now,
      startedAt: now,
      updatedAt: now,
    }).where(and(
      eq(generationJobs.id, jobId),
      eq(generationJobs.status, "queued"),
      or(eq(generationJobs.dispatchState, "reserved"), isNull(generationJobs.dispatchState)),
    )).returning({ dispatchToken: generationJobs.dispatchToken, leaseToken: generationJobs.dispatchLeaseToken });
    return claimed ?? null;
  });
}

/** Commits evidence that the next operation may have reached the provider. Never redrive this state. */
export async function armProviderDispatch(projectId: string, jobId: string, leaseToken: string) {
  return db.transaction(async (transaction) => {
    await lockProjectLifecycle(transaction, projectId);
    const [project] = await transaction.select({ status: projects.status }).from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project || project.status === "deleting") throw new Error("PROJECT_DELETING");
    const now = new Date();
    const [armed] = await transaction.update(generationJobs).set({
      dispatchState: "provider_pending",
      dispatchAttemptedAt: now,
      updatedAt: now,
    }).where(and(
      eq(generationJobs.id, jobId),
      eq(generationJobs.status, "processing"),
      eq(generationJobs.dispatchState, "claimed"),
      eq(generationJobs.dispatchLeaseToken, leaseToken),
      isNull(generationJobs.providerJobId),
    )).returning({ dispatchToken: generationJobs.dispatchToken });
    return armed ?? null;
  });
}

export async function recoverStaleDispatchClaim(jobId: string, now = new Date()) {
  const [candidate] = await db.select({
    projectId: layoutVersions.projectId,
    status: generationJobs.status,
    dispatchState: generationJobs.dispatchState,
    providerJobId: generationJobs.providerJobId,
    dispatchLeaseToken: generationJobs.dispatchLeaseToken,
    dispatchLeaseAcquiredAt: generationJobs.dispatchLeaseAcquiredAt,
  }).from(generationJobs).innerJoin(layoutVersions, eq(generationJobs.layoutVersionId, layoutVersions.id))
    .where(eq(generationJobs.id, jobId)).limit(1);
  if (!candidate) return false;
  return recoverDispatchClaimWithCas(candidate, now, (leaseToken) => db.transaction(async (transaction) => {
    await lockProjectLifecycle(transaction, candidate.projectId);
    const expiredBefore = new Date(now.getTime() - DISPATCH_CLAIM_LEASE_MS);
    const [expired] = await transaction.update(generationJobs).set({
      status: "queued",
      dispatchState: "reserved",
      dispatchLeaseToken: null,
      dispatchLeaseAcquiredAt: null,
      failureReason: null,
      startedAt: null,
      completedAt: null,
      updatedAt: now,
    }).where(and(
      eq(generationJobs.id, jobId),
      eq(generationJobs.status, "processing"),
      eq(generationJobs.dispatchState, "claimed"),
      eq(generationJobs.dispatchLeaseToken, leaseToken),
      lt(generationJobs.dispatchLeaseAcquiredAt, expiredBefore),
      isNull(generationJobs.providerJobId),
      isNull(generationJobs.dispatchAttemptedAt),
    )).returning({ id: generationJobs.id });
    return Boolean(expired);
  }));
}

export async function drainStaleDispatchClaims(layoutVersionId: string, now = new Date()) {
  const candidates = await db.select({ id: generationJobs.id }).from(generationJobs).where(and(
    eq(generationJobs.layoutVersionId, layoutVersionId),
    eq(generationJobs.status, "processing"),
    eq(generationJobs.dispatchState, "claimed"),
    isNull(generationJobs.providerJobId),
  ));
  const results = await Promise.all(candidates.map((candidate) => recoverStaleDispatchClaim(candidate.id, now)));
  return results.filter(Boolean).length;
}

/**
 * Attaches a provider prediction to the durable pre-dispatch reservation. The dispatch token is
 * also embedded in the signed provider webhook URL, so a start/completed callback can close the
 * provider-accepted/database-attach gap after a request or database failure.
 */
export async function attachProviderPredictionByDispatchToken(
  dispatchToken: string,
  prediction: ReplicatePrediction,
) {
  const [candidate] = await db.select({
    jobId: generationJobs.id,
    projectId: layoutVersions.projectId,
  }).from(generationJobs)
    .innerJoin(layoutVersions, eq(generationJobs.layoutVersionId, layoutVersions.id))
    .where(and(eq(generationJobs.provider, "replicate"), eq(generationJobs.dispatchToken, dispatchToken)))
    .limit(1);
  if (!candidate) return null;

  return db.transaction(async (transaction) => {
    await lockProjectLifecycle(transaction, candidate.projectId);
    const [current] = await transaction.select({
      jobId: generationJobs.id,
      providerJobId: generationJobs.providerJobId,
      status: generationJobs.status,
      projectStatus: projects.status,
    }).from(generationJobs)
      .innerJoin(layoutVersions, eq(generationJobs.layoutVersionId, layoutVersions.id))
      .innerJoin(projects, eq(layoutVersions.projectId, projects.id))
      .where(and(
        eq(generationJobs.id, candidate.jobId),
        eq(generationJobs.provider, "replicate"),
        eq(generationJobs.dispatchToken, dispatchToken),
      )).limit(1);
    if (!current) return null;
    if (current.providerJobId && current.providerJobId !== prediction.id) {
      throw new Error("DISPATCH_TOKEN_PROVIDER_ID_MISMATCH");
    }
    if (["completed", "failed", "canceled"].includes(current.status)) {
      return { ...current, attached: current.providerJobId === prediction.id };
    }
    const now = new Date();
    const [attached] = await transaction.update(generationJobs).set({
      providerJobId: prediction.id,
      dispatchState: "attached",
      dispatchLeaseToken: null,
      dispatchLeaseAcquiredAt: null,
      responsePayload: safePredictionPayload(prediction) as Record<string, unknown>,
      status: "processing",
      startedAt: now,
      updatedAt: now,
    }).where(and(
      eq(generationJobs.id, current.jobId),
      inArray(generationJobs.status, ["queued", "processing"]),
    )).returning({ id: generationJobs.id });
    return { ...current, attached: Boolean(attached) || current.providerJobId === prediction.id };
  });
}
