import { createHmac, timingSafeEqual } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { generationJobs, webhookEvents } from "@/lib/db/schema";
import { applyReplicatePrediction } from "@/lib/render/finalize-job";
import { replicatePredictionSchema } from "@/lib/render/replicate";
import { attachProviderPredictionByDispatchToken } from "@/lib/server/render-dispatch";

const MAX_WEBHOOK_AGE_SECONDS = 300;

export function webhookEventNeedsProcessing(event: { processedAt: Date | null } | null | undefined) {
  return !event?.processedAt;
}

function verifySignature(rawBody: string, headers: Headers) {
  const secret = process.env.REPLICATE_WEBHOOK_SECRET;
  const eventId = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatures = headers.get("webhook-signature");
  if (!secret || !eventId || !timestamp || !signatures) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1_000 - timestampSeconds) > MAX_WEBHOOK_AGE_SECONDS) {
    return false;
  }

  const secretValue = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const expected = createHmac("sha256", Buffer.from(secretValue, "base64"))
    .update(`${eventId}.${timestamp}.${rawBody}`)
    .digest();

  return signatures.split(" ").some((entry) => {
    const [, signature] = entry.split(",", 2);
    if (!signature) return false;
    const received = Buffer.from(signature, "base64");
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifySignature(rawBody, request.headers)) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Webhook body must be valid JSON." }, { status: 400 });
  }

  const event = replicatePredictionSchema.safeParse(payload);
  if (!event.success) return NextResponse.json({ error: "Unsupported Replicate payload." }, { status: 400 });

  const eventId = request.headers.get("webhook-id");
  if (!eventId) return NextResponse.json({ error: "Missing webhook identifier." }, { status: 400 });

  let [receivedEvent] = await db
    .insert(webhookEvents)
    .values({
      provider: "replicate",
      providerEventId: eventId,
      payload: payload as Record<string, unknown>,
      signatureValid: true,
    })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });

  if (!receivedEvent) {
    const [existingEvent] = await db.select({ id: webhookEvents.id, processedAt: webhookEvents.processedAt })
      .from(webhookEvents)
      .where(and(eq(webhookEvents.provider, "replicate"), eq(webhookEvents.providerEventId, eventId)))
      .limit(1);
    if (!webhookEventNeedsProcessing(existingEvent)) return NextResponse.json({ received: true, duplicate: true });
    if (!existingEvent) return NextResponse.json({ error: "Webhook event could not be reserved." }, { status: 503 });
    // A previous attempt durably recorded the event but failed before attachment/finalization.
    // Reprocess it instead of allowing the idempotency row to strand a provider prediction.
    receivedEvent = { id: existingEvent.id };
  }

  let [job] = await db
    .select()
    .from(generationJobs)
    .where(and(eq(generationJobs.provider, "replicate"), eq(generationJobs.providerJobId, event.data.id)))
    .limit(1);

  // New dispatches carry a durable correlation token in the signed provider callback URL. This
  // is the recovery path when the provider accepted the paid prediction but the initiating
  // request failed before its database attachment committed. Provider-id lookup above preserves
  // compatibility with every already in-flight v1/v2 job.
  const dispatchToken = new URL(request.url).searchParams.get("dispatch");
  if (!job && dispatchToken) {
    const recovered = await attachProviderPredictionByDispatchToken(dispatchToken, event.data);
    if (recovered?.jobId) {
      [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, recovered.jobId)).limit(1);
    }
  }

  const receivedAt = new Date();
  if (job) await applyReplicatePrediction(job.id, event.data);

  await db.update(webhookEvents).set({ processedAt: receivedAt }).where(eq(webhookEvents.id, receivedEvent.id));
  return NextResponse.json({ received: true });
}
