import { describe, expect, test } from "bun:test";

import {
  deletionProgressLabel,
  parseProjectDeletionPayload,
  projectDeletionDesignStorageKey,
  projectDeletionStorageKey,
  shouldPollDeletion,
} from "@/lib/design/project-deletion-client";
import type { ProjectDeletionState } from "@/lib/design/project-deletion-client";

describe("project deletion UI contract", () => {
  test("parses the owner-scoped API payload and rejects incomplete data", () => {
    expect(parseProjectDeletionPayload({ deletion: {
      id: "job-a",
      originalProjectId: "project-a",
      state: "deleting_assets",
      attemptCount: 2,
      lastError: null,
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:01:00.000Z",
    } })).toMatchObject({ id: "job-a", state: "deleting_assets", attemptCount: 2 });
    expect(parseProjectDeletionPayload({ deletion: { id: "job-a", state: "unknown" } })).toBeNull();
  });

  test("polls pending phases but stops for failed and completed jobs", () => {
    expect((["pending", "quiescing", "deleting_assets", "deleting_database"] satisfies ProjectDeletionState[]).every(shouldPollDeletion)).toBe(true);
    expect(shouldPollDeletion("failed")).toBe(false);
    expect(shouldPollDeletion("completed")).toBe(false);
    expect(deletionProgressLabel("deleting_assets")).toBe("Removing project assets");
  });

  test("isolates persisted job identifiers by project", () => {
    expect(projectDeletionStorageKey("project-a")).toBe("brickpilot:project-deletion:project-a");
    expect(projectDeletionStorageKey("project-a")).not.toBe(projectDeletionStorageKey("project-b"));
    expect(projectDeletionDesignStorageKey("design-a")).toBe("brickpilot:design-deletion:design-a");
  });
});
