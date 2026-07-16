import { afterEach, describe, expect, test } from "bun:test";

import { createReplicatePrediction, predictionOutputs, providerStatus, replicatePredictionSchema, replicateWebhookUrl } from "@/lib/render/replicate";

const originalUrl = process.env.NEXT_PUBLIC_APP_URL;
const originalToken = process.env.REPLICATE_API_TOKEN;
const originalModel = process.env.IMAGE_MODEL;
const originalFetch = globalThis.fetch;

afterEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = originalUrl;
  process.env.REPLICATE_API_TOKEN = originalToken;
  process.env.IMAGE_MODEL = originalModel;
  globalThis.fetch = originalFetch;
});

describe("Replicate prediction contract", () => {
  test("normalizes lifecycle states without terminal regression", () => {
    expect(providerStatus("starting")).toBe("processing");
    expect(providerStatus("processing")).toBe("processing");
    expect(providerStatus("succeeded")).toBe("completed");
    expect(providerStatus("failed")).toBe("failed");
    expect(providerStatus("canceled")).toBe("canceled");
  });

  test("accepts only valid output URLs from succeeded predictions", () => {
    const prediction = replicatePredictionSchema.parse({ id: "job-1", status: "succeeded", output: ["https://replicate.delivery/a.webp"] });
    expect(predictionOutputs(prediction)).toEqual(["https://replicate.delivery/a.webp"]);
    expect(() => replicatePredictionSchema.parse({ id: "job-1", status: "succeeded", output: ["javascript:alert(1)"] })).toThrow();
  });

  test("omits local webhooks and enables public HTTPS webhooks", () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    expect(replicateWebhookUrl()).toBeUndefined();
    process.env.NEXT_PUBLIC_APP_URL = "https://brickpilot.example";
    expect(replicateWebhookUrl()).toBe("https://brickpilot.example/api/webhooks/replicate");
  });

  test("honors one provider throttle window and retries the same prediction", async () => {
    process.env.REPLICATE_API_TOKEN = "test-token";
    process.env.IMAGE_MODEL = "openai/gpt-image-2";
    let calls = 0;
    globalThis.fetch = (async (_input, init) => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify({ retry_after: 0 }), { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "0" } });
      const body = JSON.parse(String(init?.body)) as { input: { input_images: string[]; number_of_images: number } };
      expect(body.input.input_images).toEqual(["data:image/webp;base64,fixture"]);
      expect(body.input.number_of_images).toBe(1);
      return new Response(JSON.stringify({ id: "prediction-1", status: "starting", output: null }), { status: 201, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const prediction = await createReplicatePrediction(
      { purpose: "interior", sourceRole: "plan_reference", prompt: "Grounded interior", requestedOutputCount: 1 },
      ["data:image/webp;base64,fixture"],
    );
    expect(prediction.id).toBe("prediction-1");
    expect(calls).toBe(2);
  });
});
