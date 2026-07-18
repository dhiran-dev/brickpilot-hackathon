ALTER TABLE "projects" ALTER COLUMN "capability_profile" SET DEFAULT 'current_v3';--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "generator_contract_version" SET DEFAULT 3;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "rollout_epoch" SET DEFAULT 'v3-ga';
