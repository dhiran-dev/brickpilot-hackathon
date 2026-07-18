import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import {
  deletionJobForOwner,
  publicDeletionJob,
  retryProjectDeletion,
} from "@/lib/server/delete-project";

const idSchema = z.string().uuid();

function error(error: string, status: number, code: string) {
  return NextResponse.json({ error, code }, { status });
}

async function ownedJob(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const user = await requireUser(request);
  if (!user) return { ok: false, response: error("Authentication is required.", 401, "AUTH_REQUIRED") } as const;
  const { jobId: rawJobId } = await context.params;
  const jobId = idSchema.safeParse(rawJobId);
  if (!jobId.success) return { ok: false, response: error("Deletion job not found.", 404, "DELETION_JOB_NOT_FOUND") } as const;
  return { ok: true, user, jobId: jobId.data } as const;
}

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const owned = await ownedJob(request, context);
  if (!owned.ok) return owned.response;
  const job = await deletionJobForOwner(owned.jobId, owned.user.id);
  if (!job) return error("Deletion job not found.", 404, "DELETION_JOB_NOT_FOUND");
  return NextResponse.json({ deletion: publicDeletionJob(job) });
}

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const owned = await ownedJob(request, context);
  if (!owned.ok) return owned.response;
  const job = await retryProjectDeletion(owned.jobId, owned.user.id);
  if (!job) return error("Deletion job not found.", 404, "DELETION_JOB_NOT_FOUND");
  return NextResponse.json({ deletion: publicDeletionJob(job) }, { status: job.state === "completed" ? 200 : 202 });
}
