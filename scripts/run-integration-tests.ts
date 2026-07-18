import { assertIsolatedTestDatabaseUrl, TEST_DATABASE_URL } from "@/integration/test-database";

const targets = ["integration/lifecycle.integration.test.ts"];
const env = { ...process.env };
if (TEST_DATABASE_URL) {
  env.DATABASE_URL = assertIsolatedTestDatabaseUrl(TEST_DATABASE_URL);
  env.RUN_DB_INTEGRATION = "1";
  targets.push("app/api/designs/[layoutVersionId]/select-scheme/route.integration.test.ts");
} else {
  console.warn("TEST_DATABASE_URL is not set; database-backed integration cases will be reported as skipped.");
}

for (const target of targets) {
  const child = Bun.spawn([process.execPath, "test", target], { cwd: process.cwd(), env, stdout: "inherit", stderr: "inherit" });
  const status = await child.exited;
  if (status !== 0) process.exit(status);
}
