const ENDPOINT = "https://api.fireworks.ai/inference/v1/chat/completions";

export class AiProviderError extends Error {
  constructor(
    readonly reason: "not_configured" | "timeout" | "http_error" | "invalid_json" | "empty_response",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

export type JsonModeRequest = {
  systemPrompt: string;
  userPayload: unknown;
  maxTokens: number;
  timeoutMs: number;
};

export type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function callJsonModeCompletion(request: JsonModeRequest, fetchImpl: FetchImplementation = fetch): Promise<unknown> {
  const apiKey = process.env.FIREWORKS_API_KEY;
  const model = process.env.AI_MODEL;

  if (!apiKey || !model) {
    throw new AiProviderError("not_configured", "The AI service is not configured.");
  }

  let response: Response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: request.maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: JSON.stringify(request.userPayload) },
        ],
      }),
      signal: AbortSignal.timeout(request.timeoutMs),
    });
  } catch (error) {
    if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new AiProviderError("timeout", "The AI service did not respond in time.", error);
    }

    throw new AiProviderError("http_error", "The AI service did not respond.", error);
  }

  if (!response.ok) {
    throw new AiProviderError("http_error", `The AI service returned status ${response.status}.`);
  }

  let payload: { choices?: Array<{ message?: { content?: unknown } }> };
  try {
    payload = await response.json() as typeof payload;
  } catch (error) {
    throw new AiProviderError("invalid_json", "The AI service returned invalid JSON.", error);
  }
  const content = payload.choices?.[0]?.message?.content;

  if (typeof content !== "string" || content.length === 0) {
    throw new AiProviderError("empty_response", "The AI service returned an empty response.");
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    throw new AiProviderError("invalid_json", "The AI service returned invalid JSON.", error);
  }
}
