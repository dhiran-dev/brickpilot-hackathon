import { describe, expect, test } from "bun:test";

import { resolveProjectIssuance } from "@/lib/server/project-issuance";

describe("resolveProjectIssuance", () => {
  test("issues current v3 by default while preserving explicit and invalid-mode rollback", () => {
    expect(resolveProjectIssuance({ ownerId: "owner-a" })).toEqual({
      contract: "v3",
      generatorContractVersion: 3,
      capabilityProfile: "current_v3",
      rolloutEpoch: "v3-ga",
    });
    expect(resolveProjectIssuance({ ownerId: "owner-a", mode: "" }))
      .toMatchObject({ contract: "v3", capabilityProfile: "current_v3", rolloutEpoch: "v3-ga" });
    expect(resolveProjectIssuance({ ownerId: "owner-a", mode: "v2", rolloutEpoch: "rollback-2026-07" }))
      .toMatchObject({ contract: "v2", capabilityProfile: "current_v2", rolloutEpoch: "rollback-2026-07" });
    expect(resolveProjectIssuance({ ownerId: "owner-a", mode: "unexpected" }).contract).toBe("v2");
  });

  test("issues v3 only to allowlisted owners during the internal rollout", () => {
    expect(resolveProjectIssuance({
      ownerId: "owner-a",
      mode: "v3_internal",
      v3OwnerAllowlist: "owner-b, owner-a",
    })).toEqual({
      contract: "v3",
      generatorContractVersion: 3,
      capabilityProfile: "current_v3",
      rolloutEpoch: "v3-internal",
    });
    expect(resolveProjectIssuance({ ownerId: "owner-c", mode: "v3_internal", v3OwnerAllowlist: "owner-a" }))
      .toMatchObject({ contract: "v2", capabilityProfile: "current_v2", rolloutEpoch: "v3-internal-control" });
  });

  test("issues current v3 to every owner at general availability", () => {
    expect(resolveProjectIssuance({ ownerId: "owner-any", mode: "v3_ga" }))
      .toEqual({ contract: "v3", generatorContractVersion: 3, capabilityProfile: "current_v3", rolloutEpoch: "v3-ga" });
  });
});
