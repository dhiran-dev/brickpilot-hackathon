ALTER TABLE "generation_jobs" ADD COLUMN "dispatch_token" text;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_dispatch_token_unique" UNIQUE("dispatch_token");
