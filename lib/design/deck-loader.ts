import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { layoutVersions, projectRequirements, projects } from "@/lib/db/schema";
import { classifyPersistedStudy } from "@/lib/design/persisted-study";
import { validateBuilding } from "@/lib/validation";
import { renderState } from "@/app/api/designs/[layoutVersionId]/renders/route";
import type { DeckPayload, DeckRenders } from "@/lib/design/deck";

export type DeckLoadResult =
  | { ok: true; payload: DeckPayload }
  | { ok: false; status: 404; code: "STUDY_NOT_FOUND"; message: string }
  | { ok: false; status: 409; code: "STUDY_NOT_COMPLETED" | "INCOMPATIBLE_STUDY"; message: string };

export async function loadDeckPayload(layoutVersionId: string, userId: string): Promise<DeckLoadResult> {
  const [row] = await db
    .select({
      projectId: projects.id,
      designId: layoutVersions.id,
      title: projects.title,
      status: layoutVersions.status,
      createdAt: layoutVersions.createdAt,
      version: layoutVersions.version,
      requirements: projectRequirements.inputJson,
      intent: layoutVersions.intent,
      building: layoutVersions.layoutJson,
      validation: layoutVersions.validation,
      costEstimate: layoutVersions.costEstimate,
      aiReview: layoutVersions.aiReview,
      schemes: layoutVersions.schemes,
      selectedSchemeId: layoutVersions.selectedSchemeId,
    })
    .from(layoutVersions)
    .innerJoin(projects, eq(layoutVersions.projectId, projects.id))
    .innerJoin(projectRequirements, eq(layoutVersions.requirementVersionId, projectRequirements.id))
    .where(and(eq(layoutVersions.id, layoutVersionId), eq(projects.ownerId, userId)))
    .limit(1);

  if (!row) return { ok: false, status: 404, code: "STUDY_NOT_FOUND", message: "Study not found." };

  const classified = classifyPersistedStudy(row);
  if (!classified.compatible) {
    return { ok: false, status: 409, code: "INCOMPATIBLE_STUDY", message: "This saved study is incompatible with the current renderer." };
  }
  const study = classified.study;
  if (!study.building || !study.validation || !study.costEstimate || !study.schemes || !study.selectedSchemeId) {
    return { ok: false, status: 409, code: "STUDY_NOT_COMPLETED", message: "This study is not completed yet." };
  }
  const scheme = study.schemes.find((candidate) => candidate.schemeId === study.selectedSchemeId) ?? study.schemes[0];
  const renders = await renderState(layoutVersionId);

  const assumptionsValue =
    study.intent && typeof study.intent === "object" && "assumptions" in study.intent
      ? (study.intent as Record<string, unknown>).assumptions
      : [];
  const validatedAssumptions = Array.isArray(assumptionsValue)
    ? assumptionsValue.filter((value): value is string => typeof value === "string")
    : [];

  const payload: DeckPayload = {
    projectId: study.projectId,
    designId: study.designId,
    title: study.title,
    location: `${study.requirements.region.locality ? `${study.requirements.region.locality}, ` : ""}${study.requirements.region.adminArea}`,
    generatedAt: new Date().toISOString(),
    requirements: study.requirements,
    building: study.building,
    validation: validateBuilding(study.building, study.requirements),
    costEstimate: study.costEstimate,
    aiReview: study.aiReview ?? null,
    scheme,
    intentAssumptions: validatedAssumptions,
    renders: {
      status: renders.status as DeckRenders["status"],
      assets: renders.assets.map((asset) => ({ id: asset.id, role: asset.role, url: asset.url, contentType: asset.contentType })),
    },
  };
  return { ok: true, payload };
}
