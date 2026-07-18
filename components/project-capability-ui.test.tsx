import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  PROJECT_VIEW_ONLY_EXPLANATION,
  ProjectCapabilityNotice,
  projectCapabilityPresentation,
} from "@/components/project-capability-ui";
import type { ProjectCapabilities } from "@/lib/server/project-capabilities";

const current: ProjectCapabilities = {
  canView: true,
  canReadAssets: true,
  canDelete: true,
  canApplyAiSuggestion: true,
  canSelectScheme: true,
  canGenerateRender: true,
  canRetryRender: true,
};

const viewOnly: ProjectCapabilities = {
  ...current,
  canApplyAiSuggestion: false,
  canSelectScheme: false,
  canGenerateRender: false,
  canRetryRender: false,
};

describe("project capability presentation", () => {
  test("leaves a current ready project unobstructed", () => {
    expect(projectCapabilityPresentation({
      capabilityProfile: "current_v3",
      projectStatus: "ready",
      capabilities: current,
    })).toBeNull();
  });

  test("uses one explanation for legacy and archived view-only results", () => {
    const legacy = projectCapabilityPresentation({
      capabilityProfile: "legacy_view_only",
      projectStatus: "ready",
      capabilities: viewOnly,
    });
    const archived = projectCapabilityPresentation({
      capabilityProfile: "current_v3",
      projectStatus: "archived",
      capabilities: viewOnly,
    });

    expect(legacy).toMatchObject({ kind: "view_only", blocksNormalAccess: false, message: PROJECT_VIEW_ONLY_EXPLANATION });
    expect(archived).toMatchObject({ kind: "view_only", blocksNormalAccess: false, message: PROJECT_VIEW_ONLY_EXPLANATION });
  });

  test.each([
    ["generating", "generating", "Project generation in progress"],
    ["failed", "failed", "Project generation failed"],
    ["deleting", "deleting", "Project deletion pending"],
  ] as const)("blocks normal project access for %s", (projectStatus, kind, title) => {
    expect(projectCapabilityPresentation({
      capabilityProfile: "current_v3",
      projectStatus,
      capabilities: { ...current, canView: false },
    })).toMatchObject({ kind, title, blocksNormalAccess: true });
  });

  test("renders the shared view-only explanation as an accessible status notice", () => {
    const presentation = projectCapabilityPresentation({
      capabilityProfile: "legacy_view_only",
      projectStatus: "ready",
      capabilities: viewOnly,
    });
    if (!presentation) throw new Error("Expected a view-only presentation");

    const markup = renderToStaticMarkup(createElement(ProjectCapabilityNotice, { compact: true, presentation }));
    expect(markup).toContain('aria-label="Project access status"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain(PROJECT_VIEW_ONLY_EXPLANATION);
  });
});
