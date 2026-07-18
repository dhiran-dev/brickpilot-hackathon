import { describe, expect, test } from "bun:test";

import {
  TEST_DATABASE_URL,
  applyMigrationFiles,
  migrationFiles,
  openTestDatabase,
  resetPublicSchema,
} from "@/integration/test-database";

const databaseTest = TEST_DATABASE_URL ? test : test.skip;

describe("project lifecycle migration rehearsal", () => {
  test("discovers the migration rehearsal even when no isolated database is configured", () => {
    expect(migrationFiles().some((file) => file.endsWith("0008_project_capability_profiles.sql"))).toBe(true);
    expect(migrationFiles().some((file) => file.endsWith("0009_durable_project_deletion.sql"))).toBe(true);
  });

  databaseTest("backfills legacy and processing rows while preserving explicitly issued current and deleting fixtures", async () => {
    const client = openTestDatabase(TEST_DATABASE_URL!);
    try {
      await resetPublicSchema(client);
      const files = migrationFiles();
      const capabilityIndex = files.findIndex((file) => file.endsWith("0008_project_capability_profiles.sql"));
      const deletionIndex = files.findIndex((file) => file.endsWith("0009_durable_project_deletion.sql"));
      expect(capabilityIndex).toBeGreaterThan(0);
      expect(deletionIndex).toBe(capabilityIndex + 1);
      await applyMigrationFiles(client, files.slice(0, capabilityIndex));

      await client`insert into users (id, name, email, role) values ('migration-owner', 'Migration Owner', 'migration-owner@example.test', 'owner')`;
      const [legacy] = await client<{ id: string }[]>`insert into projects (owner_id, title, status) values ('migration-owner', 'Legacy ready', 'ready') returning id`;
      const [processing] = await client<{ id: string }[]>`insert into projects (owner_id, title, status) values ('migration-owner', 'Legacy processing', 'generating') returning id`;
      const [requirement] = await client<{ id: string }[]>`insert into project_requirements (project_id, input_json, version, source) values (${processing.id}, '{"requirementSchemaVersion":2}'::jsonb, 1, 'guided') returning id`;
      const [layout] = await client<{ id: string }[]>`insert into layout_versions (project_id, requirement_version_id, version, prompt, status) values (${processing.id}, ${requirement.id}, 1, 'migration processing fixture', 'planning') returning id`;
      await client`insert into generation_jobs (layout_version_id, kind, provider, idempotency_key, status, request_payload) values (${layout.id}, 'design', 'brickpilot', 'migration-processing-job', 'processing', '{}'::jsonb)`;

      await applyMigrationFiles(client, [files[capabilityIndex]]);
      const backfilled = await client<{ id: string; capability_profile: string; rollout_epoch: string }[]>`
        select id, capability_profile, rollout_epoch from projects where id in (${legacy.id}, ${processing.id}) order by id
      `;
      expect(backfilled).toHaveLength(2);
      expect(backfilled.every((row) => row.capability_profile === "legacy_view_only" && row.rollout_epoch === "legacy-backfill")).toBe(true);

      await client`
        insert into projects (owner_id, title, status, capability_profile, generator_contract_version, rollout_epoch, client_request_id)
        values
          ('migration-owner', 'Current v2', 'ready', 'current_v2', 2, 'v2-test', 'migration-current-v2'),
          ('migration-owner', 'Current v3', 'ready', 'current_v3', 3, 'v3-test', 'migration-current-v3'),
          ('migration-owner', 'Deleting v3', 'deleting', 'current_v3', 3, 'v3-test', 'migration-deleting-v3')
      `;
      await applyMigrationFiles(client, files.slice(deletionIndex));
      await client`
        insert into projects (owner_id, title, status)
        values ('migration-owner', 'Default current', 'ready')
      `;

      const profiles = await client<{ title: string; status: string; capability_profile: string; generator_contract_version: number; rollout_epoch: string }[]>`
        select title, status, capability_profile, generator_contract_version, rollout_epoch from projects order by title
      `;
      expect(profiles).toEqual(expect.arrayContaining([
        expect.objectContaining({ title: "Current v2", status: "ready", capability_profile: "current_v2", generator_contract_version: 2 }),
        expect.objectContaining({ title: "Current v3", status: "ready", capability_profile: "current_v3", generator_contract_version: 3 }),
        expect.objectContaining({ title: "Default current", status: "ready", capability_profile: "current_v3", generator_contract_version: 3, rollout_epoch: "v3-ga" }),
        expect.objectContaining({ title: "Deleting v3", status: "deleting", capability_profile: "current_v3", generator_contract_version: 3 }),
        expect.objectContaining({ title: "Legacy ready", capability_profile: "legacy_view_only" }),
        expect.objectContaining({ title: "Legacy processing", status: "generating", capability_profile: "legacy_view_only" }),
      ]));
      const [processingJob] = await client<{ status: string }[]>`select status from generation_jobs where idempotency_key = 'migration-processing-job'`;
      expect(processingJob.status).toBe("processing");
      const [deletionTable] = await client<{ exists: boolean }[]>`select to_regclass('public.project_deletion_jobs') is not null as exists`;
      expect(deletionTable.exists).toBe(true);
    } finally {
      await client.end();
    }
  }, 30_000);
});
