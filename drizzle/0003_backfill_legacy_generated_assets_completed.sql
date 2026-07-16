UPDATE "generated_assets" AS asset
SET "status" = 'completed'
FROM "layout_versions" AS layout
WHERE asset."layout_version_id" = layout."id"
  AND asset."status" = 'queued'
  AND asset."provider_job_id" IS NULL
  AND asset."url" <> ''
  AND layout."status" = 'completed';
