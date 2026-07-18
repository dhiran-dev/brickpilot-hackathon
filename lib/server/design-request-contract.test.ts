import { describe, expect, test } from "bun:test";

import { createCurrentRequirements, DEFAULT_INTAKE_DRAFT } from "@/components/guided-intake/model";
import { BUILDING_FIXTURES } from "@/lib/building/fixtures";
import { parseIssuedDesignRequirements } from "@/lib/server/design-request-contract";

describe("parseIssuedDesignRequirements", () => {
  const current = createCurrentRequirements(DEFAULT_INTAKE_DRAFT);
  const legacy = BUILDING_FIXTURES[0].requirements;

  test("selects the exact current payload for v3 issuance", () => {
    const parsed = parseIssuedDesignRequirements({ requirements: current, legacyRequirements: legacy }, "v3");
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.requirementSchemaVersion).toBe(3);
  });

  test("selects the explicit legacy payload for v2 issuance", () => {
    const parsed = parseIssuedDesignRequirements({ requirements: current, legacyRequirements: legacy }, "v2");
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.requirementSchemaVersion).toBe(2);
  });

  test("preserves old v2 callers but never converts a legacy payload into v3", () => {
    expect(parseIssuedDesignRequirements({ requirements: legacy }, "v2").success).toBe(true);
    expect(parseIssuedDesignRequirements({ requirements: legacy }, "v3").success).toBe(false);
  });
});
