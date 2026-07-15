import { describe, expect, test } from "bun:test";

import { generateLayout, LayoutGenerationError } from "@/lib/layout-engine/generate";
import { layoutFixtures } from "@/lib/layout-engine/fixtures";
import { layoutDataSchema, requirementDataSchema, type LayoutData, type RequirementData } from "@/lib/layout-engine/schemas";

const TOLERANCE = 1e-7;

function overlapArea(left: LayoutData["rooms"][number], right: LayoutData["rooms"][number]) {
  const width = Math.max(0, Math.min(left.xFt + left.widthFt, right.xFt + right.widthFt) - Math.max(left.xFt, right.xFt));
  const depth = Math.max(0, Math.min(left.yFt + left.depthFt, right.yFt + right.depthFt) - Math.max(left.yFt, right.yFt));
  return width * depth;
}

function expectValidLayout(requirements: RequirementData, layout: LayoutData) {
  expect(layoutDataSchema.safeParse(layout).success).toBe(true);
  expect(layout.floor).toBe("G");
  expect(layout.coverageRatio).toBeCloseTo(1, 8);
  expect(new Set(layout.rooms.map((room) => room.id))).toEqual(new Set(requirements.rooms.map((room) => room.id)));

  const bounds = layout.buildableBounds;
  for (const room of layout.rooms) {
    expect(Number.isFinite(room.xFt + room.yFt + room.widthFt + room.depthFt + room.areaSqFt)).toBe(true);
    expect(room.floor).toBe("G");
    expect(room.xFt).toBeGreaterThanOrEqual(bounds.xFt - TOLERANCE);
    expect(room.yFt).toBeGreaterThanOrEqual(bounds.yFt - TOLERANCE);
    expect(room.xFt + room.widthFt).toBeLessThanOrEqual(bounds.xFt + bounds.widthFt + TOLERANCE);
    expect(room.yFt + room.depthFt).toBeLessThanOrEqual(bounds.yFt + bounds.depthFt + TOLERANCE);
    expect(room.areaSqFt + TOLERANCE).toBeGreaterThanOrEqual(room.minAreaSqFt);
  }

  for (let leftIndex = 0; leftIndex < layout.rooms.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < layout.rooms.length; rightIndex += 1) {
      expect(overlapArea(layout.rooms[leftIndex], layout.rooms[rightIndex])).toBeLessThanOrEqual(TOLERANCE);
    }
  }

  const coveredArea = layout.rooms.reduce((total, room) => total + room.areaSqFt, 0);
  expect(coveredArea).toBeCloseTo(bounds.areaSqFt, 7);
}

describe("Phase 2 layout engine", () => {
  for (const [fixtureName, requirements] of Object.entries(layoutFixtures)) {
    test(`${fixtureName} tiles the buildable footprint for many seeds`, () => {
      for (const seed of [0, 1, 2, 7, 42, 99, 2_026, 0xffff_ffff]) {
        expectValidLayout(requirements, generateLayout(requirements, seed));
      }
    });

    test(`${fixtureName} keeps room proportions bounded across 100 deterministic variations`, () => {
      for (let seed = 0; seed < 100; seed += 1) {
        for (const room of generateLayout(requirements, seed).rooms) {
          const aspectRatio = Math.max(room.widthFt / room.depthFt, room.depthFt / room.widthFt);
          expect(aspectRatio).toBeLessThanOrEqual(8);
        }
      }
    });
  }

  test("the same seed is reproducible and a new seed regenerates the plan", () => {
    const requirements = layoutFixtures.eastFacing3Bhk30x50;
    const first = generateLayout(requirements, 42);
    expect(generateLayout(requirements, 42)).toEqual(first);

    const regenerated = generateLayout(requirements, 43);
    expect(regenerated).not.toEqual(first);
    expect(regenerated.rooms.map(({ id, xFt, yFt, widthFt, depthFt }) => ({ id, xFt, yFt, widthFt, depthFt }))).not.toEqual(
      first.rooms.map(({ id, xFt, yFt, widthFt, depthFt }) => ({ id, xFt, yFt, widthFt, depthFt })),
    );
    expectValidLayout(requirements, regenerated);
  });

  test("single-floor lock rejects multi-floor requirements", () => {
    expect(requirementDataSchema.safeParse({ ...layoutFixtures.compact2Bhk20x30, floors: 2 }).success).toBe(false);
  });

  test("rejects duplicate rooms, consumed bounds, and impossible minimum areas", () => {
    const base = layoutFixtures.compact2Bhk20x30;
    expect(requirementDataSchema.safeParse({ ...base, rooms: [...base.rooms, base.rooms[0]] }).success).toBe(false);
    expect(requirementDataSchema.safeParse({ ...base, setbacks: { ...base.setbacks, eastFt: 10, westFt: 10 } }).success).toBe(false);
    expect(
      requirementDataSchema.safeParse({
        ...base,
        rooms: base.rooms.map((room) => ({ ...room, minAreaSqFt: 100, targetAreaSqFt: 100 })),
      }).success,
    ).toBe(false);
  });

  test("returns a stable typed error for invalid input", () => {
    expect(() => generateLayout({ plot: { widthFt: -1 } }, 1)).toThrow(LayoutGenerationError);
    try {
      generateLayout({ plot: { widthFt: -1 } }, 1);
    } catch (error) {
      expect(error).toBeInstanceOf(LayoutGenerationError);
      expect((error as LayoutGenerationError).code).toBe("INVALID_REQUIREMENTS");
    }
  });
});
