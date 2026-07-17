import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { selectSchemeForOwner } from "@/app/api/designs/[layoutVersionId]/select-scheme/route";
import { BUILDING_FIXTURES } from "@/lib/building/fixtures";
import { generateBuildingSchemes } from "@/lib/building/generate";
import { estimateBuildingCost } from "@/lib/cost";
import { db } from "@/lib/db";
import { generationJobs, layoutVersions, projectRequirements, projects, users } from "@/lib/db/schema";

const integrationTest = process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;
const ownerId = `scheme-owner-${crypto.randomUUID()}`;
const outsiderId = `scheme-outsider-${crypto.randomUUID()}`;
let projectId = "";
let layoutVersionId = "";

describe("select-scheme database transaction", () => {
  beforeAll(async () => {
    if (process.env.RUN_DB_INTEGRATION !== "1") return;
    const requirements = { ...BUILDING_FIXTURES[1].requirements, seed: 42 };
    const generated = generateBuildingSchemes(requirements);
    if (generated.schemes.length < 2) throw new Error("integration fixture must produce multiple schemes");
    const selected = generated.schemes[0];
    await db.insert(users).values([
      { id: ownerId, name: "Scheme owner", email: `${ownerId}@example.test`, role: "owner" },
      { id: outsiderId, name: "Scheme outsider", email: `${outsiderId}@example.test`, role: "judge" },
    ]);
    const [project] = await db.insert(projects).values({ ownerId, title: "Scheme transaction fixture", status: "ready" }).returning();
    projectId = project.id;
    const [requirement] = await db.insert(projectRequirements).values({
      projectId,
      version: 1,
      inputJson: requirements,
      source: "guided",
    }).returning();
    const [layout] = await db.insert(layoutVersions).values({
      projectId,
      requirementVersionId: requirement.id,
      version: 1,
      prompt: "scheme route integration",
      status: "completed",
      intent: { fixture: true },
      layoutJson: selected.building,
      validation: selected.validation,
      costEstimate: estimateBuildingCost(selected.building, requirements),
      aiReview: { status: "unavailable", reason: "not_configured" },
      schemes: generated.schemes,
      selectedSchemeId: selected.schemeId,
    }).returning();
    layoutVersionId = layout.id;
  });

  afterAll(async () => {
    if (process.env.RUN_DB_INTEGRATION !== "1") return;
    if (projectId) await db.delete(projects).where(eq(projects.id, projectId));
    await db.delete(users).where(eq(users.id, ownerId));
    await db.delete(users).where(eq(users.id, outsiderId));
  });

  integrationTest("owner-scopes, no-ops idempotently, enforces render conflicts, and atomically mirrors a forced switch", async () => {
    const [before] = await db.select().from(layoutVersions).where(eq(layoutVersions.id, layoutVersionId));
    const schemes = before.schemes as Array<{ schemeId: string; building: { candidate: { geometryHash: string } } }>;
    const firstId = before.selectedSchemeId as string;
    const second = schemes.find((scheme) => scheme.schemeId !== firstId);
    if (!second) throw new Error("second scheme missing");
    const reviewCalls = { count: 0 };
    const review = async () => {
      reviewCalls.count += 1;
      return { status: "unavailable" as const, reason: "not_configured" as const };
    };
    const request = (schemeId: string, force = false) => new Request(`http://localhost/api/designs/${layoutVersionId}/select-scheme${force ? "?force=true" : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schemeId }),
    });

    expect((await selectSchemeForOwner(request(firstId), layoutVersionId, outsiderId, { review })).status).toBe(404);
    const noOp = await selectSchemeForOwner(request(firstId), layoutVersionId, ownerId, { review });
    expect(noOp.status).toBe(200);
    expect(await noOp.json()).toEqual({ changed: false, selectedSchemeId: firstId });
    expect(reviewCalls.count).toBe(0);

    const [render] = await db.insert(generationJobs).values({
      layoutVersionId,
      kind: "render",
      provider: "replicate",
      idempotencyKey: `scheme-route-test:${crypto.randomUUID()}`,
      status: "completed",
      requestPayload: { schemeId: firstId, geometryHash: schemes[0].building.candidate.geometryHash, renderPurpose: "exterior_front" },
    }).returning();
    expect((await selectSchemeForOwner(request(second.schemeId), layoutVersionId, ownerId, { review })).status).toBe(409);
    expect(reviewCalls.count).toBe(0);

    const changed = await selectSchemeForOwner(request(second.schemeId, true), layoutVersionId, ownerId, { review });
    expect(changed.status).toBe(200);
    expect(reviewCalls.count).toBe(1);
    const [after] = await db.select().from(layoutVersions).where(eq(layoutVersions.id, layoutVersionId));
    const [renderAfter] = await db.select().from(generationJobs).where(and(eq(generationJobs.id, render.id), eq(generationJobs.layoutVersionId, layoutVersionId)));
    expect(after.selectedSchemeId).toBe(second.schemeId);
    expect((after.layoutJson as { candidate: { geometryHash: string } }).candidate.geometryHash).toBe(second.building.candidate.geometryHash);
    expect(after.intent).toMatchObject({ fixture: true, selectedSchemeId: second.schemeId });
    expect((after.intent as { drawingCacheRevision: string }).drawingCacheRevision).toContain(second.building.candidate.geometryHash);
    expect(renderAfter.requestPayload).toMatchObject({ schemeId: firstId, schemeDisposition: "previous" });

    const repeated = await selectSchemeForOwner(request(second.schemeId), layoutVersionId, ownerId, { review });
    expect(repeated.status).toBe(200);
    expect(reviewCalls.count).toBe(1);

    await db.insert(generationJobs).values({
      layoutVersionId,
      kind: "render",
      provider: "replicate",
      idempotencyKey: `scheme-route-active:${crypto.randomUUID()}`,
      status: "processing",
      requestPayload: { schemeId: second.schemeId, geometryHash: second.building.candidate.geometryHash, renderPurpose: "exterior_top" },
    });
    const activeConflict = await selectSchemeForOwner(request(firstId, true), layoutVersionId, ownerId, { review });
    expect(activeConflict.status).toBe(409);
    expect(reviewCalls.count).toBe(1);
  }, 30_000);
});
