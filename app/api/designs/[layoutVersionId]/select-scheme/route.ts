import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { reviewBuilding } from "@/lib/ai/architectural-review";
import type { ArchitecturalReviewResult } from "@/lib/ai/schema";
import { requireUser } from "@/lib/auth";
import { buildingRequirementsSchema } from "@/lib/building/requirements";
import { estimateBuildingCost } from "@/lib/cost";
import type { CostEstimate } from "@/lib/cost/schema";
import { db } from "@/lib/db";
import { generationJobs, layoutVersions, projectRequirements, projects } from "@/lib/db/schema";
import { persistedSchemeSchema, type PersistedScheme } from "@/lib/design/persisted-study";

const requestSchema = z.object({ schemeId: z.string().min(1).max(200) });

function errorResponse(message: string, status: number, code: string) {
  return NextResponse.json({ error: message, code }, { status });
}

function jsonRecord(value: unknown) {
  return value as Record<string, unknown>;
}

function renderContractLockKey(layoutVersionId: string) {
  return `brickpilot:render-contract:${layoutVersionId}`;
}

export function resolveSchemeSelection(schemes: unknown, selectedSchemeId: string | null, requestedSchemeId: string):
  | { status: "invalid-payload" }
  | { status: "not-found" }
  | { status: "unchanged"; scheme: PersistedScheme }
  | { status: "changed"; scheme: PersistedScheme } {
  const parsed = z.array(persistedSchemeSchema).min(1).max(3).safeParse(schemes);
  if (!parsed.success) return { status: "invalid-payload" };
  const scheme = parsed.data.find((candidate) => candidate.schemeId === requestedSchemeId);
  if (!scheme) return { status: "not-found" };
  return { status: selectedSchemeId === requestedSchemeId ? "unchanged" : "changed", scheme };
}

export function hasFinalizedRenderConflict(finalizedRenderCount: number, force: boolean) {
  return finalizedRenderCount > 0 && !force;
}

type RenderSelectionJob = { id?: string; status: "queued" | "processing" | "completed" | string; requestPayload: Record<string, unknown> };

export function evaluateRenderSelection(jobs: readonly RenderSelectionJob[], currentSchemeId: string | null, force: boolean) {
  const current = jobs.filter((job) => (
    job.requestPayload.schemeDisposition !== "previous"
    && job.requestPayload.schemeId === currentSchemeId
  ));
  const active = current.filter((job) => job.status === "queued" || job.status === "processing");
  const completed = current.filter((job) => job.status === "completed");
  return {
    active,
    completed,
    decision: active.length > 0
      ? "active-render-conflict" as const
      : hasFinalizedRenderConflict(completed.length, force)
        ? "render-conflict" as const
        : "proceed" as const,
  };
}

export function buildCanonicalSchemeMirror(
  scheme: PersistedScheme,
  costEstimate: CostEstimate,
  aiReview: ArchitecturalReviewResult,
  priorIntent: Record<string, unknown> | null,
) {
  const intent = {
    ...(priorIntent ?? {}),
    selectedSchemeId: scheme.schemeId,
    drawingCacheRevision: `${scheme.schemeId}:${scheme.building.candidate.geometryHash}`,
  };
  return {
    selectedSchemeId: scheme.schemeId,
    layoutJson: scheme.building,
    validation: scheme.validation,
    costEstimate,
    aiReview,
    intent,
  };
}

export async function POST(request: Request, context: { params: Promise<{ layoutVersionId: string }> }) {
  const user = await requireUser(request);
  if (!user) return errorResponse("Authentication is required.", 401, "AUTH_REQUIRED");
  const { layoutVersionId } = await context.params;
  return selectSchemeForOwner(request, layoutVersionId, user.id);
}

export async function selectSchemeForOwner(
  request: Request,
  layoutVersionId: string,
  ownerId: string,
  options: { review?: typeof reviewBuilding } = {},
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400, "INVALID_JSON");
  }
  const parsedRequest = requestSchema.safeParse(body);
  if (!parsedRequest.success) return errorResponse("schemeId is required.", 400, "INVALID_SCHEME_SELECTION");
  const force = new URL(request.url).searchParams.get("force") === "true";

  const [row] = await db.select({
    projectId: projects.id,
    title: projects.title,
    version: layoutVersions.version,
    status: layoutVersions.status,
    requirements: projectRequirements.inputJson,
    schemes: layoutVersions.schemes,
    selectedSchemeId: layoutVersions.selectedSchemeId,
    intent: layoutVersions.intent,
  })
    .from(layoutVersions)
    .innerJoin(projects, eq(layoutVersions.projectId, projects.id))
    .innerJoin(projectRequirements, eq(layoutVersions.requirementVersionId, projectRequirements.id))
    .where(and(eq(layoutVersions.id, layoutVersionId), eq(projects.ownerId, ownerId)))
    .limit(1);
  if (!row) return errorResponse("Study not found.", 404, "STUDY_NOT_FOUND");
  if (row.status !== "completed") return errorResponse("This study is not completed yet.", 409, "STUDY_NOT_COMPLETED");

  const selection = resolveSchemeSelection(row.schemes, row.selectedSchemeId, parsedRequest.data.schemeId);
  if (selection.status === "invalid-payload") return errorResponse("This study does not contain selectable schemes.", 409, "SCHEMES_UNAVAILABLE");
  if (selection.status === "not-found") return errorResponse("Scheme not found.", 404, "SCHEME_NOT_FOUND");
  if (selection.status === "unchanged") return NextResponse.json({ changed: false, selectedSchemeId: selection.scheme.schemeId });

  const requirements = buildingRequirementsSchema.safeParse(row.requirements);
  if (!requirements.success) return errorResponse("The source requirements are incompatible with this application version.", 409, "INCOMPATIBLE_REQUIREMENTS");
  const result = await db.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${renderContractLockKey(layoutVersionId)}, 0))`);
    const [current] = await transaction.select({
      selectedSchemeId: layoutVersions.selectedSchemeId,
      schemes: layoutVersions.schemes,
      intent: layoutVersions.intent,
    }).from(layoutVersions).where(eq(layoutVersions.id, layoutVersionId)).limit(1);
    const currentSelection = resolveSchemeSelection(current?.schemes, current?.selectedSchemeId ?? null, parsedRequest.data.schemeId);
    if (currentSelection.status === "unchanged") return { status: "unchanged" as const };
    if (currentSelection.status !== "changed") return { status: "stale" as const };

    const renderJobs = await transaction.select({ id: generationJobs.id, status: generationJobs.status, requestPayload: generationJobs.requestPayload }).from(generationJobs)
      .where(and(
        eq(generationJobs.layoutVersionId, layoutVersionId),
        eq(generationJobs.kind, "render"),
        inArray(generationJobs.status, ["queued", "processing", "completed"]),
      ));
    const renderDecision = evaluateRenderSelection(renderJobs, current?.selectedSchemeId ?? null, force);
    if (renderDecision.decision !== "proceed") return { status: renderDecision.decision };
    // The advisory lock intentionally remains held through review. That makes a concurrent
    // double-click observe the committed selection and return a true no-op without a second AI
    // call; any cost/review failure rolls the entire selection back to the prior canonical row.
    const selectedScheme = currentSelection.scheme;
    const costEstimate = estimateBuildingCost(selectedScheme.building, requirements.data);
    const aiReview = await (options.review ?? reviewBuilding)({ requirements: requirements.data, building: selectedScheme.building, validation: selectedScheme.validation });
    const now = new Date();
    const mirror = buildCanonicalSchemeMirror(selectedScheme, costEstimate, aiReview, current?.intent ?? null);
    if (renderDecision.completed.length > 0) {
      for (const job of renderDecision.completed) {
        if (!job.id) continue;
        await transaction.update(generationJobs).set({
          requestPayload: { ...job.requestPayload, schemeDisposition: "previous" },
          updatedAt: now,
        }).where(eq(generationJobs.id, job.id));
      }
    }
    await transaction.update(layoutVersions).set({
      selectedSchemeId: mirror.selectedSchemeId,
      layoutJson: jsonRecord(mirror.layoutJson),
      validation: jsonRecord(mirror.validation),
      costEstimate: jsonRecord(mirror.costEstimate),
      aiReview: jsonRecord(mirror.aiReview),
      intent: jsonRecord(mirror.intent),
      updatedAt: now,
    }).where(eq(layoutVersions.id, layoutVersionId));
    return { status: "changed" as const, selectedScheme, schemes: current.schemes, mirror };
  });

  if (result.status === "render-conflict") return errorResponse("Completed renders belong to the current scheme. Confirm the switch to keep them as previous-scheme evidence.", 409, "FINALIZED_RENDERS_EXIST");
  if (result.status === "active-render-conflict") return errorResponse("A render package is still processing for the current scheme. Wait for it to finish before switching schemes.", 409, "ACTIVE_RENDERS_EXIST");
  if (result.status === "stale") return errorResponse("The available schemes changed while selecting. Reload this study.", 409, "STALE_SCHEME_SELECTION");
  if (result.status === "unchanged") return NextResponse.json({ changed: false, selectedSchemeId: selection.scheme.schemeId });
  if (result.status !== "changed" || !result.selectedScheme || !result.mirror) return errorResponse("The scheme selection could not be completed safely.", 500, "SCHEME_SELECTION_FAILED");
  return NextResponse.json({
    changed: true,
    projectId: row.projectId,
    designId: layoutVersionId,
    version: row.version,
    title: row.title,
    requirements: requirements.data,
    selectedSchemeId: result.selectedScheme.schemeId,
    schemes: result.schemes,
    building: result.selectedScheme.building,
    validation: result.selectedScheme.validation,
    costEstimate: result.mirror.costEstimate,
    intent: result.mirror.intent,
    aiReview: result.mirror.aiReview,
  });
}
