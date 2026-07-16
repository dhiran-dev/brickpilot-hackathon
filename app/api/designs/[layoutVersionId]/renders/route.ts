import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { buildingRequirementsSchema } from "@/lib/building/requirements";
import { buildingSchema } from "@/lib/building/schema";
import { db } from "@/lib/db";
import { generatedAssets, generationJobs, layoutVersions, projectRequirements, projects } from "@/lib/db/schema";
import { persistedValidationReportSchema } from "@/lib/design/persisted-study";
import { applyReplicatePrediction, reconcileReplicateJob } from "@/lib/render/finalize-job";
import { buildRenderSpecs, type RenderPurpose, type RenderSpec } from "@/lib/render/prompts";
import { createReplicatePrediction, safePredictionPayload } from "@/lib/render/replicate";
import { decodeReferenceDataUri, storeReferenceDataUri } from "@/lib/render/storage";

const referenceRoleSchema = z.enum(["plan_reference", "massing_front", "massing_rear", "massing_iso"]);
const renderRequestSchema = z.object({
  geometryHash: z.string().min(1).max(200),
  selectedInteriorSpaceId: z.string().min(1).max(200),
  references: z.array(z.object({ role: referenceRoleSchema, dataUri: z.string().min(32).max(1_400_000) })).min(1).max(4),
}).superRefine((value, context) => {
  const roles = value.references.map((reference) => reference.role);
  if (new Set(roles).size !== roles.length) context.addIssue({ code: "custom", path: ["references"], message: "Reference roles must be unique" });
  if (!roles.includes("plan_reference")) context.addIssue({ code: "custom", path: ["references"], message: "The marked plan reference is required" });
  if (roles.length !== 1 && roles.length !== 4) context.addIssue({ code: "custom", path: ["references"], message: "Provide the plan-only fallback or the complete four-image grounding set" });
  if (roles.length === 4) {
    for (const required of referenceRoleSchema.options) if (!roles.includes(required)) context.addIssue({ code: "custom", path: ["references"], message: `Missing ${required}` });
  }
});

const MAX_BODY_BYTES = 5_900_000;
const MAX_RENDER_ATTEMPTS_PER_PURPOSE = 3;

function configuredLimit(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const DAILY_IMAGE_LIMIT = configuredLimit(process.env.RATE_LIMIT_IMAGES_PER_DAY, 20);
const GLOBAL_DAILY_AI_CAP = configuredLimit(process.env.GLOBAL_DAILY_AI_CAP, 500);

function errorResponse(message: string, status: number, code: string, details?: unknown) {
  return NextResponse.json({ error: message, code, details }, { status });
}

function purposeOf(payload: Record<string, unknown>): RenderPurpose | null {
  return payload.renderPurpose === "exterior" || payload.renderPurpose === "interior" ? payload.renderPurpose : null;
}

async function renderState(layoutVersionId: string) {
  const jobs = await db.select().from(generationJobs)
    .where(and(eq(generationJobs.layoutVersionId, layoutVersionId), eq(generationJobs.kind, "render")))
    .orderBy(generationJobs.createdAt);
  const assets = await db.select().from(generatedAssets)
    .where(and(eq(generatedAssets.layoutVersionId, layoutVersionId), eq(generatedAssets.type, "render")))
    .orderBy(generatedAssets.createdAt);
  const latestByPurpose = new Map<RenderPurpose, typeof generationJobs.$inferSelect>();
  for (const job of jobs) {
    const purpose = purposeOf(job.requestPayload);
    if (purpose) latestByPurpose.set(purpose, job);
  }
  const latestJobs = [...latestByPurpose.values()];
  const publicJobs = latestJobs.map((job) => ({
    id: job.id,
    purpose: purposeOf(job.requestPayload),
    status: job.status,
    failureReason: job.failureReason,
    createdAt: job.createdAt,
  }));
  const publicAssets = assets.map((asset, index) => ({ id: asset.id, role: asset.role, url: asset.url, contentType: asset.contentType, index }));
  const active = latestJobs.some((job) => job.status === "queued" || job.status === "processing");
  const completedExterior = assets.filter((asset) => asset.role === "exterior").length;
  const completedInterior = assets.filter((asset) => asset.role === "interior").length;
  const complete = completedExterior >= 3 && completedInterior >= 1;
  const failed = latestJobs.some((job) => job.status === "failed" || job.status === "canceled");
  const status = complete ? "completed" : active ? "processing" : assets.length > 0 ? "partial" : failed ? "failed" : "idle";
  return { status, jobs: publicJobs, assets: publicAssets };
}

async function ownedStudy(layoutVersionId: string, userId: string) {
  const [row] = await db.select({
    projectId: projects.id,
    title: projects.title,
    status: layoutVersions.status,
    version: layoutVersions.version,
    building: layoutVersions.layoutJson,
    validation: layoutVersions.validation,
    requirements: projectRequirements.inputJson,
  })
    .from(layoutVersions)
    .innerJoin(projects, eq(layoutVersions.projectId, projects.id))
    .innerJoin(projectRequirements, eq(layoutVersions.requirementVersionId, projectRequirements.id))
    .where(and(eq(layoutVersions.id, layoutVersionId), eq(projects.ownerId, userId)))
    .limit(1);
  return row;
}

export async function GET(request: Request, context: { params: Promise<{ layoutVersionId: string }> }) {
  const user = await requireUser(request);
  if (!user) return errorResponse("Authentication is required.", 401, "AUTH_REQUIRED");
  const { layoutVersionId } = await context.params;
  if (!await ownedStudy(layoutVersionId, user.id)) return errorResponse("Study not found.", 404, "STUDY_NOT_FOUND");
  const active = await db.select({ id: generationJobs.id }).from(generationJobs)
    .where(and(eq(generationJobs.layoutVersionId, layoutVersionId), eq(generationJobs.kind, "render"), inArray(generationJobs.status, ["queued", "processing"])));
  await Promise.allSettled(active.map((job) => reconcileReplicateJob(job.id)));
  return NextResponse.json(await renderState(layoutVersionId));
}

export async function POST(request: Request, context: { params: Promise<{ layoutVersionId: string }> }) {
  const user = await requireUser(request);
  if (!user) return errorResponse("Authentication is required.", 401, "AUTH_REQUIRED");
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) return errorResponse("Reference package is too large.", 413, "REFERENCE_PACKAGE_TOO_LARGE");
  const { layoutVersionId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400, "INVALID_JSON");
  }
  const parsed = renderRequestSchema.safeParse(body);
  if (!parsed.success) return errorResponse("Render references are missing or invalid.", 400, "INVALID_RENDER_REFERENCES", parsed.error.flatten());
  try {
    parsed.data.references.forEach((reference) => decodeReferenceDataUri(reference.dataUri));
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Reference image is invalid.", 400, "INVALID_REFERENCE_IMAGE");
  }

  const row = await ownedStudy(layoutVersionId, user.id);
  if (!row) return errorResponse("Study not found.", 404, "STUDY_NOT_FOUND");
  if (row.status !== "completed") return errorResponse("This study is not completed yet.", 409, "STUDY_NOT_COMPLETED");
  const building = buildingSchema.safeParse(row.building);
  const requirements = buildingRequirementsSchema.safeParse(row.requirements);
  const validation = persistedValidationReportSchema.safeParse(row.validation);
  if (!building.success || !requirements.success || !validation.success) return errorResponse("This saved study is incompatible with the render pipeline.", 409, "INCOMPATIBLE_STUDY");
  if (!validation.data.valid) return errorResponse("Resolve hard validation errors before creating concept renders.", 409, "VALIDATION_BLOCKED");
  if (parsed.data.geometryHash !== building.data.candidate.geometryHash) return errorResponse("The 3D references belong to an older geometry revision. Reload the study and capture again.", 409, "STALE_GEOMETRY");
  const selected = building.data.floors.flatMap((floor) => floor.spaces).find((space) => space.id === parsed.data.selectedInteriorSpaceId);
  if (!selected || !selected.occupied || ["parking", "circulation", "stair", "courtyard", "terrace", "balcony"].includes(selected.type)) {
    return errorResponse("Choose an occupied interior room for the furnished concept.", 400, "INVALID_INTERIOR_SPACE");
  }
  const [{ latestVersion }] = await db.select({ latestVersion: sql<number>`max(${layoutVersions.version})::integer` }).from(layoutVersions).where(eq(layoutVersions.projectId, row.projectId));
  if (Number(latestVersion) !== row.version) return errorResponse("Open the latest immutable study version before spending on renders.", 409, "STALE_STUDY_VERSION");

  const specs = buildRenderSpecs({ building: building.data, requirements: requirements.data, selectedInteriorSpaceId: selected.id, referenceCount: parsed.data.references.length });
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const packageId = crypto.randomUUID();
  let reserved: { reused: boolean; jobs: Array<typeof generationJobs.$inferSelect>; specs: RenderSpec[] };
  try {
    reserved = await db.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`brickpilot:render:${layoutVersionId}`}, 0))`);
      const existing = await transaction.select().from(generationJobs)
        .where(and(eq(generationJobs.layoutVersionId, layoutVersionId), eq(generationJobs.kind, "render")))
        .orderBy(generationJobs.createdAt);
      const active = existing.filter((job) => job.status === "queued" || job.status === "processing");
      if (active.length > 0) return { reused: true, jobs: active, specs: [] };
      const completedPurposes = new Set(existing.filter((job) => job.status === "completed").map((job) => purposeOf(job.requestPayload)).filter(Boolean));
      const missingSpecs = [specs.exterior, specs.interior].filter((spec) => !completedPurposes.has(spec.purpose));
      if (missingSpecs.length === 0) return { reused: true, jobs: existing.filter((job) => job.status === "completed"), specs: [] };
      for (const spec of missingSpecs) {
        const attempts = existing.filter((job) => purposeOf(job.requestPayload) === spec.purpose).length;
        if (attempts >= MAX_RENDER_ATTEMPTS_PER_PURPOSE) throw new Error(`RETRY_LIMIT:${spec.purpose}`);
      }
      const requestedNow = missingSpecs.reduce((sum, spec) => sum + spec.requestedOutputCount, 0);
      const [userUsage] = await transaction.select({
        outputs: sql<number>`coalesce(sum(coalesce((${generationJobs.requestPayload}->>'requestedOutputCount')::integer, 1)), 0)::integer`,
      }).from(generationJobs)
        .innerJoin(layoutVersions, eq(generationJobs.layoutVersionId, layoutVersions.id))
        .innerJoin(projects, eq(layoutVersions.projectId, projects.id))
        .where(and(eq(projects.ownerId, user.id), eq(generationJobs.kind, "render"), gte(generationJobs.createdAt, dayStart)));
      const [globalUsage] = await transaction.select({
        outputs: sql<number>`coalesce(sum(coalesce((${generationJobs.requestPayload}->>'requestedOutputCount')::integer, 1)), 0)::integer`,
      }).from(generationJobs).where(and(eq(generationJobs.kind, "render"), gte(generationJobs.createdAt, dayStart)));
      if (Number(userUsage?.outputs ?? 0) + requestedNow > DAILY_IMAGE_LIMIT) throw new Error("USER_IMAGE_LIMIT");
      if (Number(globalUsage?.outputs ?? 0) + requestedNow > GLOBAL_DAILY_AI_CAP) throw new Error("GLOBAL_IMAGE_LIMIT");
      const jobs: Array<typeof generationJobs.$inferSelect> = [];
      for (const spec of missingSpecs) {
        const [job] = await transaction.insert(generationJobs).values({
          layoutVersionId,
          kind: "render",
          provider: "replicate",
          idempotencyKey: `render:${layoutVersionId}:${packageId}:${spec.purpose}`,
          status: "queued",
          requestPayload: {
            packageId,
            renderPurpose: spec.purpose,
            requestedOutputCount: spec.requestedOutputCount,
            geometryHash: building.data.candidate.geometryHash,
            selectedInteriorSpaceId: selected.id,
            referenceRoles: parsed.data.references.map((reference) => reference.role),
            prompt: spec.prompt,
          },
          updatedAt: now,
        }).returning();
        jobs.push(job);
      }
      return { reused: false, jobs, specs: missingSpecs };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "RENDER_RESERVATION_FAILED";
    if (message.startsWith("RETRY_LIMIT:")) return errorResponse(`The ${message.split(":")[1]} render reached its retry limit.`, 409, "RENDER_RETRY_LIMIT");
    if (message === "USER_IMAGE_LIMIT") return errorResponse("Daily image limit reached. Try again tomorrow.", 429, "IMAGE_RATE_LIMITED");
    if (message === "GLOBAL_IMAGE_LIMIT") return errorResponse("The global image budget is paused for today.", 503, "GLOBAL_IMAGE_CAP_REACHED");
    console.error("Render reservation failed", error);
    return errorResponse("Unable to reserve this render package safely.", 500, "RENDER_RESERVATION_FAILED");
  }
  if (reserved.reused) return NextResponse.json(await renderState(layoutVersionId));

  try {
    const stored = await Promise.all(parsed.data.references.map((reference) => storeReferenceDataUri(
      reference.dataUri,
      `sources/${layoutVersionId}/${packageId}/${reference.role}.webp`,
    )));
    await db.transaction(async (transaction) => {
      for (const [index, asset] of stored.entries()) {
        await transaction.insert(generatedAssets).values({
          projectId: row.projectId,
          layoutVersionId,
          type: "source",
          role: parsed.data.references[index].role,
          provider: "brickpilot",
          status: "completed",
          storageKey: asset.storageKey,
          url: asset.url,
          contentType: asset.contentType,
        }).onConflictDoNothing();
      }
    });
  } catch (error) {
    const failedAt = new Date();
    await db.update(generationJobs).set({ status: "failed", failureReason: `Reference storage failed: ${error instanceof Error ? error.message : "unknown error"}`, completedAt: failedAt, updatedAt: failedAt })
      .where(inArray(generationJobs.id, reserved.jobs.map((job) => job.id)));
    return errorResponse("The geometry references could not be stored, so nothing was sent to GPT Image 2.", 502, "REFERENCE_STORAGE_FAILED");
  }

  for (const job of reserved.jobs) {
    const purpose = purposeOf(job.requestPayload);
    const spec = reserved.specs.find((candidate) => candidate.purpose === purpose);
    if (!spec) continue;
    try {
      const prediction = await createReplicatePrediction(spec, parsed.data.references.map((reference) => reference.dataUri));
      const startedAt = new Date();
      await db.update(generationJobs).set({
        providerJobId: prediction.id,
        status: "processing",
        responsePayload: safePredictionPayload(prediction) as Record<string, unknown>,
        startedAt,
        updatedAt: startedAt,
      }).where(eq(generationJobs.id, job.id));
      await applyReplicatePrediction(job.id, prediction);
    } catch (error) {
      const failedAt = new Date();
      await db.update(generationJobs).set({ status: "failed", failureReason: error instanceof Error ? error.message : "Replicate create failed", completedAt: failedAt, updatedAt: failedAt })
        .where(and(eq(generationJobs.id, job.id), inArray(generationJobs.status, ["queued", "processing"])));
    }
  }
  return NextResponse.json(await renderState(layoutVersionId), { status: 202 });
}
