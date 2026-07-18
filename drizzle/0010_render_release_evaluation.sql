CREATE TABLE "render_eval_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"layout_version_id" uuid NOT NULL,
	"generation_job_id" uuid NOT NULL,
	"sample_index" integer NOT NULL,
	"provider_job_id" text NOT NULL,
	"provider" text NOT NULL,
	"model_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"prompt" text NOT NULL,
	"input_references" jsonb NOT NULL,
	"semantic_camera" jsonb NOT NULL,
	"geometry_hash" text NOT NULL,
	"output" jsonb NOT NULL,
	"evaluator" jsonb,
	"rubric_version" text NOT NULL,
	"structural" jsonb,
	"aesthetic" jsonb,
	"structural_pass" boolean,
	"aesthetic_pass" boolean,
	"human_disposition" jsonb,
	"evaluated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "render_eval_samples_sample_index_check" CHECK ("sample_index" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "render_eval_aggregates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"layout_version_id" uuid NOT NULL,
	"geometry_hash" text NOT NULL,
	"rubric_version" text NOT NULL,
	"aggregate" jsonb NOT NULL,
	"release_gate_passed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "render_eval_samples" ADD CONSTRAINT "render_eval_samples_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "render_eval_samples" ADD CONSTRAINT "render_eval_samples_layout_version_id_layout_versions_id_fk" FOREIGN KEY ("layout_version_id") REFERENCES "public"."layout_versions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "render_eval_samples" ADD CONSTRAINT "render_eval_samples_generation_job_id_generation_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "render_eval_aggregates" ADD CONSTRAINT "render_eval_aggregates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "render_eval_aggregates" ADD CONSTRAINT "render_eval_aggregates_layout_version_id_layout_versions_id_fk" FOREIGN KEY ("layout_version_id") REFERENCES "public"."layout_versions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "render_eval_samples_generation_job_unique" ON "render_eval_samples" USING btree ("generation_job_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "render_eval_samples_layout_geometry_index_unique" ON "render_eval_samples" USING btree ("layout_version_id", "geometry_hash", "sample_index");
--> statement-breakpoint
CREATE INDEX "render_eval_samples_project_id_idx" ON "render_eval_samples" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX "render_eval_samples_layout_version_id_idx" ON "render_eval_samples" USING btree ("layout_version_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "render_eval_aggregates_layout_geometry_unique" ON "render_eval_aggregates" USING btree ("layout_version_id", "geometry_hash");
--> statement-breakpoint
CREATE INDEX "render_eval_aggregates_project_id_idx" ON "render_eval_aggregates" USING btree ("project_id");
