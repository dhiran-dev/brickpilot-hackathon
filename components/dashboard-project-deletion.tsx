"use client";

import { useRouter } from "next/navigation";

import { ProjectDeletionControl } from "@/components/project-deletion-control";

/**
 * Dashboard cards are server-rendered, so the completion callback lives in this thin
 * client wrapper: once the durable deletion job completes, the list is refreshed and
 * the removed project drops out.
 */
export function DashboardProjectDeletion({ projectId, projectTitle, canDelete }: {
  projectId: string;
  projectTitle: string;
  canDelete: boolean;
}) {
  const router = useRouter();
  return <ProjectDeletionControl canDelete={canDelete} onCompleted={() => router.refresh()} projectId={projectId} projectTitle={projectTitle} />;
}
