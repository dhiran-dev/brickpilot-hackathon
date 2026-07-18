import { and, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { buildingRequirementsContractVersion, readableBuildingRequirementsSchema } from "@/lib/building/requirements";
import { buildingContractVersion, readableBuildingSchema } from "@/lib/building/schema";
import { db } from "@/lib/db";
import { generatedAssets, generationJobs, layoutVersions, projectRequirements, projects } from "@/lib/db/schema";
import { readablePersistedValidationReportSchema } from "@/lib/design/persisted-study";
import { dispatchRenderSpecs, isSupportedRenderContractVersion, renderEligibleInteriorSpace, type VersionedRenderSpec } from "@/lib/render/dispatch";
import { CURRENT_PROMPT_VERSION, type CurrentRenderSpec } from "@/lib/render/current-prompts";
import { applyReplicatePrediction, reconcileReplicateJob, renderJobMatchesCanonical } from "@/lib/render/finalize-job";
import { claimAndArmProviderDispatch, createAndAttachProviderPrediction, ProviderAcceptedBeforeAttachError } from "@/lib/render/provider-dispatch";
import { buildRenderSpecs, isRenderPurpose, RENDER_CONTRACT_VERSION, RENDER_PURPOSES, type RenderPurpose, type RenderSpec } from "@/lib/render/prompts";
import { cancelReplicatePrediction, createReplicatePrediction, ReplicateCreateAmbiguousError, replicateModelVersion, replicateWebhookUrl } from "@/lib/render/replicate";
import { compensateStoredAssets, decodeReferenceDataUri, settleAssetWrites, sha256Hex, storeReferenceDataUri } from "@/lib/render/storage";
import { ACTIVE_GENERATION_STATUSES, lockProjectLifecycle } from "@/lib/server/project-lifecycle";
import { emitProjectMutationDenial, projectMutationDenial } from "@/lib/server/project-capabilities";
import { armProviderDispatch, attachProviderPredictionByDispatchToken, claimProviderDispatch, drainStaleDispatchClaims } from "@/lib/server/render-dispatch";

const referenceRoleSchema = z.enum(["plan_reference", "massing_front", "massing_collage", "massing_top"]);
const renderRequestSchema = z.object({
  geometryHash: z.string().min(1).max(200),
  schemeId: z.string().min(1).max(200).nullable(),
  selectedInteriorSpaceId: z.string().min(1).max(200),
  references: z.array(z.object({ role: referenceRoleSchema, dataUri: z.string().min(32).max(1_400_000) })).min(1).max(4),
}).superRefine((value, context) => {
  const roles = value.references.map((reference) => reference.role);
  if (new Set(roles).size !== roles.length) context.addIssue({ code: "custom", path: ["references"], message: "Reference roles must be unique" });
  if (!roles.includes("plan_reference")) context.addIssue({ code: "custom", path: ["references"], message: "The marked plan reference is required" });
  if (roles.length !== 4) context.addIssue({ code: "custom", path: ["references"], message: "Provide the complete four-image grounding set" });
  for (const required of referenceRoleSchema.options) if (!roles.includes(required)) context.addIssue({ code: "custom", path: ["references"], message: `Missing ${required}` });
});

const MAX_BODY_BYTES = 5_900_000;
const MAX_RENDER_ATTEMPTS_PER_PURPOSE = 3;

export function canonicalizeRenderReferences(references: Array<z.infer<typeof renderRequestSchema>["references"][number]>) {
  const referencesByRole = new Map(references.map((reference) => [reference.role, reference]));
  return referenceRoleSchema.options.map((role) => referencesByRole.get(role)).filter((reference): reference is NonNullable<typeof reference> => Boolean(reference));
}

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
  return isSupportedRenderContractVersion(payload.renderContractVersion) && isRenderPurpose(payload.renderPurpose) ? payload.renderPurpose : null;
}

function isCurrentRenderSpec(spec: VersionedRenderSpec): spec is CurrentRenderSpec {
  return "promptVersion" in spec && spec.promptVersion === CURRENT_PROMPT_VERSION;
}

export function renderJobBelongsToScheme(payload: Record<string, unknown>, selectedSchemeId: string | null, geometryHash: string | null) {
  return renderJobMatchesCanonical(payload, selectedSchemeId, geometryHash);
}

export function renderSourceStoragePrefix(layoutVersionId: string, payload: Record<string, unknown>) {
  const packageId = typeof payload.packageId === "string" ? payload.packageId : "";
  const rawBinding = typeof payload.schemeId === "string" ? payload.schemeId : `legacy-${String(payload.geometryHash ?? "unknown")}`;
  const binding = rawBinding.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `sources/${layoutVersionId}/${binding}/${packageId}/`;
}

function renderContractLockKey(layoutVersionId: string) {
  return `brickpilot:render-contract:${layoutVersionId}`;
}

export async function renderState(layoutVersionId: string) {
  const [layout] = await db.select({ selectedSchemeId: layoutVersions.selectedSchemeId, building: layoutVersions.layoutJson })
    .from(layoutVersions).where(eq(layoutVersions.id, layoutVersionId)).limit(1);
  const canonicalBuilding = readableBuildingSchema.safeParse(layout?.building);
  const geometryHash = canonicalBuilding.success ? canonicalBuilding.data.candidate.geometryHash : null;
  const jobs = await db.select().from(generationJobs)
    .where(and(eq(generationJobs.layoutVersionId, layoutVersionId), eq(generationJobs.kind, "render")))
    .orderBy(generationJobs.createdAt);
  const userJobs = jobs.filter((job) => job.requestPayload.releaseEvalBatch !== true);
  const assets = await db.select().from(generatedAssets)
    .where(eq(generatedAssets.layoutVersionId, layoutVersionId))
    .orderBy(generatedAssets.createdAt);
  const latestByPurpose = new Map<RenderPurpose, typeof generationJobs.$inferSelect>();
  for (const job of userJobs) {
    if (!renderJobBelongsToScheme(job.requestPayload, layout?.selectedSchemeId ?? null, geometryHash)) continue;
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
    schemeDisposition: "current" as const,
  }));
  const requiredRoles = new Set<string>(RENDER_PURPOSES);
  const currentProviderJobIds = new Set(latestJobs.map((job) => job.providerJobId).filter((id): id is string => Boolean(id)));
  const currentAssets = assets.filter((asset) => asset.type === "render" && requiredRoles.has(asset.role) && Boolean(asset.providerJobId) && currentProviderJobIds.has(asset.providerJobId!));
  const publicAssets = currentAssets.map((asset, index) => {
    const job = latestJobs.find((candidate) => candidate.providerJobId === asset.providerJobId);
    return { id: asset.id, role: asset.role, url: asset.url, contentType: asset.contentType, index, schemeId: typeof job?.requestPayload.schemeId === "string" ? job.requestPayload.schemeId : null };
  });
  const previousJobs = userJobs.filter((job) => !renderJobBelongsToScheme(job.requestPayload, layout?.selectedSchemeId ?? null, geometryHash));
  const previousProviderJobIds = new Set(previousJobs.map((job) => job.providerJobId).filter((id): id is string => Boolean(id)));
  const previousAssets = assets
    .filter((asset) => asset.type === "render" && Boolean(asset.providerJobId) && previousProviderJobIds.has(asset.providerJobId!))
    .map((asset, index) => {
      const job = previousJobs.find((candidate) => candidate.providerJobId === asset.providerJobId);
      return {
        id: asset.id,
        role: asset.role,
        url: asset.url,
        contentType: asset.contentType,
        index,
        schemeId: typeof job?.requestPayload.schemeId === "string" ? job.requestPayload.schemeId : null,
        schemeDisposition: "previous" as const,
      };
    });
  const latestSourceByRole = new Map<string, typeof generatedAssets.$inferSelect>();
  const currentSourcePrefixes = latestJobs.flatMap((job) => {
    const prefixes = [renderSourceStoragePrefix(layoutVersionId, job.requestPayload)];
    // Read-only migration exemption for source assets created before scheme-bound paths.
    if (job.requestPayload.schemeId == null && typeof job.requestPayload.packageId === "string") {
      prefixes.push(`sources/${layoutVersionId}/${job.requestPayload.packageId}/`);
    }
    return prefixes;
  });
  for (const asset of assets.filter((candidate) => candidate.type === "source")) {
    const belongsToCurrentPackage = currentSourcePrefixes.some((prefix) => asset.storageKey.startsWith(prefix));
    if (belongsToCurrentPackage) latestSourceByRole.set(asset.role, asset);
  }
  const publicSources = [...latestSourceByRole.values()].map((asset) => ({ id: asset.id, role: asset.role, url: asset.url, contentType: asset.contentType }));
  const active = latestJobs.some((job) => ACTIVE_GENERATION_STATUSES.includes(job.status as typeof ACTIVE_GENERATION_STATUSES[number]));
  const completedRoles = new Set(currentAssets.map((asset) => asset.role));
  const complete = RENDER_PURPOSES.every((purpose) => completedRoles.has(purpose));
  const failed = latestJobs.some((job) => job.status === "failed" || job.status === "canceled");
  const status = complete ? "completed" : active ? "processing" : currentAssets.length > 0 ? "partial" : failed ? "failed" : "idle";
  return { status, jobs: publicJobs, assets: publicAssets, previousAssets, sources: publicSources };
}

async function ownedStudy(layoutVersionId: string, userId: string) {
  const [row] = await db.select({
    projectId: projects.id,
    projectStatus: projects.status,
    capabilityProfile: projects.capabilityProfile,
    title: projects.title,
    status: layoutVersions.status,
    version: layoutVersions.version,
    building: layoutVersions.layoutJson,
    validation: layoutVersions.validation,
    requirements: projectRequirements.inputJson,
    selectedSchemeId: layoutVersions.selectedSchemeId,
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
  const row = await ownedStudy(layoutVersionId, user.id);
  if (!row) return errorResponse("Study not found.", 404, "STUDY_NOT_FOUND");
  const building = readableBuildingSchema.safeParse(row.building);
  await drainStaleDispatchClaims(layoutVersionId);
  const activeJobs = await db.select().from(generationJobs)
    .where(and(eq(generationJobs.layoutVersionId, layoutVersionId), eq(generationJobs.kind, "render"), inArray(generationJobs.status, [...ACTIVE_GENERATION_STATUSES])));
  const active = activeJobs.filter((job) => renderJobBelongsToScheme(job.requestPayload, row.selectedSchemeId, building.success ? building.data.candidate.geometryHash : null));
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
  const referenceChecksums = new Map<string, string>();
  try {
    parsed.data.references.forEach((reference) => referenceChecksums.set(reference.role, sha256Hex(decodeReferenceDataUri(reference.dataUri).bytes)));
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Reference image is invalid.", 400, "INVALID_REFERENCE_IMAGE");
  }
  const orderedReferences = canonicalizeRenderReferences(parsed.data.references);
  const referencesByRole = new Map(orderedReferences.map((reference) => [reference.role, reference]));

  const row = await ownedStudy(layoutVersionId, user.id);
  if (!row) return errorResponse("Study not found.", 404, "STUDY_NOT_FOUND");
  await drainStaleDispatchClaims(layoutVersionId);
  const preflightDenial = projectMutationDenial(row.capabilityProfile, row.projectStatus, "canGenerateRender");
  if (preflightDenial) {
    emitProjectMutationDenial({ projectId: row.projectId, layoutVersionId, capability: "canGenerateRender", profile: row.capabilityProfile, status: row.projectStatus, phase: "preflight", code: preflightDenial.code });
    return errorResponse(preflightDenial.message, 409, preflightDenial.code);
  }
  if (row.status !== "completed") return errorResponse("This study is not completed yet.", 409, "STUDY_NOT_COMPLETED");
  const building = readableBuildingSchema.safeParse(row.building);
  const requirements = readableBuildingRequirementsSchema.safeParse(row.requirements);
  const validation = readablePersistedValidationReportSchema.safeParse(row.validation);
  if (!building.success || !requirements.success || !validation.success) return errorResponse("This saved study is incompatible with the render pipeline.", 409, "INCOMPATIBLE_STUDY");
  if (buildingContractVersion(building.data) !== buildingRequirementsContractVersion(requirements.data)
    || buildingContractVersion(building.data) !== ("schemaVersion" in validation.data ? "v3" : "v2")) {
    return errorResponse("This saved study mixes incompatible contract versions.", 409, "INCOMPATIBLE_STUDY");
  }
  if (!validation.data.valid) return errorResponse("Resolve hard validation errors before creating concept renders.", 409, "VALIDATION_BLOCKED");
  if (parsed.data.schemeId !== row.selectedSchemeId) return errorResponse("The reference package belongs to a different selected scheme. Reload the study and capture again.", 409, "STALE_SCHEME");
  if (parsed.data.geometryHash !== building.data.candidate.geometryHash) return errorResponse("The 3D references belong to an older geometry revision. Reload the study and capture again.", 409, "STALE_GEOMETRY");
  const selected = renderEligibleInteriorSpace(building.data, parsed.data.selectedInteriorSpaceId);
  if (!selected) {
    return errorResponse("Choose an occupied interior room for the furnished concept.", 400, "INVALID_INTERIOR_SPACE");
  }
  const [{ latestVersion }] = await db.select({ latestVersion: sql<number>`max(${layoutVersions.version})::integer` }).from(layoutVersions).where(eq(layoutVersions.projectId, row.projectId));
  if (Number(latestVersion) !== row.version) return errorResponse("Open the latest immutable study version before spending on renders.", 409, "STALE_STUDY_VERSION");

  const dispatch = dispatchRenderSpecs({ building: building.data, requirements: requirements.data, selectedInteriorSpaceId: selected.id });
  const specs = dispatch.specs;
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const packageId = crypto.randomUUID();
  let reserved: { reused: boolean; sourcesReady?: boolean; jobs: Array<typeof generationJobs.$inferSelect>; specs: VersionedRenderSpec[]; binding: { schemeId: string | null; geometryHash: string; buildingSchemaVersion: 2 | 3; renderContractVersion: 2 | 3 } };
  try {
    reserved = await db.transaction(async (transaction) => {
      await lockProjectLifecycle(transaction, row.projectId);
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${renderContractLockKey(layoutVersionId)}, 0))`);
      const [projectState] = await transaction
        .select({ status: projects.status, capabilityProfile: projects.capabilityProfile })
        .from(projects)
        .where(and(eq(projects.id, row.projectId), eq(projects.ownerId, user.id)))
        .limit(1);
      if (!projectState) throw new Error("PROJECT_STATE_CHANGED");
      const denial = projectMutationDenial(projectState.capabilityProfile, projectState.status, "canGenerateRender");
      if (denial) {
        emitProjectMutationDenial({ projectId: row.projectId, layoutVersionId, capability: "canGenerateRender", profile: projectState.capabilityProfile, status: projectState.status, phase: "transaction_recheck", code: denial.code });
        throw new Error(denial.code);
      }
      const [currentLayout] = await transaction.select({
        selectedSchemeId: layoutVersions.selectedSchemeId,
        building: layoutVersions.layoutJson,
      }).from(layoutVersions).where(eq(layoutVersions.id, layoutVersionId)).limit(1);
      const currentBuilding = readableBuildingSchema.safeParse(currentLayout?.building);
      if (!currentBuilding.success || currentBuilding.data.candidate.geometryHash !== parsed.data.geometryHash) throw new Error("STALE_GEOMETRY");
      if (currentBuilding.data.buildingSchemaVersion !== dispatch.buildingSchemaVersion) throw new Error("STALE_GEOMETRY");
      const selectedSchemeId = currentLayout?.selectedSchemeId ?? null;
      if (selectedSchemeId !== parsed.data.schemeId) throw new Error("STALE_SCHEME");
      const binding = {
        schemeId: selectedSchemeId,
        geometryHash: currentBuilding.data.candidate.geometryHash,
        buildingSchemaVersion: dispatch.buildingSchemaVersion,
        renderContractVersion: dispatch.renderContractVersion,
      };
      const existing = await transaction.select().from(generationJobs)
        .where(and(eq(generationJobs.layoutVersionId, layoutVersionId), eq(generationJobs.kind, "render")))
        .orderBy(generationJobs.createdAt);
      // Internal five-sample release evidence is isolated from the user's render package and
      // retry budget. It still remains a lifecycle-active render for deletion/scheme locking.
      const currentExisting = existing.filter((job) => job.requestPayload.releaseEvalBatch !== true
        && renderJobBelongsToScheme(job.requestPayload, selectedSchemeId, currentBuilding.data.candidate.geometryHash));
      const active = currentExisting.filter((job) => ACTIVE_GENERATION_STATUSES.includes(job.status as typeof ACTIVE_GENERATION_STATUSES[number]));
      const recovered = active.filter((job) => job.status === "queued" && job.dispatchState === "reserved" && job.dispatchToken && !job.providerJobId);
      if (recovered.length > 0) {
        const recoveredPurposes = new Set(recovered.map((job) => purposeOf(job.requestPayload)).filter(Boolean));
        return { reused: false, sourcesReady: true, jobs: recovered, specs: specs.filter((spec) => recoveredPurposes.has(spec.purpose)), binding };
      }
      if (active.length > 0) return { reused: true, jobs: active, specs: [], binding };
      const completedPurposes = new Set(currentExisting.filter((job) => job.status === "completed").map((job) => purposeOf(job.requestPayload)).filter(Boolean));
      const missingSpecs = specs.filter((spec) => !completedPurposes.has(spec.purpose));
      if (missingSpecs.length === 0) return { reused: true, jobs: currentExisting.filter((job) => job.status === "completed"), specs: [], binding };
      for (const spec of missingSpecs) {
        const attempts = currentExisting.filter((job) => purposeOf(job.requestPayload) === spec.purpose
          && (job.dispatchToken == null || job.dispatchAttemptedAt != null)).length;
        if (attempts >= MAX_RENDER_ATTEMPTS_PER_PURPOSE) throw new Error(`RETRY_LIMIT:${spec.purpose}`);
      }
      const requestedNow = missingSpecs.reduce((sum, spec) => sum + spec.requestedOutputCount, 0);
      const [userUsage] = await transaction.select({
        outputs: sql<number>`coalesce(sum(coalesce((${generationJobs.requestPayload}->>'requestedOutputCount')::integer, 1)), 0)::integer`,
      }).from(generationJobs)
        .innerJoin(layoutVersions, eq(generationJobs.layoutVersionId, layoutVersions.id))
        .innerJoin(projects, eq(layoutVersions.projectId, projects.id))
        .where(and(
          eq(projects.ownerId, user.id),
          eq(generationJobs.kind, "render"),
          gte(generationJobs.createdAt, dayStart),
          sql`coalesce(${generationJobs.requestPayload}->>'releaseEvalBatch', 'false') <> 'true'`,
          or(isNull(generationJobs.dispatchToken), sql`${generationJobs.dispatchAttemptedAt} is not null`),
        ));
      const [globalUsage] = await transaction.select({
        outputs: sql<number>`coalesce(sum(coalesce((${generationJobs.requestPayload}->>'requestedOutputCount')::integer, 1)), 0)::integer`,
      }).from(generationJobs).where(and(
        eq(generationJobs.kind, "render"),
        gte(generationJobs.createdAt, dayStart),
        sql`coalesce(${generationJobs.requestPayload}->>'releaseEvalBatch', 'false') <> 'true'`,
        or(isNull(generationJobs.dispatchToken), sql`${generationJobs.dispatchAttemptedAt} is not null`),
      ));
      if (Number(userUsage?.outputs ?? 0) + requestedNow > DAILY_IMAGE_LIMIT) throw new Error("USER_IMAGE_LIMIT");
      if (Number(globalUsage?.outputs ?? 0) + requestedNow > GLOBAL_DAILY_AI_CAP) throw new Error("GLOBAL_IMAGE_LIMIT");
      const jobs: Array<typeof generationJobs.$inferSelect> = [];
      const sourcePrefix = renderSourceStoragePrefix(layoutVersionId, {
        packageId,
        schemeId: binding.schemeId ?? undefined,
        geometryHash: binding.geometryHash,
      });
      for (const spec of missingSpecs) {
        const sourceStorageKey = `${sourcePrefix}${spec.sourceRole}.webp`;
        const currentSpec = binding.buildingSchemaVersion === 3 && isCurrentRenderSpec(spec) ? spec : null;
        const dispatchToken = crypto.randomUUID();
        const [job] = await transaction.insert(generationJobs).values({
          layoutVersionId,
          kind: "render",
          provider: "replicate",
          dispatchToken,
          dispatchState: "reserved",
          idempotencyKey: `render:${layoutVersionId}:${packageId}:${spec.purpose}`,
          status: "queued",
          requestPayload: {
            packageId,
            renderContractVersion: binding.renderContractVersion,
            renderPurpose: spec.purpose,
            requestedOutputCount: spec.requestedOutputCount,
            geometryHash: binding.geometryHash,
            schemeId: selectedSchemeId ?? undefined,
            selectedInteriorSpaceId: selected.id,
            referenceRoles: [spec.sourceRole],
            prompt: spec.prompt,
            ...(currentSpec ? {
              buildingSchemaVersion: 3,
              providerModelVersion: replicateModelVersion(),
              promptVersion: currentSpec.promptVersion,
              semanticView: currentSpec.semanticView,
              semanticCamera: currentSpec.semanticCamera,
              geometryLock: currentSpec.geometryLock,
              releaseEvalTarget: currentSpec.releaseEvalTarget,
              inputReferences: [{
                role: spec.sourceRole,
                storageKey: sourceStorageKey,
                checksum: referenceChecksums.get(spec.sourceRole),
              }],
            } : {}),
          },
          updatedAt: now,
        }).returning();
        jobs.push(job);
      }
      for (const reference of orderedReferences) {
        const storageKey = `${sourcePrefix}${reference.role}.webp`;
        await transaction.insert(generatedAssets).values({
          projectId: row.projectId,
          layoutVersionId,
          type: "source",
          role: reference.role,
          provider: "brickpilot",
          status: "finalizing",
          storageKey,
          url: `/api/assets/${storageKey.split("/").map(encodeURIComponent).join("/")}`,
          contentType: "application/octet-stream",
        }).onConflictDoNothing();
      }
      return { reused: false, jobs, specs: missingSpecs, binding };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "RENDER_RESERVATION_FAILED";
    if (message.startsWith("RETRY_LIMIT:")) return errorResponse(`The ${message.split(":")[1]} render reached its retry limit.`, 409, "RENDER_RETRY_LIMIT");
    if (message === "STALE_SCHEME") return errorResponse("The selected scheme changed before render reservation. Reload and capture the references again.", 409, "STALE_SCHEME");
    if (message === "STALE_GEOMETRY") return errorResponse("The selected scheme changed before render reservation. Reload and capture the references again.", 409, "STALE_GEOMETRY");
    if (message === "PROJECT_VIEW_ONLY") return errorResponse("This legacy project is view-only. Its saved results remain available.", 409, "PROJECT_VIEW_ONLY");
    if (message === "PROJECT_DELETING") return errorResponse("This project is being deleted.", 409, "PROJECT_DELETING");
    if (message === "PROJECT_NOT_READY" || message === "PROJECT_STATE_CHANGED") return errorResponse("This project is not ready for rendering.", 409, "PROJECT_NOT_READY");
    if (message === "USER_IMAGE_LIMIT") return errorResponse("Daily image limit reached. Try again tomorrow.", 429, "IMAGE_RATE_LIMITED");
    if (message === "GLOBAL_IMAGE_LIMIT") return errorResponse("The global image budget is paused for today.", 503, "GLOBAL_IMAGE_CAP_REACHED");
    console.error("Render reservation failed", error);
    return errorResponse("Unable to reserve this render package safely.", 500, "RENDER_RESERVATION_FAILED");
  }
  if (reserved.reused) return NextResponse.json(await renderState(layoutVersionId));

  if (!reserved.sourcesReady) {
    const sourcePrefix = renderSourceStoragePrefix(layoutVersionId, {
    packageId,
    schemeId: reserved.binding.schemeId ?? undefined,
    geometryHash: reserved.binding.geometryHash,
  });
    const sourceKeys = orderedReferences.map((reference) => `${sourcePrefix}${reference.role}.webp`);
    const sourceWrites = await settleAssetWrites(orderedReferences.map((reference, index) => () => (
      storeReferenceDataUri(reference.dataUri, sourceKeys[index])
    )));
    try {
    if (sourceWrites.failures.length > 0) throw new Error(`${sourceWrites.failures.length} reference upload(s) failed`);
    await db.transaction(async (transaction) => {
      await lockProjectLifecycle(transaction, row.projectId);
      const [projectState] = await transaction.select({ status: projects.status }).from(projects)
        .where(eq(projects.id, row.projectId)).limit(1);
      if (!projectState || projectState.status === "deleting") throw new Error("PROJECT_DELETING_AFTER_REFERENCE_UPLOAD");
      for (const { value: asset } of sourceWrites.stored) {
        await transaction.update(generatedAssets).set({
          status: "completed",
          url: asset.url,
          contentType: asset.contentType,
        }).where(eq(generatedAssets.storageKey, asset.storageKey));
      }
    });
    } catch (error) {
    await compensateStoredAssets(sourceWrites.stored.map((item) => item.value));
    await db.update(generatedAssets).set({ status: "failed" })
      .where(inArray(generatedAssets.storageKey, sourceKeys));
    const failedAt = new Date();
    await db.update(generationJobs).set({ status: "failed", failureReason: `Reference storage failed: ${error instanceof Error ? error.message : "unknown error"}`, completedAt: failedAt, updatedAt: failedAt })
      .where(inArray(generationJobs.id, reserved.jobs.map((job) => job.id)));
      return errorResponse("The geometry references could not be stored, so nothing was sent to GPT Image 2.", 502, "REFERENCE_STORAGE_FAILED");
    }
  }

  for (const job of reserved.jobs) {
    const purpose = purposeOf(job.requestPayload);
    const spec = reserved.specs.find((candidate) => candidate.purpose === purpose);
    if (!spec) continue;
    try {
      const source = referencesByRole.get(spec.sourceRole);
      if (!source) throw new Error(`Required render source ${spec.sourceRole} is missing`);
      const armed = await claimAndArmProviderDispatch({
        claim: () => claimProviderDispatch(row.projectId, job.id),
        arm: (claim) => claim.leaseToken
          ? armProviderDispatch(row.projectId, job.id, claim.leaseToken)
          : Promise.resolve(null),
      });
      if (!armed?.dispatchToken) continue;
      // Only the pre-attempt `claimed` state is safe to expire. `armProviderDispatch` commits
      // provider-pending evidence before fetch, so ambiguous outcomes are never redriven.
      const prediction = await createAndAttachProviderPrediction({
        create: () => createReplicatePrediction(spec, [source.dataUri], { dispatchToken: armed.dispatchToken! }),
        attach: async (created) => {
          const attached = await attachProviderPredictionByDispatchToken(armed.dispatchToken!, created);
          if (!attached?.attached) throw new Error("PROVIDER_DISPATCH_ATTACHMENT_REJECTED");
        },
      });
      await applyReplicatePrediction(job.id, prediction);
    } catch (error) {
      if (error instanceof ProviderAcceptedBeforeAttachError) {
        const dispatchToken = job.dispatchToken;
        // Public deployments recover through the signed tokenized webhook. Local/non-webhook
        // environments cannot do so after request loss, therefore cancel the accepted provider
        // work instead of leaving an untracked paid prediction running.
        if (dispatchToken && !replicateWebhookUrl(dispatchToken)) {
          try {
            const canceled = await cancelReplicatePrediction(error.prediction.id);
            const terminal = canceled.prediction ?? { ...error.prediction, status: "canceled" as const, output: null };
            await attachProviderPredictionByDispatchToken(dispatchToken, terminal);
            await applyReplicatePrediction(job.id, terminal);
          } catch (recoveryError) {
            console.error("Unable to cancel a provider prediction after dispatch attachment failed", recoveryError);
          }
        }
        console.error("Provider prediction accepted; awaiting durable webhook attachment", {
          generationJobId: job.id,
          providerJobId: error.prediction.id,
        });
        continue;
      }
      if (error instanceof ReplicateCreateAmbiguousError && job.dispatchToken && replicateWebhookUrl(job.dispatchToken)) {
        console.error("Replicate create outcome is ambiguous; awaiting durable webhook recovery", { generationJobId: job.id });
        continue;
      }
      const failedAt = new Date();
      await db.update(generationJobs).set({
        status: "failed",
        dispatchState: "failed",
        dispatchLeaseToken: null,
        dispatchLeaseAcquiredAt: null,
        failureReason: error instanceof Error ? error.message : "Replicate create failed",
        completedAt: failedAt,
        updatedAt: failedAt,
      })
        .where(and(eq(generationJobs.id, job.id), inArray(generationJobs.status, [...ACTIVE_GENERATION_STATUSES])));
    }
  }
  return NextResponse.json(await renderState(layoutVersionId), { status: 202 });
}
