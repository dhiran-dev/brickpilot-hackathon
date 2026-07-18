import { describe, expect, test } from "bun:test";

import {
  ACTIVE_GENERATION_STATUSES,
  FINALIZING_LEASE_MS,
  isActiveGenerationStatus,
  isFinalizingLeaseStale,
  projectLifecycleLockKey,
} from "@/lib/server/project-lifecycle";

describe("project lifecycle coordination", () => {
  test("classifies queued, processing and finalizing as active everywhere", () => {
    expect(ACTIVE_GENERATION_STATUSES).toEqual(["queued", "processing", "finalizing"]);
    expect(["queued", "processing", "finalizing"].every(isActiveGenerationStatus)).toBe(true);
    expect(["completed", "failed", "canceled"].some(isActiveGenerationStatus)).toBe(false);
  });

  test("uses a single stable lock namespace", () => {
    expect(projectLifecycleLockKey("project-a")).toBe("brickpilot:project-lifecycle:project-a");
  });

  test("does not clear a finalizing lease before its hold threshold", () => {
    const now = new Date("2026-07-18T12:00:00.000Z");
    expect(isFinalizingLeaseStale(new Date(now.getTime() - FINALIZING_LEASE_MS + 1), now)).toBe(false);
    expect(isFinalizingLeaseStale(new Date(now.getTime() - FINALIZING_LEASE_MS), now)).toBe(true);
    expect(isFinalizingLeaseStale(null, now)).toBe(false);
  });
});
