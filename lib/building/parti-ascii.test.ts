import { describe, expect, test } from "bun:test";

import { BUILDING_FIXTURES } from "@/lib/building/fixtures";
import { generateBuilding } from "@/lib/building/generate";
import { renderFloorPartiAscii } from "@/lib/building/parti-ascii";

describe("parti golden ASCII plans", () => {
  test("locks the compact access-edge topology", () => {
    const floor = generateBuilding(BUILDING_FIXTURES[0].requirements).building.floors[0];
    expect(renderFloorPartiAscii(floor)).toBe(COMPACT_GOLDEN);
  });

  test("locks the articulated villa topology", () => {
    const floor = generateBuilding(BUILDING_FIXTURES[1].requirements).building.floors[0];
    expect(renderFloorPartiAscii(floor)).toBe(ARTICULATED_GOLDEN);
  });
});

const COMPACT_GOLDEN = `RRRRRRRRRRRRRRRR
RRRRRRRRRRRRRRRR
RRRRRRRRRRRRRRRR
RRRRRRRRRRRRRRRR
sssssCCCCCRRRRRR
sssssCCCCCRRRRRR
RRRRRRRRRRRRRRRR
RRRRRRRRRRRRRRRR
RRRRRRRRRRRRRRRR
RRRRRRRRRRRRRRRR
RRRRRRRRRRRRRRRR
RRRRRRRRRRRRRRRR`;
const ARTICULATED_GOLDEN = `ssRRRRRRRRRRRRss
ssRRRRRRRRRRRRss
CCCCCCCCCCVVVVVV
RRRRRRVVRRRRRRRR
RRRRRRVVRRRRRRRR
RRRRRRVVRRRRRRRR
RRRRRRVVRRRRRRRR
RRRRRRVVRRRRRRRR
ssssssVVRRRRRRRR
ssssssVVRRRRRRRR
OOOOOOVVRRRRRRRR
OOOOOOVVRRRRRRRR`;
