ALTER TYPE "public"."generation_status" ADD VALUE IF NOT EXISTS 'finalizing';--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "finalizing_started_at" timestamp with time zone;--> statement-breakpoint
CREATE TYPE "public"."project_deletion_state" AS ENUM('pending', 'quiescing', 'deleting_assets', 'deleting_database', 'failed', 'completed');--> statement-breakpoint
CREATE TABLE "project_deletion_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"original_project_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"confirmation_digest" text NOT NULL,
	"state" "project_deletion_state" DEFAULT 'pending' NOT NULL,
	"manifest_keys" jsonb NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"lease_token" text,
	"lease_acquired_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_deletion_jobs_original_project_unique" UNIQUE("original_project_id")
);--> statement-breakpoint
CREATE INDEX "project_deletion_jobs_owner_id_idx" ON "project_deletion_jobs" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "project_deletion_jobs_state_idx" ON "project_deletion_jobs" USING btree ("state");
