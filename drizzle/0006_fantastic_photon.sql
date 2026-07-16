ALTER TYPE "public"."asset_role" ADD VALUE IF NOT EXISTS 'massing_collage' BEFORE 'exterior';--> statement-breakpoint
ALTER TYPE "public"."asset_role" ADD VALUE IF NOT EXISTS 'massing_top' BEFORE 'exterior';--> statement-breakpoint
ALTER TYPE "public"."asset_role" ADD VALUE IF NOT EXISTS 'exterior_front' BEFORE 'interior';--> statement-breakpoint
ALTER TYPE "public"."asset_role" ADD VALUE IF NOT EXISTS 'exterior_collage' BEFORE 'interior';--> statement-breakpoint
ALTER TYPE "public"."asset_role" ADD VALUE IF NOT EXISTS 'exterior_top' BEFORE 'interior';
