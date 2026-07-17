import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { layoutVersions, projectRequirements, projects } from "@/lib/db/schema";
import { classifyPersistedStudy } from "@/lib/design/persisted-study";

export async function GET(request: Request, context: { params: Promise<{ layoutVersionId: string }> }) {
  const user = await requireUser(request);
  if (!user) return NextResponse.json({ error: "Authentication is required.", code: "AUTH_REQUIRED" }, { status: 401 });
  const { layoutVersionId } = await context.params;
  const [row] = await db
    .select({
      projectId: projects.id,
      designId: layoutVersions.id,
      version: layoutVersions.version,
      title: projects.title,
      status: layoutVersions.status,
      createdAt: layoutVersions.createdAt,
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
    .where(and(eq(layoutVersions.id, layoutVersionId), eq(projects.ownerId, user.id)))
    .limit(1);
  if (!row) return NextResponse.json({ error: "Study not found.", code: "STUDY_NOT_FOUND" }, { status: 404 });
  const classified = classifyPersistedStudy(row);
  if (!classified.compatible) return NextResponse.json({ error: "This saved study is incompatible with the current renderer.", code: classified.study.reason }, { status: 409 });
  if (!classified.study.building) return NextResponse.json({ error: "This study is not completed yet.", code: "STUDY_NOT_COMPLETED" }, { status: 409 });
  return NextResponse.json(classified.study);
}
