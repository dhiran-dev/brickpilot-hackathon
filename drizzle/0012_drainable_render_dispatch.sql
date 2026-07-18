CREATE TYPE "public"."render_dispatch_state" AS ENUM('reserved', 'claimed', 'provider_pending', 'attached', 'expired_before_attempt', 'failed');--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "dispatch_state" "render_dispatch_state";--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "dispatch_lease_token" text;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "dispatch_lease_acquired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "dispatch_attempted_at" timestamp with time zone;
