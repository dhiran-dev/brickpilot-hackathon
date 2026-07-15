CREATE TABLE "project_requirements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "input_json" jsonb NOT NULL,
  "version" integer NOT NULL,
  "source" text DEFAULT 'prompt' NOT NULL,
  "edit_prompt" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_requirements_project_version_unique" UNIQUE("project_id", "version")
);
--> statement-breakpoint
ALTER TABLE "project_requirements" ADD CONSTRAINT "project_requirements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "project_requirements_project_id_idx" ON "project_requirements" USING btree ("project_id");
--> statement-breakpoint
ALTER TABLE "design_versions" RENAME TO "layout_versions";
--> statement-breakpoint
ALTER TABLE "layout_versions" RENAME COLUMN "floor_plan" TO "layout_json";
--> statement-breakpoint
ALTER TABLE "layout_versions" ADD COLUMN "requirement_version_id" uuid;
--> statement-breakpoint
INSERT INTO "project_requirements" ("project_id", "input_json", "version", "source", "created_at", "updated_at")
SELECT "project_id", jsonb_build_object('prompt', "prompt"), "version", 'prompt', "created_at", "updated_at"
FROM "layout_versions";
--> statement-breakpoint
UPDATE "layout_versions" AS layout
SET "requirement_version_id" = requirement."id"
FROM "project_requirements" AS requirement
WHERE requirement."project_id" = layout."project_id" AND requirement."version" = layout."version";
--> statement-breakpoint
ALTER TABLE "layout_versions" ALTER COLUMN "requirement_version_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "layout_versions" ADD CONSTRAINT "layout_versions_requirement_version_id_project_requirements_id_fk" FOREIGN KEY ("requirement_version_id") REFERENCES "public"."project_requirements"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "layout_versions" RENAME CONSTRAINT "design_versions_project_version_unique" TO "layout_versions_project_version_unique";
--> statement-breakpoint
ALTER INDEX "design_versions_project_id_idx" RENAME TO "layout_versions_project_id_idx";
--> statement-breakpoint
ALTER INDEX "design_versions_status_idx" RENAME TO "layout_versions_status_idx";
--> statement-breakpoint
CREATE INDEX "layout_versions_requirement_version_id_idx" ON "layout_versions" USING btree ("requirement_version_id");
--> statement-breakpoint
ALTER TABLE "generation_jobs" RENAME COLUMN "design_version_id" TO "layout_version_id";
--> statement-breakpoint
ALTER INDEX "generation_jobs_design_version_id_idx" RENAME TO "generation_jobs_layout_version_id_idx";
--> statement-breakpoint
ALTER TABLE "assets" RENAME TO "generated_assets";
--> statement-breakpoint
ALTER TABLE "generated_assets" RENAME COLUMN "design_version_id" TO "layout_version_id";
--> statement-breakpoint
ALTER TABLE "generated_assets" RENAME COLUMN "kind" TO "type";
--> statement-breakpoint
ALTER TABLE "generated_assets" RENAME COLUMN "public_url" TO "url";
--> statement-breakpoint
ALTER TABLE "generated_assets" ADD COLUMN "project_id" uuid;
--> statement-breakpoint
ALTER TABLE "generated_assets" ADD COLUMN "provider" "generation_provider" DEFAULT 'replicate' NOT NULL;
--> statement-breakpoint
ALTER TABLE "generated_assets" ADD COLUMN "status" "generation_status" DEFAULT 'queued' NOT NULL;
--> statement-breakpoint
ALTER TABLE "generated_assets" ADD COLUMN "provider_job_id" text;
--> statement-breakpoint
UPDATE "generated_assets" AS asset
SET "project_id" = layout."project_id"
FROM "layout_versions" AS layout
WHERE layout."id" = asset."layout_version_id";
--> statement-breakpoint
ALTER TABLE "generated_assets" ALTER COLUMN "project_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "generated_assets" ADD CONSTRAINT "generated_assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER INDEX "assets_design_version_id_idx" RENAME TO "generated_assets_layout_version_id_idx";
--> statement-breakpoint
CREATE INDEX "generated_assets_project_id_idx" ON "generated_assets" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX "generated_assets_status_idx" ON "generated_assets" USING btree ("status");
