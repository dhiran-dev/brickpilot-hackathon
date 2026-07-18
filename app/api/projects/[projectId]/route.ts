import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import {
  executeProjectDeletion,
  publicDeletionJob,
  requestProjectDeletion,
} from "@/lib/server/delete-project";

const requestSchema = z.object({ confirmationTitle: z.string().min(1).max(120) });
const idSchema = z.string().uuid();

function error(error: string, status: number, code: string) {
  return NextResponse.json({ error, code }, { status });
}

export async function DELETE(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const user = await requireUser(request);
  if (!user) return error("Authentication is required.", 401, "AUTH_REQUIRED");
  const { projectId: rawProjectId } = await context.params;
  const projectId = idSchema.safeParse(rawProjectId);
  if (!projectId.success) return error("Project not found.", 404, "PROJECT_NOT_FOUND");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error("Request body must be valid JSON.", 400, "INVALID_JSON");
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return error("Type the exact project title to confirm deletion.", 400, "INVALID_DELETE_CONFIRMATION");

  const requested = await requestProjectDeletion(projectId.data, user.id, parsed.data.confirmationTitle);
  if (requested.status === "not_found") return error("Project not found.", 404, "PROJECT_NOT_FOUND");
  if (requested.status === "confirmation_mismatch") return error("The confirmation title does not match.", 409, "DELETE_CONFIRMATION_MISMATCH");
  if (requested.status === "not_deletable") return error("This project cannot be deleted in its current state.", 409, "PROJECT_NOT_DELETABLE");
  const job = requested.status === "accepted"
    ? await executeProjectDeletion(requested.job.id) ?? requested.job
    : requested.job;
  return NextResponse.json({ deletion: publicDeletionJob(job) }, { status: job.state === "completed" ? 200 : 202 });
}
