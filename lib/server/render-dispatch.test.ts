import { describe, expect, test } from "bun:test";

process.env.DATABASE_URL ||= "postgres://brickpilot:brickpilot@127.0.0.1:5432/brickpilot_test";

const { DISPATCH_CLAIM_LEASE_MS, dispatchClaimNeedsRecovery, recoverDispatchClaimWithCas } = await import("@/lib/server/render-dispatch");

describe("drainable render dispatch claims", () => {
  const now = new Date("2026-07-18T12:00:00Z");
  const stale = {
    status: "processing",
    dispatchState: "claimed",
    providerJobId: null,
    dispatchLeaseToken: "lease-1",
    dispatchLeaseAcquiredAt: new Date(now.getTime() - DISPATCH_CLAIM_LEASE_MS - 1),
  };

  test("recovers only stale pre-attempt claims and never ambiguous provider-pending work", () => {
    expect(dispatchClaimNeedsRecovery(stale, now)).toBe(true);
    expect(dispatchClaimNeedsRecovery({ ...stale, dispatchState: "provider_pending" }, now)).toBe(false);
    expect(dispatchClaimNeedsRecovery({ ...stale, providerJobId: "provider-1" }, now)).toBe(false);
  });

  test("concurrent drainers use the lease token as a compare-and-swap so only one wins", async () => {
    let liveLease: string | null = "lease-1";
    const expire = async (expectedLease: string) => {
      if (liveLease !== expectedLease) return false;
      liveLease = null;
      return true;
    };
    const results = await Promise.all([
      recoverDispatchClaimWithCas(stale, now, expire),
      recoverDispatchClaimWithCas(stale, now, expire),
    ]);
    expect(results.sort()).toEqual([false, true]);
  });
});
