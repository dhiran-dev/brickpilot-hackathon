import { describe, expect, test } from "bun:test";

import { deriveProjectStage } from "@/lib/design/dashboard-stage";

describe("deriveProjectStage", () => {
  test("projects without a layout version are drafts", () => {
    expect(deriveProjectStage({ designStatus: null, completedRenderCount: 0 }).stage).toBe("draft");
  });

  test("a failed study is labelled failed regardless of renders", () => {
    const info = deriveProjectStage({ designStatus: "failed", completedRenderCount: 2 });
    expect(info.stage).toBe("failed");
    expect(info.label).toBe("Generation failed");
  });

  test("a completed study without renders is plan-ready", () => {
    const info = deriveProjectStage({ designStatus: "completed", completedRenderCount: 0 });
    expect(info.stage).toBe("plan-ready");
    expect(info.label).toBe("Plan ready");
  });

  test("a completed study with renders shows the render count", () => {
    expect(deriveProjectStage({ designStatus: "completed", completedRenderCount: 1 })).toMatchObject({ stage: "rendered", label: "Rendered", detail: "1 completed render" });
    expect(deriveProjectStage({ designStatus: "completed", completedRenderCount: 4 }).detail).toBe("4 completed renders");
  });

  test("mid-pipeline statuses read as generating", () => {
    for (const status of ["queued", "planning", "validating", "rendering", "generating"]) {
      expect(deriveProjectStage({ designStatus: status, completedRenderCount: 0 }).stage).toBe("in-progress");
    }
    expect(deriveProjectStage({ designStatus: "validating", completedRenderCount: 0 }).detail).toBe("Latest study is validating.");
  });
});
