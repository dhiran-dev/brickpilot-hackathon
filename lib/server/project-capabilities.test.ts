import { describe, expect, test } from "bun:test";

import { projectCapabilityMetadata, projectMutationDenial, resolveProjectCapabilities } from "@/lib/server/project-capabilities";

describe("resolveProjectCapabilities", () => {
  test("keeps legacy ready projects viewable and deletable but immutable", () => {
    expect(resolveProjectCapabilities("legacy_view_only", "ready")).toEqual({
      canView: true,
      canReadAssets: true,
      canDelete: true,
      canApplyAiSuggestion: false,
      canSelectScheme: false,
      canGenerateRender: false,
      canRetryRender: false,
    });
  });

  test("allows mutations only for ready current profiles", () => {
    expect(resolveProjectCapabilities("current_v2", "ready").canGenerateRender).toBe(true);
    expect(resolveProjectCapabilities("current_v3", "ready").canSelectScheme).toBe(true);
    expect(resolveProjectCapabilities("current_v3", "ready").canApplyAiSuggestion).toBe(true);
    expect(projectMutationDenial("current_v3", "ready", "canApplyAiSuggestion")).toBeNull();
    expect(resolveProjectCapabilities("current_v3", "generating").canView).toBe(false);
  });

  test("makes archived projects readable but immutable", () => {
    expect(resolveProjectCapabilities("current_v3", "archived")).toMatchObject({
      canView: true,
      canReadAssets: true,
      canDelete: true,
      canApplyAiSuggestion: false,
      canGenerateRender: false,
    });
  });

  test("denies normal access while deletion owns the project", () => {
    expect(resolveProjectCapabilities("current_v3", "deleting").canView).toBe(false);
    expect(projectMutationDenial("current_v3", "deleting", "canGenerateRender")?.code).toBe("PROJECT_DELETING");
    expect(projectMutationDenial("current_v3", "deleting", "canApplyAiSuggestion")?.code).toBe("PROJECT_DELETING");
  });

  test("returns stable API metadata from the same authoritative mapper", () => {
    expect(projectCapabilityMetadata("legacy_view_only", "ready", 2)).toEqual({
      projectStatus: "ready",
      capabilityProfile: "legacy_view_only",
      generatorContractVersion: 2,
      capabilities: resolveProjectCapabilities("legacy_view_only", "ready"),
    });
  });

  test("denies every mutation directly for legacy, deleting, and not-ready projects", () => {
    for (const capability of ["canApplyAiSuggestion", "canSelectScheme", "canGenerateRender", "canRetryRender"] as const) {
      expect(projectMutationDenial("legacy_view_only", "ready", capability)?.code).toBe("PROJECT_VIEW_ONLY");
      expect(projectMutationDenial("current_v3", "deleting", capability)?.code).toBe("PROJECT_DELETING");
      expect(projectMutationDenial("current_v2", "generating", capability)?.code).toBe("PROJECT_NOT_READY");
    }
  });
});
