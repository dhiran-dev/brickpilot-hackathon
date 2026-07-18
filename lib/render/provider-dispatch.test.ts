import { describe, expect, test } from "bun:test";

import { claimAndArmProviderDispatch, createAndAttachProviderPrediction, ProviderAcceptedBeforeAttachError } from "@/lib/render/provider-dispatch";

describe("durable provider dispatch boundary", () => {
  test("preserves the accepted provider id when attachment fails", async () => {
    const accepted = { id: "provider-accepted-1", status: "starting" as const, output: null };
    let attached = false;
    try {
      await createAndAttachProviderPrediction({
        create: async () => accepted,
        afterProviderAccepted: () => { throw new Error("FAULT_AFTER_PROVIDER_ACCEPTANCE"); },
        attach: async () => { attached = true; },
      });
      throw new Error("expected the injected fault");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderAcceptedBeforeAttachError);
      expect((error as ProviderAcceptedBeforeAttachError).prediction.id).toBe(accepted.id);
    }
    expect(attached).toBe(false);
  });

  test("does not classify a provider-create failure as an accepted orphan", async () => {
    await expect(createAndAttachProviderPrediction({
      create: async () => { throw new Error("provider unavailable"); },
      attach: async () => {},
    })).rejects.toThrow("provider unavailable");
  });

  test("exposes the exact crash-after-claim/before-provider-attempt boundary", async () => {
    let armed = false;
    await expect(claimAndArmProviderDispatch({
      claim: async () => ({ leaseToken: "lease-1", dispatchToken: "dispatch-1" }),
      afterClaim: () => { throw new Error("CRASH_AFTER_CLAIM_BEFORE_PROVIDER_CREATE"); },
      arm: async () => { armed = true; return { dispatchToken: "dispatch-1" }; },
    })).rejects.toThrow("CRASH_AFTER_CLAIM_BEFORE_PROVIDER_CREATE");
    expect(armed).toBe(false);
  });
});
