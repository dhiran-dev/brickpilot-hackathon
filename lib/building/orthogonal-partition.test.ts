import { describe, expect, test } from "bun:test";

import {
  auditOrthogonalPartition,
  normalizeOrthogonalPolygon,
  orthogonalPolygonAreaMm2,
  rectangleToOrthogonalPolygon,
  residualRectangles,
} from "@/lib/building/orthogonal-partition";

describe("orthogonal partition utilities", () => {
  test("normalizes closing points, collinear vertices, winding, and origin deterministically", () => {
    const normalized = normalizeOrthogonalPolygon({ points: [
      { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 2000, y: 3000 }, { x: 0, y: 3000 }, { x: 0, y: 0 }, { x: 4000, y: 0 },
    ] });
    expect(normalized).toEqual(rectangleToOrthogonalPolygon({ x: 0, y: 0, width: 4000, depth: 3000 }));
    expect(orthogonalPolygonAreaMm2(normalized)).toBe(12_000_000);
  });

  test("proves complete non-overlapping coverage including intentional residual cells", () => {
    const envelope = { x: 0, y: 0, width: 6000, depth: 4000 };
    const occupied = [{ x: 0, y: 0, width: 3000, depth: 2000 }, { x: 3000, y: 0, width: 3000, depth: 2000 }];
    const regions = [
      ...occupied.map((rectangle) => ({ polygon: rectangleToOrthogonalPolygon(rectangle) })),
      ...residualRectangles(envelope, occupied).map((rectangle) => ({ polygon: rectangleToOrthogonalPolygon(rectangle) })),
    ];
    expect(auditOrthogonalPartition(rectangleToOrthogonalPolygon(envelope), regions)).toMatchObject({
      valid: true,
      coveredAreaMm2: 24_000_000,
      gapAreaMm2: 0,
      overlapAreaMm2: 0,
      outsideAreaMm2: 0,
    });
    expect(auditOrthogonalPartition(rectangleToOrthogonalPolygon(envelope), regions.slice(0, 2))).toMatchObject({ valid: false, gapAreaMm2: 12_000_000 });
  });
});
