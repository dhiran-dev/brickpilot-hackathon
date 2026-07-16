import { and, desc, eq, gte, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { buildingRequirementsSchema, hasMinimumResidentialRoomProgram } from "@/lib/building/requirements";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { generationJobs, layoutVersions, projectRequirements, projects } from "@/lib/db/schema";
import { classifyPersistedStudy } from "@/lib/design/persisted-study";
import { runDesignPipeline } from "@/lib/server/design-pipeline";

function configuredLimit(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const HOURLY_GENERATION_LIMIT = configuredLimit(process.env.RATE_LIMIT_GEN_PER_HOUR, 10);
const DAILY_GENERATION_LIMIT = configuredLimit(process.env.RATE_LIMIT_GEN_PER_DAY, 30);

class GenerationRateLimitError extends Error {
  constructor(readonly scope: "hour" | "day", readonly limit: number, readonly retryAfterSeconds: number) {
    super(scope === "hour" ? "Hourly design-generation limit reached. Try again later." : "Daily design-generation limit reached. Try again tomorrow.");
    this.name = "GenerationRateLimitError";
  }
}

function errorResponse(message: string, status: number, code?: string, details?: unknown) {
  return NextResponse.json({ error: message, code, details }, { status });
}

function jsonRecord(value: unknown) {
  return value as Record<string, unknown>;
}

class BuildingGenerationErrorLike extends Error {
  constructor(readonly result: Extract<Awaited<ReturnType<typeof runDesignPipeline>>, { status: "failed" }>) {
    super(result.message);
  }
}

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user) return errorResponse("Authentication is required.", 401, "AUTH_REQUIRED");

  const rows = await db
    .select({
      projectId: projects.id,
      designId: layoutVersions.id,
      version: layoutVersions.version,
      title: projects.title,
      status: layoutVersions.status,
      createdAt: layoutVersions.createdAt,
      requirements: projectRequirements.inputJson,
      building: layoutVersions.layoutJson,
      validation: layoutVersions.validation,
      costEstimate: layoutVersions.costEstimate,
      aiReview: layoutVersions.aiReview,
    })
    .from(layoutVersions)
    .innerJoin(projects, eq(layoutVersions.projectId, projects.id))
    .innerJoin(projectRequirements, eq(layoutVersions.requirementVersionId, projectRequirements.id))
    .where(eq(projects.ownerId, user.id))
    .orderBy(desc(layoutVersions.createdAt))
    .limit(48);

  const classified = rows.map(classifyPersistedStudy);
  const studies = classified.filter((item) => item.compatible).map((item) => item.study).slice(0, 12);
  const incompatibleStudies = classified.filter((item) => !item.compatible).map((item) => item.study).slice(0, 12);
  return NextResponse.json({ studies, incompatibleStudies });
}

export async function POST(request: Request) {
  const user = await requireUser(request);
  if (!user) return errorResponse("Authentication is required.", 401, "AUTH_REQUIRED");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400, "INVALID_JSON");
  }

  const candidate = body && typeof body === "object" && "requirements" in body
    ? (body as { requirements: unknown }).requirements
    : body;
  const parsed = buildingRequirementsSchema.safeParse(candidate);
  if (!parsed.success) {
    const code = parsed.error.issues.some((issue) => issue.message === "BUILDING_TYPE_COMING_SOON")
      ? "BUILDING_TYPE_COMING_SOON"
      : parsed.error.issues.some((issue) => issue.message === "IRREGULAR_SITE_NOT_SUPPORTED")
        ? "IRREGULAR_SITE_NOT_SUPPORTED"
        : "INVALID_REQUIREMENTS";
    return errorResponse(
      code === "BUILDING_TYPE_COMING_SOON"
        ? "Apartments and corporate/commercial projects are coming soon. Choose Detached house to continue."
        : code === "IRREGULAR_SITE_NOT_SUPPORTED"
          ? "Irregular-site generation is not supported yet. Save the site details and use a rectangular envelope for this study."
          : "Some required project details are missing or inconsistent.",
      400,
      code,
      parsed.error.flatten(),
    );
  }
  if (!hasMinimumResidentialRoomProgram(parsed.data)) {
    return errorResponse("Add at least one bedroom and one bathroom before generating a residential study.", 400, "INCOMPLETE_ROOM_PROGRAM");
  }
  const randomSeed = new Uint32Array(1);
  crypto.getRandomValues(randomSeed);
  const requirements = { ...parsed.data, seed: randomSeed[0] };

  const now = new Date();
  const summary = `Structured residential requirements v${requirements.requirementSchemaVersion}; ${requirements.floors.length} floor(s); ${requirements.rooms.length} requested rooms.`;
  let queued: {
    created: typeof projects.$inferSelect;
    requirement: typeof projectRequirements.$inferSelect;
    layout: typeof layoutVersions.$inferSelect;
    job: typeof generationJobs.$inferSelect;
  };
  try {
    queued = await db.transaction(async (transaction) => {
      // postgres-js pins this Drizzle transaction callback to one transaction connection. The
      // xact-level advisory lock therefore covers both quota reads and all four inserts.
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`brickpilot:design-generation:${user.id}`}, 0))`);
      const hourStart = new Date(now.getTime() - 60 * 60 * 1000);
      const dayStart = new Date(now);
      dayStart.setUTCHours(0, 0, 0, 0);
      const [usage] = await transaction
        .select({
          hourly: sql<number>`count(*) filter (where ${gte(generationJobs.createdAt, hourStart)})::integer`,
          daily: sql<number>`count(*) filter (where ${gte(generationJobs.createdAt, dayStart)})::integer`,
        })
        .from(generationJobs)
        .innerJoin(layoutVersions, eq(generationJobs.layoutVersionId, layoutVersions.id))
        .innerJoin(projects, eq(layoutVersions.projectId, projects.id))
        .where(and(eq(projects.ownerId, user.id), eq(generationJobs.kind, "design")));
      const hourly = Number(usage?.hourly ?? 0);
      const daily = Number(usage?.daily ?? 0);
      if (hourly >= HOURLY_GENERATION_LIMIT) throw new GenerationRateLimitError("hour", HOURLY_GENERATION_LIMIT, 60 * 60);
      if (daily >= DAILY_GENERATION_LIMIT) {
        const nextDay = new Date(dayStart);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        throw new GenerationRateLimitError("day", DAILY_GENERATION_LIMIT, Math.max(1, Math.ceil((nextDay.getTime() - now.getTime()) / 1000)));
      }

      const [created] = await transaction.insert(projects).values({
        ownerId: user.id,
        title: requirements.projectName,
        description: `${requirements.floors.length}-floor detached residential concept in ${requirements.region.locality ?? requirements.region.adminArea}`,
        status: "generating",
        updatedAt: now,
      }).returning();
      const [requirement] = await transaction.insert(projectRequirements).values({
        projectId: created.id,
        version: 1,
        inputJson: jsonRecord(requirements),
        source: "guided",
        updatedAt: now,
      }).returning();
      const [layout] = await transaction.insert(layoutVersions).values({
        projectId: created.id,
        requirementVersionId: requirement.id,
        version: 1,
        prompt: summary,
        status: "planning",
        updatedAt: now,
      }).returning();
      const [job] = await transaction.insert(generationJobs).values({
        layoutVersionId: layout.id,
        kind: "design",
        provider: "brickpilot",
        idempotencyKey: crypto.randomUUID(),
        status: "processing",
        requestPayload: jsonRecord(requirements),
        startedAt: now,
        updatedAt: now,
      }).returning();
      return { created, requirement, layout, job };
    });
  } catch (error) {
    if (error instanceof GenerationRateLimitError) return errorResponse(error.message, 429, "RATE_LIMITED", { scope: error.scope, limit: error.limit, retryAfterSeconds: error.retryAfterSeconds });
    console.error("Design generation reservation failed", error);
    return errorResponse("Unable to reserve this generation safely. No partial study was saved.", 500, "GENERATION_RESERVATION_FAILED");
  }
  const { created, layout, job } = queued;

  try {
    const pipelineResult = await runDesignPipeline(requirements);
    if (pipelineResult.status === "failed") throw new BuildingGenerationErrorLike(pipelineResult);
    const { building, validation, costEstimate, intent, aiReview } = pipelineResult;
    const completedAt = new Date();
    const response = {
      projectId: created.id,
      designId: layout.id,
      version: layout.version,
      title: requirements.projectName,
      requirements,
      building,
      validation,
      costEstimate,
      intent,
      aiReview,
    };

    await db.transaction(async (transaction) => {
      await transaction
        .update(layoutVersions)
        .set({
          status: "completed",
          intent: jsonRecord(intent),
          layoutJson: jsonRecord(building),
          validation: jsonRecord(validation),
          costEstimate: jsonRecord(costEstimate),
          aiReview: jsonRecord(aiReview),
          updatedAt: completedAt,
        })
        .where(eq(layoutVersions.id, layout.id));
      await transaction
        .update(generationJobs)
        .set({ status: "completed", responsePayload: jsonRecord(response), completedAt, updatedAt: completedAt })
        .where(eq(generationJobs.id, job.id));
      await transaction
        .update(projects)
        .set({ status: "ready", updatedAt: completedAt })
        .where(eq(projects.id, created.id));
    });

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    const failedAt = new Date();
    const generationError = error instanceof BuildingGenerationErrorLike ? error.result : undefined;
    const code = generationError?.code ?? "GENERATION_FAILED";
    const message = generationError?.message ?? "Unable to create a deterministic concept for these requirements.";
    await db.transaction(async (transaction) => {
      await transaction
        .update(layoutVersions)
        .set({ status: "failed", failureReason: `${code}: ${message}`, validation: generationError ? jsonRecord({ conflicts: generationError.conflicts }) : undefined, updatedAt: failedAt })
        .where(eq(layoutVersions.id, layout.id));
      await transaction
        .update(generationJobs)
        .set({ status: "failed", failureReason: `${code}: ${message}`, completedAt: failedAt, updatedAt: failedAt })
        .where(eq(generationJobs.id, job.id));
      await transaction
        .update(projects)
        .set({ status: "failed", updatedAt: failedAt })
        .where(eq(projects.id, created.id));
    });
    return errorResponse(message, generationError ? 422 : 500, code, generationError?.conflicts);
  }
}
