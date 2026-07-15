import { and, count, desc, eq, gte } from "drizzle-orm";
import { NextResponse } from "next/server";

import { BuildingGenerationError, generateBuilding } from "@/lib/building/generate";
import { buildingRequirementsSchema } from "@/lib/building/requirements";
import { requireUser } from "@/lib/auth";
import { estimateBuildingCost } from "@/lib/cost";
import { db } from "@/lib/db";
import { generationJobs, layoutVersions, projectRequirements, projects } from "@/lib/db/schema";

const DAILY_GENERATION_LIMIT = Number(process.env.RATE_LIMIT_GEN_PER_DAY ?? 30);

function errorResponse(message: string, status: number, code?: string, details?: unknown) {
  return NextResponse.json({ error: message, code, details }, { status });
}

function jsonRecord(value: unknown) {
  return value as Record<string, unknown>;
}

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user) return errorResponse("Authentication is required.", 401, "AUTH_REQUIRED");

  const studies = await db
    .select({
      projectId: projects.id,
      designId: layoutVersions.id,
      title: projects.title,
      status: layoutVersions.status,
      createdAt: layoutVersions.createdAt,
      requirements: projectRequirements.inputJson,
      building: layoutVersions.layoutJson,
      validation: layoutVersions.validation,
      costEstimate: layoutVersions.costEstimate,
    })
    .from(layoutVersions)
    .innerJoin(projects, eq(layoutVersions.projectId, projects.id))
    .innerJoin(projectRequirements, eq(layoutVersions.requirementVersionId, projectRequirements.id))
    .where(eq(projects.ownerId, user.id))
    .orderBy(desc(layoutVersions.createdAt))
    .limit(12);

  return NextResponse.json({ studies });
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
  const requirements = parsed.data;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const [usage] = await db
    .select({ total: count() })
    .from(layoutVersions)
    .innerJoin(projects, eq(layoutVersions.projectId, projects.id))
    .where(and(eq(projects.ownerId, user.id), gte(layoutVersions.createdAt, today)));
  if (usage.total >= DAILY_GENERATION_LIMIT) {
    return errorResponse("Daily design-generation limit reached. Try again tomorrow.", 429, "RATE_LIMITED");
  }

  const now = new Date();
  const [created] = await db
    .insert(projects)
    .values({
      ownerId: user.id,
      title: requirements.projectName,
      description: `${requirements.floors.length}-floor detached residential concept in ${requirements.region.locality ?? requirements.region.adminArea}`,
      status: "generating",
      updatedAt: now,
    })
    .returning();

  const [requirement] = await db
    .insert(projectRequirements)
    .values({
      projectId: created.id,
      version: 1,
      inputJson: jsonRecord(requirements),
      source: "guided",
      updatedAt: now,
    })
    .returning();

  const summary = `Structured residential requirements v${requirements.requirementSchemaVersion}; ${requirements.floors.length} floor(s); ${requirements.rooms.length} requested rooms.`;
  const [layout] = await db
    .insert(layoutVersions)
    .values({
      projectId: created.id,
      requirementVersionId: requirement.id,
      version: 1,
      prompt: summary,
      status: "planning",
      updatedAt: now,
    })
    .returning();

  const [job] = await db
    .insert(generationJobs)
    .values({
      layoutVersionId: layout.id,
      kind: "design",
      provider: "brickpilot",
      idempotencyKey: crypto.randomUUID(),
      status: "processing",
      requestPayload: jsonRecord(requirements),
      startedAt: now,
      updatedAt: now,
    })
    .returning();

  try {
    const generated = generateBuilding(requirements);
    const costEstimate = estimateBuildingCost(generated.building, requirements);
    const completedAt = new Date();
    const intent = {
      requirementSchemaVersion: requirements.requirementSchemaVersion,
      buildingSchemaVersion: generated.building.buildingSchemaVersion,
      rendererVersion: generated.building.rendererVersion,
      evaluatedCandidateCount: generated.evaluatedCandidateCount,
      assumptions: [
        "Concept feasibility geometry uses rectangular planning cells and baseline residential heuristics.",
        "Validation is not permit, structural, MEP, or jurisdictional approval.",
        costEstimate.status === "available"
          ? `Cost uses ${costEstimate.selection.ratePackName} (${costEstimate.selection.ratePackVersion}).`
          : "No native regional rate pack was available; cost is intentionally unavailable.",
      ],
    };
    const response = {
      projectId: created.id,
      designId: layout.id,
      title: requirements.projectName,
      requirements,
      building: generated.building,
      validation: generated.validation,
      costEstimate,
      intent,
    };

    await db.transaction(async (transaction) => {
      await transaction
        .update(layoutVersions)
        .set({
          status: "completed",
          intent: jsonRecord(intent),
          layoutJson: jsonRecord(generated.building),
          validation: jsonRecord(generated.validation),
          costEstimate: jsonRecord(costEstimate),
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
    const generationError = error instanceof BuildingGenerationError ? error : undefined;
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
