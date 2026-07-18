import { describe, expect, test } from "bun:test";

import { projectCreationReplay, validClientRequestId } from "@/lib/server/project-creation";

describe("project creation idempotency contract", () => {
  test("accepts stable draft keys and rejects missing or unsafe keys", () => {
    expect(validClientRequestId("draft:12345678-abcd")).toBe(true);
    expect(validClientRequestId("short")).toBe(false);
    expect(validClientRequestId("draft key with spaces")).toBe(false);
    expect(validClientRequestId(undefined)).toBe(false);
  });

  test("replays one completed response without changing its project identity", () => {
    const input = {
      projectId: "project-1",
      designId: "layout-1",
      projectStatus: "ready" as const,
      capabilityProfile: "current_v2" as const,
      generatorContractVersion: 2,
      responsePayload: { projectId: "project-1", designId: "layout-1", seed: 41 },
      requirements: { requirementSchemaVersion: 2, rooms: [] },
    };
    expect(projectCreationReplay(input)).toEqual(projectCreationReplay(input));
    expect(projectCreationReplay(input)).toMatchObject({
      status: 200,
      body: {
        projectId: "project-1",
        designId: "layout-1",
        seed: 41,
        requirements: { requirementSchemaVersion: 2, rooms: [] },
        projectStatus: "ready",
        capabilityProfile: "current_v2",
        replayed: true,
      },
    });
  });

  test("returns the same reserved identity while the first request is still running", () => {
    expect(projectCreationReplay({
      projectId: "project-2",
      designId: "layout-2",
      projectStatus: "generating",
      capabilityProfile: "current_v3",
      generatorContractVersion: 3,
      responsePayload: null,
    })).toMatchObject({
      status: 202,
      body: {
        projectId: "project-2",
        designId: "layout-2",
        projectStatus: "generating",
        capabilityProfile: "current_v3",
        replayed: true,
        capabilities: { canView: false, canGenerateRender: false },
      },
    });
  });
});
