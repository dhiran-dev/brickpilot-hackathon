import { fileURLToPath } from "node:url";

import postgres from "postgres";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL?.trim() || null;

export function assertIsolatedTestDatabaseUrl(value: string) {
  const parsed = new URL(value);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!databaseName || !/(?:test|ci|rehearsal)/i.test(databaseName)) {
    throw new Error("TEST_DATABASE_URL must name an isolated database containing 'test', 'ci', or 'rehearsal'.");
  }
  return value;
}

export function openTestDatabase(value: string) {
  return postgres(assertIsolatedTestDatabaseUrl(value), { max: 1 });
}

export async function resetPublicSchema(client: ReturnType<typeof postgres>) {
  await client.unsafe('drop schema if exists "public" cascade');
  await client.unsafe('create schema "public"');
}

export function migrationFiles() {
  const folder = fileURLToPath(new URL("../drizzle/", import.meta.url));
  return [...new Bun.Glob("*.sql").scanSync({ cwd: folder, absolute: true })].sort();
}

export async function applyMigrationFiles(
  client: ReturnType<typeof postgres>,
  files: readonly string[],
) {
  for (const file of files) {
    const source = await Bun.file(file).text();
    const statements = source.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);
    for (const statement of statements) await client.unsafe(statement);
  }
}
