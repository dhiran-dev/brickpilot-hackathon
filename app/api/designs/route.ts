import { and, count, eq, gte } from "drizzle-orm";
import { NextResponse } from "next/server";

import { generateDesign, DesignGenerationError } from "@/lib/ai/fireworks";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { designVersions, generationJobs, projects } from "@/lib/db/schema";
import { generateDesignInputSchema } from "@/lib/design/schema";

const DAILY_GENERATION_LIMIT = Number(process.env.RATE_LIMIT_GEN_PER_DAY ?? 30);

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const user = await requireUser(request);
  if (!user) return errorResponse("Authentication is required.", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  const input = generateDesignInputSchema.safeParse(body);
  if (!input.success) return errorResponse("Provide a title and a design request between 20 and 2,000 characters.", 400);

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const [usage] = await db
    .select({ total: count() })
    .from(designVersions)
    .innerJoin(projects, eq(designVersions.projectId, projects.id))
    .where(and(eq(projects.ownerId, user.id), gte(designVersions.createdAt, today)));

  if (usage.total >= DAILY_GENERATION_LIMIT) {
    return errorResponse("Daily design-generation limit reached. Try again tomorrow.", 429);
  }

  const now = new Date();
  const [created] = await db
    .insert(projects)
    .values({
      ownerId: user.id,
      title: input.data.title ?? "Untitled design",
      description: input.data.description,
      status: "generating",
      updatedAt: now,
    })
    .returning();

  const [design] = await db
    .insert(designVersions)
    .values({
      projectId: created.id,
      version: 1,
      prompt: input.data.prompt,
      status: "planning",
      updatedAt: now,
    })
    .returning();

  const [job] = await db
    .insert(generationJobs)
    .values({
      designVersionId: design.id,
      kind: "design",
      provider: "fireworks",
      idempotencyKey: crypto.randomUUID(),
      status: "processing",
      requestPayload: { prompt: input.data.prompt },
      startedAt: now,
      updatedAt: now,
    })
    .returning();

  try {
    const output = await generateDesign(input.data.prompt);
    const completedAt = new Date();

    await db.transaction(async (transaction) => {
      await transaction
        .update(designVersions)
        .set({
          status: "completed",
          intent: output.intent,
          floorPlan: output.floorPlan,
          validation: output.validation,
          costEstimate: output.costEstimate,
          updatedAt: completedAt,
        })
        .where(eq(designVersions.id, design.id));
      await transaction
        .update(generationJobs)
        .set({ status: "completed", responsePayload: output, completedAt, updatedAt: completedAt })
        .where(eq(generationJobs.id, job.id));
      await transaction
        .update(projects)
        .set({ status: "ready", updatedAt: completedAt })
        .where(eq(projects.id, created.id));
    });

    return NextResponse.json({ projectId: created.id, designId: design.id, ...output }, { status: 201 });
  } catch (error) {
    const failedAt = new Date();
    await db.transaction(async (transaction) => {
      await transaction
        .update(designVersions)
        .set({ status: "failed", failureReason: "Generation failed", updatedAt: failedAt })
        .where(eq(designVersions.id, design.id));
      await transaction
        .update(generationJobs)
        .set({ status: "failed", failureReason: "Generation failed", completedAt: failedAt, updatedAt: failedAt })
        .where(eq(generationJobs.id, job.id));
      await transaction
        .update(projects)
        .set({ status: "failed", updatedAt: failedAt })
        .where(eq(projects.id, created.id));
    });

    const message = error instanceof DesignGenerationError ? error.message : "Unable to create a design right now.";
    return errorResponse(message, 502);
  }
}
