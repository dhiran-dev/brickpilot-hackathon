import { z } from "zod";

import type { RenderSpec } from "@/lib/render/prompts";

const httpsUrlSchema = z.string().url().refine((value) => new URL(value).protocol === "https:", "Expected an HTTPS URL");

export const replicatePredictionSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["starting", "processing", "succeeded", "failed", "canceled"]),
  output: z.union([httpsUrlSchema, z.array(httpsUrlSchema)]).nullish(),
  error: z.unknown().nullish(),
  urls: z.object({ get: z.string().url().optional(), web: z.string().url().optional() }).passthrough().optional(),
}).passthrough();

export type ReplicatePrediction = z.infer<typeof replicatePredictionSchema>;

export class ReplicateCreateAmbiguousError extends Error {
  constructor(cause: unknown) {
    super("Replicate create outcome is ambiguous; await the tokenized provider webhook", { cause });
    this.name = "ReplicateCreateAmbiguousError";
  }
}

function token() {
  const value = process.env.REPLICATE_API_TOKEN;
  if (!value) throw new Error("REPLICATE_API_TOKEN is not configured");
  return value;
}

export function replicateModelVersion() {
  const value = process.env.IMAGE_MODEL ?? "openai/gpt-image-2";
  if (value !== "openai/gpt-image-2") throw new Error("IMAGE_MODEL must be openai/gpt-image-2 for Phase 7");
  return value;
}

function quality() {
  const parsed = z.enum(["low", "medium", "high", "auto"]).safeParse(process.env.IMAGE_QUALITY ?? "high");
  return parsed.success ? parsed.data : "high";
}

export function replicateWebhookUrl(dispatchToken?: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base) return undefined;
  try {
    const url = new URL(base);
    if (url.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(url.hostname)) return undefined;
    const webhook = new URL("/api/webhooks/replicate", url);
    if (dispatchToken) webhook.searchParams.set("dispatch", dispatchToken);
    return webhook.toString();
  } catch {
    return undefined;
  }
}

export function predictionOutputs(prediction: ReplicatePrediction) {
  if (prediction.status !== "succeeded") return [];
  const output = prediction.output;
  return output ? (Array.isArray(output) ? output : [output]) : [];
}

export function providerStatus(status: ReplicatePrediction["status"]): "processing" | "completed" | "failed" | "canceled" {
  if (status === "succeeded") return "completed";
  if (status === "failed") return "failed";
  if (status === "canceled") return "canceled";
  return "processing";
}

export function safePredictionPayload(prediction: ReplicatePrediction) {
  return {
    id: prediction.id,
    status: prediction.status,
    output: prediction.output ?? null,
    error: prediction.error ?? null,
    urls: prediction.urls ? { get: prediction.urls.get, web: prediction.urls.web } : undefined,
  };
}

export async function createReplicatePrediction(
  spec: RenderSpec,
  inputImages: string[],
  options: { dispatchToken?: string } = {},
) {
  const webhook = replicateWebhookUrl(options.dispatchToken);
  const requestBody = JSON.stringify({
    input: {
      prompt: spec.prompt,
      input_images: inputImages,
      aspect_ratio: "3:2",
      number_of_images: spec.requestedOutputCount,
      quality: quality(),
      background: "opaque",
      output_format: "webp",
      output_compression: 90,
      moderation: "auto",
    },
    // The start callback closes the provider-accepted/database-attach gap by carrying the
    // durable dispatch token back with the provider prediction id. Completed remains for the
    // normal asynchronous finalization path.
    ...(webhook ? { webhook, webhook_events_filter: ["start", "completed"] } : {}),
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`https://api.replicate.com/v1/models/${replicateModelVersion()}/predictions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token()}`,
          "Content-Type": "application/json",
          "Cancel-After": "8m",
        },
        body: requestBody,
      });
    } catch (error) {
      // A network failure cannot prove whether the provider accepted the POST. The durable
      // dispatch stays active and the signed tokenized start/completed webhook resolves it.
      throw new ReplicateCreateAmbiguousError(error);
    }
    const body = await response.json().catch(() => null);
    if (response.ok) {
      const parsed = replicatePredictionSchema.safeParse(body);
      if (!parsed.success) throw new ReplicateCreateAmbiguousError(parsed.error);
      return parsed.data;
    }
    if (response.status === 429 && attempt === 0) {
      const headerDelay = Number(response.headers.get("retry-after"));
      const payloadDelay = body && typeof body === "object" && "retry_after" in body ? Number(body.retry_after) : Number.NaN;
      const delaySeconds = Number.isFinite(headerDelay) ? headerDelay : Number.isFinite(payloadDelay) ? payloadDelay : 10;
      await new Promise((resolve) => setTimeout(resolve, Math.min(15_000, Math.max(0, delaySeconds * 1000)) + 100));
      continue;
    }
    throw new Error(`Replicate create failed (${response.status}): ${JSON.stringify(body).slice(0, 300)}`);
  }
  throw new Error("Replicate create failed after the provider retry window");
}

export async function getReplicatePrediction(providerJobId: string) {
  const response = await fetch(`https://api.replicate.com/v1/predictions/${encodeURIComponent(providerJobId)}`, {
    headers: { Authorization: `Bearer ${token()}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Replicate status failed (${response.status}): ${JSON.stringify(body).slice(0, 300)}`);
  return replicatePredictionSchema.parse(body);
}

export async function cancelReplicatePrediction(providerJobId: string) {
  const response = await fetch(`https://api.replicate.com/v1/predictions/${encodeURIComponent(providerJobId)}/cancel`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => null);
  if (response.status === 404) return { disposition: "not_found" as const, prediction: null };
  if (!response.ok) throw new Error(`Replicate cancel failed (${response.status}): ${JSON.stringify(body).slice(0, 300)}`);
  return { disposition: "accepted" as const, prediction: replicatePredictionSchema.parse(body) };
}
