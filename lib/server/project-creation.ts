import type { ProjectCapabilityProfile, ProjectLifecycleStatus } from "@/lib/server/project-capabilities";
import { projectCapabilityMetadata } from "@/lib/server/project-capabilities";

export function validClientRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9:_-]{8,120}$/.test(value.trim());
}

export function projectCreationReplay(input: {
  projectId: string;
  designId: string | null;
  projectStatus: ProjectLifecycleStatus;
  capabilityProfile: ProjectCapabilityProfile;
  generatorContractVersion: number;
  responsePayload: Record<string, unknown> | null;
}) {
  const metadata = projectCapabilityMetadata(input.capabilityProfile, input.projectStatus, input.generatorContractVersion);
  if (input.responsePayload) return {
    status: 200 as const,
    body: { ...input.responsePayload, ...metadata, replayed: true as const },
  };
  return {
    status: 202 as const,
    body: {
      projectId: input.projectId,
      designId: input.designId,
      status: input.projectStatus,
      ...metadata,
      replayed: true as const,
    },
  };
}
