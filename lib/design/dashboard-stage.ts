// Stage shown on a dashboard project card, derived from the project's latest layout version
// plus how many render assets already completed for it.
export type DashboardStage = "draft" | "in-progress" | "failed" | "plan-ready" | "rendered";

export type DashboardStageInfo = {
  stage: DashboardStage;
  label: string;
  detail: string;
};

const IN_PROGRESS_STATUSES = new Set(["queued", "planning", "validating", "rendering", "generating"]);

export function deriveProjectStage(input: { designStatus: string | null; completedRenderCount: number }): DashboardStageInfo {
  const { designStatus, completedRenderCount } = input;
  if (!designStatus) return { stage: "draft", label: "Not started", detail: "No study has been generated for this project yet." };
  if (designStatus === "failed") return { stage: "failed", label: "Generation failed", detail: "The latest attempt never became a usable plan." };
  if (designStatus === "completed") {
    return completedRenderCount > 0
      ? { stage: "rendered", label: "Rendered", detail: `${completedRenderCount} completed render${completedRenderCount === 1 ? "" : "s"}` }
      : { stage: "plan-ready", label: "Plan ready", detail: "Floor plan, validation and cost evidence saved." };
  }
  if (IN_PROGRESS_STATUSES.has(designStatus)) return { stage: "in-progress", label: "Generating", detail: `Latest study is ${designStatus.replaceAll("_", " ")}.` };
  return { stage: "in-progress", label: "In progress", detail: `Latest study is ${designStatus.replaceAll("_", " ")}.` };
}
