import { describe, expect, test } from "bun:test";

import { BUILDING_FIXTURES } from "@/lib/building/fixtures";
import {
  BuildingGenerationError,
  MAX_CONSTRUCTED_CANDIDATES,
  SCHEME_WATCHDOG_MS,
  buildDeterministicQuotaPlan,
  generateBuilding,
  generateBuildingSchemes,
  selectDistinctGeneratedSchemes,
  type GeneratedBuilding,
} from "@/lib/building/generate";
import { buildRelaxationLadder } from "@/lib/building/relaxation";
import type { PartiId } from "@/lib/building/partis";

const fixture = BUILDING_FIXTURES[0].requirements;

function candidate(
  source: GeneratedBuilding,
  partiId: PartiId,
  geometryHash: string,
  index: number,
  score: number,
): GeneratedBuilding {
  return {
    ...source,
    building: {
      ...source.building,
      candidate: {
        ...source.building.candidate,
        generatorId: partiId,
        geometryHash,
        index,
        score,
        relaxation: {
          rung: index === 0 ? 0 : 1,
          id: index === 0 ? "preferred_parti" : "alternate_parti",
          simplifiedCourt: false,
        },
      },
    },
  };
}

describe("multi-scheme generation", () => {
  test("uses deterministic per-parti/per-rung quotas below the global ceiling", () => {
    const ladder = buildRelaxationLadder(["t_hub", "l_court", "courtyard", "compact"]);
    const first = buildDeterministicQuotaPlan(ladder);
    const second = buildDeterministicQuotaPlan(ladder);

    expect(second).toEqual(first);
    expect(first.reduce((sum, item) => sum + item.quota, 0)).toBeLessThanOrEqual(MAX_CONSTRUCTED_CANDIDATES);
    expect(new Set(first.map((item) => `${item.partiId}:${item.rung}:${item.relaxationId}`)).size).toBe(first.length);
    expect(first.every((item) => item.quota > 0)).toBe(true);
  });

  test("filters exact duplicates and selects different partis before same-parti alternatives", () => {
    const generated = generateBuilding(fixture);
    const candidates = [
      candidate(generated, "t_hub", "geometry-a", 0, 80),
      candidate(generated, "t_hub", "geometry-b", 1, 100),
      candidate(generated, "l_court", "geometry-c", 2, 70),
      candidate(generated, "l_court", "geometry-c", 3, 99),
      candidate(generated, "courtyard", "geometry-d", 4, 60),
    ];

    const first = selectDistinctGeneratedSchemes(candidates);
    const second = selectDistinctGeneratedSchemes(candidates);

    expect(first.map((scheme) => scheme.partiId)).toEqual(["t_hub", "l_court", "courtyard"]);
    expect(first.map((scheme) => scheme.schemeId)).toEqual(second.map((scheme) => scheme.schemeId));
    expect(new Set(first.map((scheme) => scheme.building.candidate.geometryHash)).size).toBe(first.length);
    expect(first).toHaveLength(3);
  });

  test("admits a same-parti alternative only after at least one quarter of room quadrants change", () => {
    const generated = generateBuilding(fixture);
    const unchanged = candidate(generated, "t_hub", "geometry-b", 1, 90);
    const changed = candidate(generated, "t_hub", "geometry-c", 2, 80);
    changed.building = {
      ...changed.building,
      floors: changed.building.floors.map((floor, floorIndex) => ({
        ...floor,
        spaces: floor.spaces.map((space, spaceIndex) => floorIndex === 0 && spaceIndex < Math.ceil(floor.spaces.length / 2) ? {
          ...space,
          bounds: {
            ...space.bounds,
            x: floor.envelope.x + floor.envelope.width - (space.bounds.x - floor.envelope.x) - space.bounds.width,
          },
        } : space),
      })),
    };
    const duplicateChanged = candidate(generated, "t_hub", "geometry-d", 3, 70);
    duplicateChanged.building = { ...duplicateChanged.building, floors: changed.building.floors };
    const selected = selectDistinctGeneratedSchemes([
      candidate(generated, "t_hub", "geometry-a", 0, 100),
      unchanged,
      changed,
      duplicateChanged,
    ]);
    expect(selected.map((scheme) => scheme.building.candidate.geometryHash)).toEqual(["geometry-a", "geometry-c"]);
  });

  test("returns up to three stable schemes while preserving the legacy facade", () => {
    const legacy = generateBuilding(fixture);
    const first = generateBuildingSchemes(fixture);
    const second = generateBuildingSchemes(fixture);

    expect(first.schemes.length).toBeGreaterThan(0);
    expect(first.schemes.length).toBeLessThanOrEqual(3);
    expect(first.schemes.map((scheme) => scheme.schemeId)).toEqual(second.schemes.map((scheme) => scheme.schemeId));
    expect(first.schemes.map((scheme) => scheme.building.candidate.geometryHash)).toEqual(
      second.schemes.map((scheme) => scheme.building.candidate.geometryHash),
    );
    expect(first.diagnostics.plannedCandidateCount).toBeLessThanOrEqual(MAX_CONSTRUCTED_CANDIDATES);
    expect(first.diagnostics.constructedCandidateCount).toBeLessThanOrEqual(first.diagnostics.plannedCandidateCount);
    expect(legacy.validation.valid).toBe(true);
  });

  test("binds named partis to distinct physical composition features", () => {
    const result = generateBuildingSchemes(BUILDING_FIXTURES[1].requirements);
    expect(result.schemes.map((scheme) => scheme.partiId)).toEqual(["l_court", "t_hub", "verandah_bungalow"]);
    expect(new Set(result.schemes.map((scheme) => scheme.building.candidate.geometryHash)).size).toBe(3);
    const lCourt = result.schemes.find((scheme) => scheme.partiId === "l_court");
    const tHub = result.schemes.find((scheme) => scheme.partiId === "t_hub");
    const verandah = result.schemes.find((scheme) => scheme.partiId === "verandah_bungalow");
    expect(lCourt?.building.floors[0].spaces.some((space) => space.type === "courtyard" && !space.occupied)).toBe(true);
    expect(tHub?.building.floors[0].spaces.some((space) => space.type === "courtyard")).toBe(false);
    const entryVerandah = verandah?.building.floors[0].spaces.find((space) => space.id.endsWith("entry-verandah"));
    expect(entryVerandah?.perimeterOpen).toBe(true);
  });

  test("throws a typed timeout without exposing partial schemes when the 8s watchdog expires", () => {
    const ticks = [0, 0, SCHEME_WATCHDOG_MS + 1];
    const now = () => ticks.shift() ?? SCHEME_WATCHDOG_MS + 1;

    try {
      generateBuildingSchemes(fixture, { now });
      throw new Error("Expected generation to time out");
    } catch (error) {
      expect(error).toBeInstanceOf(BuildingGenerationError);
      expect((error as BuildingGenerationError).code).toBe("GENERATION_TIMEOUT");
      expect("schemes" in (error as object)).toBe(false);
      expect((error as BuildingGenerationError).cause).toMatchObject({
        watchdogMs: SCHEME_WATCHDOG_MS,
        constructedCandidateCount: 1,
      });
    }
  });
});
