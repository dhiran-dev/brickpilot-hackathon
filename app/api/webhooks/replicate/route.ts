import { createHmac, timingSafeEqual } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { generationJobs, webhookEvents } from "@/lib/db/schema";

const MAX_WEBHOOK_AGE_SECONDS = 300;

const replicateEventSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["starting", "processing", "succeeded", "failed", "canceled"]),
  output: z.unknown().optional(),
  error: z.unknown().optional(),
});

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

  const event = replicateEventSchema.safeParse(payload);
  if (!event.success) return NextResponse.json({ error: "Unsupported Replicate payload." }, { status: 400 });

  const eventId = request.headers.get("webhook-id");
  if (!eventId) return NextResponse.json({ error: "Missing webhook identifier." }, { status: 400 });

  const [receivedEvent] = await db
    .insert(webhookEvents)
    .values({
      provider: "replicate",
      providerEventId: eventId,
      payload: payload as Record<string, unknown>,
      signatureValid: true,
    })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });

  if (!receivedEvent) return NextResponse.json({ received: true, duplicate: true });

  const [job] = await db
    .select()
    .from(generationJobs)
    .where(and(eq(generationJobs.provider, "replicate"), eq(generationJobs.providerJobId, event.data.id)))
    .limit(1);

  const terminalStatuses = new Set(["completed", "failed", "canceled"]);
  const receivedAt = new Date();
  if (job && !terminalStatuses.has(job.status)) {
    const status =
      event.data.status === "succeeded"
        ? "completed"
        : event.data.status === "failed"
          ? "failed"
          : event.data.status === "canceled"
            ? "canceled"
            : "processing";
    await db
      .update(generationJobs)
      .set({
        status,
        responsePayload: payload as Record<string, unknown>,
        failureReason: event.data.status === "failed" ? String(event.data.error ?? "Replicate failed") : null,
        startedAt: job.startedAt ?? receivedAt,
        completedAt: terminalStatuses.has(status) ? receivedAt : null,
        updatedAt: receivedAt,
      })
      .where(eq(generationJobs.id, job.id));
  }

  await db.update(webhookEvents).set({ processedAt: receivedAt }).where(eq(webhookEvents.id, receivedEvent.id));
  return NextResponse.json({ received: true });
}
