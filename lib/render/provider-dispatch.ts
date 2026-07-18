import type { ReplicatePrediction } from "@/lib/render/replicate";

/**
 * Distinguishes a provider-create failure from the dangerous dual-write gap where the paid
 * prediction exists but its id has not yet been attached to the durable local reservation.
 */
export class ProviderAcceptedBeforeAttachError extends Error {
  readonly prediction: ReplicatePrediction;

  constructor(prediction: ReplicatePrediction, cause: unknown) {
    super("Provider accepted the render before the local dispatch attachment completed", { cause });
    this.name = "ProviderAcceptedBeforeAttachError";
    this.prediction = prediction;
  }
}

export async function createAndAttachProviderPrediction(input: {
  create: () => Promise<ReplicatePrediction>;
  attach: (prediction: ReplicatePrediction) => Promise<void>;
  /** Test-only fault seam for the provider-accepted/database-attach boundary. */
  afterProviderAccepted?: (prediction: ReplicatePrediction) => void | Promise<void>;
}) {
  const prediction = await input.create();
  try {
    await input.afterProviderAccepted?.(prediction);
    await input.attach(prediction);
  } catch (error) {
    throw new ProviderAcceptedBeforeAttachError(prediction, error);
  }
  return prediction;
}

/** Durable two-phase pre-provider boundary with an exact crash-injection seam. */
export async function claimAndArmProviderDispatch<TClaim, TArmed>(input: {
  claim: () => Promise<TClaim | null>;
  arm: (claim: TClaim) => Promise<TArmed | null>;
  afterClaim?: (claim: TClaim) => void | Promise<void>;
}) {
  const claim = await input.claim();
  if (!claim) return null;
  await input.afterClaim?.(claim);
  return input.arm(claim);
}
