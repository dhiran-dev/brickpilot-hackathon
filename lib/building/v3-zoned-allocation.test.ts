import { describe, expect, test } from "bun:test";

import { DENSE_COURTYARD_CURRENT_REQUIREMENTS } from "@/lib/building/fixtures/dense-courtyard-current";
import { generateV3AllocationStage } from "@/lib/building/generate-v3-allocation";
import { generateV3CirculationStage } from "@/lib/building/generate-v3-circulation";
import { generateV3PhysicalStage } from "@/lib/building/generate-v3-physical";
import { runDesignPipelineV3 } from "@/lib/server/design-pipeline";

function allocationFingerprint() {
  const result = generateV3AllocationStage(DENSE_COURTYARD_CURRENT_REQUIREMENTS);
  return result.schemes.map((scheme) => ({
    partiId: scheme.partiId,
    floors: scheme.floors.map((floor) => ({
      floorId: floor.floorId,
      spaces: floor.spaces.map((space) => ({
        id: space.id,
        type: space.type,
        bounds: space.bounds,
        areaMm2: space.areaMm2,
      })),
    })),
  }));
}

describe("v3 zoned allocation regression", () => {
  test("generates the exact dense courtyard brief without deleting requested spaces", () => {
    const result = generateV3AllocationStage(DENSE_COURTYARD_CURRENT_REQUIREMENTS);
    expect(result.schemes.length).toBeGreaterThan(0);
    const requestedIds = new Set(DENSE_COURTYARD_CURRENT_REQUIREMENTS.rooms.map((room) => room.id));
    const groundMinimumAreaMm2 = DENSE_COURTYARD_CURRENT_REQUIREMENTS.rooms
      .filter((room) => room.floorId === "F0")
      .reduce((sum, room) => sum + room.minAreaMm2, 0) + 6_000_000;
    for (const scheme of result.schemes) {
      const realizedIds = new Set(scheme.floors.flatMap((floor) => floor.spaces.map((space) => space.id)));
      for (const roomId of requestedIds) expect(realizedIds.has(roomId), `missing ${roomId}`).toBe(true);
      expect(scheme.floors.every((floor) => floor.coverage.valid)).toBe(true);
      expect(scheme.floors.flatMap((floor) => floor.spaces).find((space) => space.type === "verandah")).toBeDefined();
      expect(scheme.floors.flatMap((floor) => floor.spaces).find((space) => space.type === "courtyard")).toBeDefined();
      expect(scheme.floors.find((floor) => floor.floorId === "F0")!.allocatedProgramAreaMm2)
        .toBeGreaterThan(groundMinimumAreaMm2 + 10_000_000);
    }
  });

  test("is deterministic for identical requirements", () => {
    expect(allocationFingerprint()).toEqual(allocationFingerprint());
  });

  test("realizes protected circulation without parking or open-outdoor relay", () => {
    const result = generateV3CirculationStage(DENSE_COURTYARD_CURRENT_REQUIREMENTS);
    expect(result.schemes.length).toBeGreaterThan(0);
    for (const scheme of result.schemes) {
      expect(scheme.circulationGraph.unreachableSpaceIds).toEqual([]);
      const typeById = new Map(scheme.floors.flatMap((floor) =>
        floor.spaces.map((space) => [space.id, space.type] as const)));
      const privateTypes = new Set(["bedroom", "bathroom", "pooja", "study"]);
      for (const opening of scheme.floors.flatMap((floor) => floor.openings)) {
        if (!opening.connects.some((id) => privateTypes.has(typeById.get(id) ?? ""))) continue;
        expect(opening.connects.some((id) =>
          typeById.get(id) === "parking"
          || typeById.get(id) === "verandah"
          || typeById.get(id) === "courtyard"
          || typeById.get(id) === "terrace")).toBe(false);
      }
    }
  });

  test("completes physical roofs, supports, guards and authoritative validation", async () => {
    const physical = generateV3PhysicalStage(DENSE_COURTYARD_CURRENT_REQUIREMENTS);
    expect(physical.schemes.length).toBeGreaterThan(0);
    expect(physical.diagnostics.roofSystemCount).toBeGreaterThan(0);
    expect(physical.diagnostics.secondarySupportCount).toBeGreaterThan(0);
    expect(physical.diagnostics.edgeProtectionCount).toBeGreaterThan(0);

    const result = await runDesignPipelineV3(DENSE_COURTYARD_CURRENT_REQUIREMENTS, {
      reviewComplete: async () => ({ summary: "Fixture review.", findings: [], recommendations: [] }),
    });
    expect(result.status).toBe("generated");
    if (result.status !== "generated") return;
    expect(result.validation.valid).toBe(true);
    expect(result.validation.findings.filter((finding) => finding.severity === "error")).toEqual([]);
    expect(result.building.facadeZones.find((zone) => zone.containsMainEntry)?.side)
      .toBe("north");
  });
});
