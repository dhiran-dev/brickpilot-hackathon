import { sql, type SQL } from "drizzle-orm";

export const ACTIVE_GENERATION_STATUSES = ["queued", "processing", "finalizing"] as const;
export type ActiveGenerationStatus = typeof ACTIVE_GENERATION_STATUSES[number];
export type GenerationStatus = ActiveGenerationStatus | "completed" | "failed" | "canceled";

export const FINALIZING_LEASE_MS = 15 * 60 * 1_000;

type LifecycleTransaction = {
  execute(query: SQL): Promise<unknown>;
};

export function projectLifecycleLockKey(projectId: string) {
  return `brickpilot:project-lifecycle:${projectId}`;
}

/** Serialize every project mutation with deletion and render finalization. */
export async function lockProjectLifecycle(transaction: LifecycleTransaction, projectId: string) {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${projectLifecycleLockKey(projectId)}, 0))`);
}

export function isActiveGenerationStatus(status: string): status is ActiveGenerationStatus {
  return ACTIVE_GENERATION_STATUSES.includes(status as ActiveGenerationStatus);
}

export function isFinalizingLeaseStale(startedAt: Date | null | undefined, now = new Date()) {
  return Boolean(startedAt && now.getTime() - startedAt.getTime() >= FINALIZING_LEASE_MS);
}

export function emitLifecycleEvent(
  event: string,
  fields: Record<string, string | number | boolean | null | undefined>,
) {
  console.info(JSON.stringify({ scope: "project_lifecycle", event, ...fields }));
}
