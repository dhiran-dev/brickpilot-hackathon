import { describe, expect, test } from "bun:test";

import {
  ACCESSIBLE_MINIMUM_CLEAR_DIMENSION_MM,
  DEFAULT_MINIMUM_CLEAR_DIMENSION_MM,
  DEFAULT_MINIMUM_REMAINING_DIMENSION_MM,
  MINIMUM_CLEAR_DIMENSION_MM,
  minimumClearDimensionMm,
  minimumRemainingDimensionMm,
} from "@/lib/building/dimensions";

describe("shared building dimensions", () => {
  test("keeps the established per-room clear-dimension baselines", () => {
    expect(MINIMUM_CLEAR_DIMENSION_MM).toEqual({
      bedroom: 2_700,
      living: 2_700,
      dining: 2_400,
      kitchen: 2_100,
      study: 2_100,
      parking: 2_400,
      bathroom: 1_200,
      utility: 1_200,
      foyer: 1_200,
      pooja: 1_200,
      store: 1_000,
    });
  });

  test("preserves generator accessibility and unknown-type fallbacks", () => {
    expect(minimumClearDimensionMm("bedroom")).toBe(2_700);
    expect(minimumClearDimensionMm("store", true)).toBe(ACCESSIBLE_MINIMUM_CLEAR_DIMENSION_MM);
    expect(minimumClearDimensionMm("terrace")).toBe(DEFAULT_MINIMUM_CLEAR_DIMENSION_MM);
    expect(minimumRemainingDimensionMm("terrace")).toBe(DEFAULT_MINIMUM_REMAINING_DIMENSION_MM);
  });
});
