export type ProjectDeletionState =
  | "pending"
  | "quiescing"
  | "deleting_assets"
  | "deleting_database"
  | "failed"
  | "completed";

export type ProjectDeletionStatus = {
  id: string;
  originalProjectId: string;
  state: ProjectDeletionState;
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export function projectDeletionStorageKey(projectId: string) {
  return `brickpilot:project-deletion:${projectId}`;
}

export function projectDeletionDesignStorageKey(designId: string) {
  return `brickpilot:design-deletion:${designId}`;
}

export function parseProjectDeletionPayload(value: unknown): ProjectDeletionStatus | null {
  if (!value || typeof value !== "object" || !("deletion" in value)) return null;
  const deletion = (value as { deletion?: unknown }).deletion;
  if (!deletion || typeof deletion !== "object") return null;
  const candidate = deletion as Partial<ProjectDeletionStatus>;
  const states: ProjectDeletionState[] = ["pending", "quiescing", "deleting_assets", "deleting_database", "failed", "completed"];
  if (typeof candidate.id !== "string" || typeof candidate.originalProjectId !== "string"
    || !states.includes(candidate.state as ProjectDeletionState)
    || typeof candidate.attemptCount !== "number") return null;
  return {
    id: candidate.id,
    originalProjectId: candidate.originalProjectId,
    state: candidate.state as ProjectDeletionState,
    attemptCount: candidate.attemptCount,
    lastError: typeof candidate.lastError === "string" ? candidate.lastError : null,
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : "",
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : "",
  };
}

export function deletionProgressLabel(state: ProjectDeletionState) {
  if (state === "pending" || state === "quiescing") return "Stopping active work";
  if (state === "deleting_assets") return "Removing project assets";
  if (state === "deleting_database") return "Removing project records";
  if (state === "failed") return "Deletion needs attention";
  return "Project deleted";
}

export function shouldPollDeletion(state: ProjectDeletionState) {
  return state !== "failed" && state !== "completed";
}
