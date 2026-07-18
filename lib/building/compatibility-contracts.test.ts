import { describe, expect, test } from "bun:test";

import { BUILDING_FIXTURES } from "@/lib/building/fixtures";
import { generateBuilding } from "@/lib/building/generate";
import {
  buildingRequirementsContractVersion,
  buildingRequirementsSchema,
  legacyBuildingRequirementsSchema,
  readableBuildingRequirementsSchema,
} from "@/lib/building/requirements";
import {
  buildingContractVersion,
  buildingSchema,
  canonicalBuildingJson,
  legacyBuildingSchema,
  readCanonicalBuilding,
  readableBuildingSchema,
  readableBuildingGeometryHash,
} from "@/lib/building/schema";

describe("schema-v2 compatibility contracts", () => {
  test("keeps the historical requirement export pinned to the frozen v2 schema", () => {
    const input = BUILDING_FIXTURES[0].requirements;
    expect(buildingRequirementsSchema).toBe(legacyBuildingRequirementsSchema);
    expect(readableBuildingRequirementsSchema.parse(input)).toEqual(legacyBuildingRequirementsSchema.parse(input));
    expect(legacyBuildingRequirementsSchema.parse(input)).toEqual(buildingRequirementsSchema.parse(input));
    expect(buildingRequirementsContractVersion(input)).toBe("v2");
    expect(buildingRequirementsContractVersion({ requirementSchemaVersion: 3 })).toBe("v3");
    expect(buildingRequirementsContractVersion({ requirementSchemaVersion: 4 })).toBeNull();
  });

  test("keeps the historical building export and canonical JSON behavior pinned to v2", () => {
    const generated = generateBuilding(BUILDING_FIXTURES[0].requirements).building;
    expect(buildingSchema).toBe(legacyBuildingSchema);
    expect(readableBuildingSchema.parse(generated)).toEqual(legacyBuildingSchema.parse(generated));
    const legacy = legacyBuildingSchema.parse(generated);
    const historical = buildingSchema.parse(generated);
    expect(historical).toEqual(legacy);
    expect(canonicalBuildingJson(historical)).toBe(canonicalBuildingJson(legacy));
    expect(buildingContractVersion(generated)).toBe("v2");
    expect(buildingContractVersion({ buildingSchemaVersion: 3 })).toBe("v3");
    expect(buildingContractVersion({ buildingSchemaVersion: 1 })).toBeNull();
  });

  test("keeps in-flight v2 render geometry readable and rejects malformed v3", () => {
    const generated = generateBuilding(BUILDING_FIXTURES[0].requirements).building;
    const readable = readCanonicalBuilding(generated);
    expect(readable).toMatchObject({
      success: true,
      data: {
        contractVersion: "v2",
        buildingSchemaVersion: 2,
        geometryHash: generated.candidate.geometryHash,
      },
    });
    expect(readableBuildingGeometryHash(generated)).toBe(generated.candidate.geometryHash);
    expect(readCanonicalBuilding({ ...generated, candidate: { ...generated.candidate, geometryHash: 42 } })).toMatchObject({
      success: false,
      reason: "INVALID_BUILDING",
      contractVersion: "v2",
    });
    expect(readCanonicalBuilding({ buildingSchemaVersion: 3, candidate: { geometryHash: "future" } })).toEqual({
      success: false,
      reason: "INVALID_BUILDING",
      contractVersion: "v3",
    });
    expect(readableBuildingGeometryHash({ buildingSchemaVersion: 3, candidate: { geometryHash: "future" } })).toBeNull();
  });
});
