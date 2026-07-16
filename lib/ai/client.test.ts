import { describe, expect, test } from "bun:test";

import { AiProviderError, callJsonModeCompletion } from "@/lib/ai/client";

function jsonResponse(content: unknown, init: { ok?: boolean; status?: number } = {}) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
    }),
    {
      status: init.status ?? 200,
      headers: { "content-type": "application/json" },
    },
  );
}

const request = { systemPrompt: "system", userPayload: { a: 1 }, maxTokens: 100, timeoutMs: 1000 };

function setEnv(apiKey: string | undefined, model: string | undefined) {
  if (apiKey === undefined) {
    delete process.env.FIREWORKS_API_KEY;
  } else {
    process.env.FIREWORKS_API_KEY = apiKey;
  }

  if (model === undefined) {
    delete process.env.AI_MODEL;
  } else {
    process.env.AI_MODEL = model;
  }
}

describe("callJsonModeCompletion", () => {
  test("throws not_configured when env vars are missing", async () => {
    const original = { key: process.env.FIREWORKS_API_KEY, model: process.env.AI_MODEL };
    setEnv(undefined, undefined);

    try {
      await expect(callJsonModeCompletion(request, async () => jsonResponse({ ok: true }))).rejects.toThrow(AiProviderError);
    } finally {
      setEnv(original.key, original.model);
    }
  });

  test("parses and returns the JSON payload from the completion content", async () => {
    setEnv("test-key", "test-model");

    const result = await callJsonModeCompletion(request, async () => jsonResponse({ hello: "world" }));
    expect(result).toEqual({ hello: "world" });
  });

  test("throws http_error on a non-ok response", async () => {
    setEnv("test-key", "test-model");

    await expect(callJsonModeCompletion(request, async () => new Response("", { status: 500 }))).rejects.toMatchObject({
      reason: "http_error",
    });
  });

  test("throws invalid_json when the content is not parseable JSON", async () => {
    setEnv("test-key", "test-model");

    await expect(callJsonModeCompletion(request, async () => jsonResponse("not json"))).rejects.toMatchObject({
      reason: "invalid_json",
    });
  });

  test("throws timeout when the fetch implementation rejects with an abort error", async () => {
    setEnv("test-key", "test-model");

    await expect(
      callJsonModeCompletion(request, async () => {
        throw new DOMException("aborted", "AbortError");
      }),
    ).rejects.toMatchObject({ reason: "timeout" });
  });

  test("classifies real timeout errors and malformed response envelopes", async () => {
    setEnv("test-key", "test-model");
    await expect(callJsonModeCompletion(request, async () => {
      throw new DOMException("timed out", "TimeoutError");
    })).rejects.toMatchObject({ reason: "timeout" });
    await expect(callJsonModeCompletion(request, async () => new Response("not-json", { status: 200 }))).rejects.toMatchObject({ reason: "invalid_json" });
  });
});
