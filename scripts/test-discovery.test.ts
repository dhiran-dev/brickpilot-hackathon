import { expect, test } from "bun:test";

const packageJson = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as {
  scripts: Record<string, string>;
};

test("Bun discovers newly added test files without a package-script whitelist", () => {
  expect(import.meta.path.endsWith("scripts/test-discovery.test.ts")).toBe(true);
  expect(packageJson.scripts.test).toStartWith("bun test");
  expect(packageJson.scripts.test).not.toMatch(/\.(?:test|spec)\.[cm]?[jt]sx?/);
  expect(packageJson.scripts.test).toContain("e2e/**");
  expect(packageJson.scripts["test:e2e"]).toStartWith("bun test e2e");
});
