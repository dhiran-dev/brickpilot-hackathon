CREATE TYPE "public"."project_capability_profile" AS ENUM('legacy_view_only', 'current_v2', 'current_v3');--> statement-breakpoint
ALTER TYPE "public"."project_status" ADD VALUE IF NOT EXISTS 'deleting';--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "capability_profile" "project_capability_profile" DEFAULT 'current_v2' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "generator_contract_version" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "rollout_epoch" text DEFAULT 'v2-safety-default' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "client_request_id" text;--> statement-breakpoint
UPDATE "projects"
SET "capability_profile" = 'legacy_view_only',
    "generator_contract_version" = 2,
    "rollout_epoch" = 'legacy-backfill';--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_client_request_unique" UNIQUE("owner_id", "client_request_id");
