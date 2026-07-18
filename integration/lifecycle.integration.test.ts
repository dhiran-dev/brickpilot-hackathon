import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import {
  TEST_DATABASE_URL,
  applyMigrationFiles,
  migrationFiles,
  openTestDatabase,
  resetPublicSchema,
} from "@/integration/test-database";

const databaseTest = TEST_DATABASE_URL ? test : test.skip;

describe("lifecycle database integration", () => {
  test("discovers lifecycle integration tests without silently passing an empty suite", () => {
    expect(import.meta.path.endsWith("lifecycle.integration.test.ts")).toBe(true);
  });

  databaseTest("enforces creation identity, direct denials, and retryable deletion on an isolated database", async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL!;
    const raw = openTestDatabase(TEST_DATABASE_URL!);
    await resetPublicSchema(raw);
    await applyMigrationFiles(raw, migrationFiles());

    const { db, client: appClient } = await import("@/lib/db");
    const { projectDeletionJobs, projects, users } = await import("@/lib/db/schema");
    const { projectMutationDenial } = await import("@/lib/server/project-capabilities");
    const { retryProjectDeletion } = await import("@/lib/server/delete-project");
    const ownerId = `integration-owner-${crypto.randomUUID()}`;
    try {
      await db.insert(users).values({ id: ownerId, name: "Integration owner", email: `${ownerId}@example.test`, role: "owner" });
      const requestId = `integration:${crypto.randomUUID()}`;
      const first = await db.insert(projects).values({
        ownerId,
        title: "Idempotent creation",
        status: "ready",
        capabilityProfile: "current_v2",
        generatorContractVersion: 2,
        rolloutEpoch: "integration",
        clientRequestId: requestId,
      }).returning();
      const second = await db.insert(projects).values({
        ownerId,
        title: "Duplicate creation",
        status: "ready",
        capabilityProfile: "current_v2",
        generatorContractVersion: 2,
        rolloutEpoch: "integration",
        clientRequestId: requestId,
      }).onConflictDoNothing().returning();
      expect(first).toHaveLength(1);
      expect(second).toHaveLength(0);

      expect(projectMutationDenial("legacy_view_only", "ready", "canApplyAiSuggestion")?.code).toBe("PROJECT_VIEW_ONLY");
      expect(projectMutationDenial("current_v3", "deleting", "canGenerateRender")?.code).toBe("PROJECT_DELETING");

      const [deletingProject] = await db.insert(projects).values({
        ownerId,
        title: "Retry deletion",
        status: "deleting",
        capabilityProfile: "current_v3",
        generatorContractVersion: 3,
        rolloutEpoch: "integration",
        clientRequestId: `integration:${crypto.randomUUID()}`,
      }).returning();
      const [failedJob] = await db.insert(projectDeletionJobs).values({
        originalProjectId: deletingProject.id,
        ownerId,
        confirmationDigest: "integration-digest",
        state: "failed",
        manifestKeys: [],
        lastError: "simulated transient storage failure",
      }).returning();
      const retried = await retryProjectDeletion(failedJob.id, ownerId);
      expect(retried).toMatchObject({ state: "completed", attemptCount: 1, lastError: null });
      expect(await db.select({ id: projects.id }).from(projects).where(eq(projects.id, deletingProject.id))).toHaveLength(0);
    } finally {
      await db.delete(users).where(eq(users.id, ownerId));
      await appClient.end();
      await raw.end();
    }
  }, 30_000);
});
