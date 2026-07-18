import { describe, expect, test } from "bun:test";
import { nextReleaseEvalSampleIndex } from "@/lib/render/finalize-job";
import { aggregateRenderReleaseEval } from "@/lib/render/release-eval";
import { buildOfflineRenderEvalSamples } from "@/lib/render/fixtures/release-eval-reference";

process.env.DATABASE_URL ||= "postgres://brickpilot:brickpilot@127.0.0.1:5432/brickpilot_test";
process.env.BETTER_AUTH_SECRET ||= "brickpilot-test-secret-at-least-32-characters";
process.env.BETTER_AUTH_URL ||= "http://localhost:3000";

const { POST, releaseEvalBatchReservationCount } = await import("@/app/api/designs/[layoutVersionId]/render-eval/batch/route");
const context = { params: Promise.resolve({ layoutVersionId: "00000000-0000-0000-0000-000000000000" }) };

describe("internal five-sample release-evaluation batch", () => {
  test("reserves exactly five independent jobs outside normal retry quotas", () => {
    expect(releaseEvalBatchReservationCount({ sampleJobIds: [], jobs: [] })).toBe(5);
    expect(releaseEvalBatchReservationCount({
      sampleJobIds: ["sample-1", "sample-2"],
      jobs: [{ id: "sample-1", status: "completed" }, { id: "active-3", status: "processing" }],
    })).toBe(2);
    expect(releaseEvalBatchReservationCount({
      sampleJobIds: ["1", "2", "3", "4", "5"],
      jobs: [],
    })).toBe(0);
  });

  test("five reserved finalizations occupy unique durable slots and form one aggregate", () => {
    const finalized: number[] = [];
    for (let index = 0; index < releaseEvalBatchReservationCount({ sampleJobIds: [], jobs: [] }); index += 1) {
      const slot = nextReleaseEvalSampleIndex(finalized);
      expect(slot).toBe(index + 1);
      finalized.push(slot!);
    }
    expect(nextReleaseEvalSampleIndex(finalized)).toBeUndefined();
    const geometryHash = "batch-geometry";
    const samples = buildOfflineRenderEvalSamples({
      geometryHash,
      prompt: "A canonical primary-road designer-elevation prompt bound to one immutable geometry and repeated for five independent provider predictions.".repeat(2),
      camera: {
        cameraVersion: "semantic-camera-v3.0.0",
        view: "primary_road_elevation",
        facadeSide: "north",
        facadeRole: "primary_road_elevation",
        targetWallIds: ["wall-front"],
        targetOpeningId: "main-entry",
        positionMm: { x: 1, y: 2, z: 3 },
        targetMm: { x: 4, y: 5, z: 6 },
        mainEntryMustBeVisible: true,
        geometryHash,
      },
    });
    const aggregate = aggregateRenderReleaseEval(samples);
    expect(aggregate.sampleCount).toBe(5);
    expect(new Set(aggregate.providerJobIds).size).toBe(5);
  });

  test("fails closed without the internal evaluator credential before touching storage or providers", async () => {
    const response = await POST(new Request("http://localhost/api/designs/id/render-eval/batch", {
      method: "POST",
      body: JSON.stringify({ geometryHash: "geometry" }),
    }), context);
    expect(response.status).toBe(401);
  });
});
