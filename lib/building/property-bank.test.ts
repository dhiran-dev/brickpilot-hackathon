import { describe, expect, test } from "bun:test";

import { generateBuildingSchemes } from "@/lib/building/generate";
import { buildingRequirementsSchema, squareMetresToMm2, type BuildingRequirements } from "@/lib/building/requirements";
import { shapeRuleFindings } from "@/lib/validation/shape-rules";

const PROPERTY_BANK_SEEDS = [1, 17, 42, 101, 997, 4096, 65537, 2871937447] as const;
const FLOOR_COUNTS = [1, 2, 3, 4] as const;
const PROPERTY_FIXTURES = [
  { id: "east-coastal", widthMm: 12_000, depthMm: 18_000, facing: "east" as const },
  { id: "north-suburban", widthMm: 13_000, depthMm: 19_000, facing: "north" as const },
  { id: "west-urban", widthMm: 14_000, depthMm: 20_000, facing: "west" as const },
] as const;
const MULTIPLICITY_REPORT: Array<{ fixtureId: string; floorCount: number; seed: number; schemeCount: number }> = [];

function requirementsFor(
  fixture: (typeof PROPERTY_FIXTURES)[number],
  floorCount: (typeof FLOOR_COUNTS)[number],
  seed: number,
): BuildingRequirements {
  const floors = Array.from({ length: floorCount }, (_, level) => ({
    id: `F${level}`,
    label: level === 0 ? "Ground floor" : `Floor ${level}`,
    level,
    floorHeightMm: 3_100,
  }));
  const roomTemplates = [
    { suffix: "living", name: "Living", type: "living" as const, areaM2: 18, privacy: "public" as const, preferredZone: "north" as const },
    { suffix: "kitchen", name: "Kitchen", type: "kitchen" as const, areaM2: 10, privacy: "service" as const, preferredZone: "southeast" as const },
    { suffix: "bedroom", name: "Bedroom", type: "bedroom" as const, areaM2: 14, privacy: "private" as const, preferredZone: "southwest" as const },
    { suffix: "bathroom", name: "Bathroom", type: "bathroom" as const, areaM2: 5, privacy: "service" as const, preferredZone: "west" as const },
  ];

  return buildingRequirementsSchema.parse({
    requirementSchemaVersion: 2,
    projectName: `${fixture.id} · ${floorCount} floor${floorCount === 1 ? "" : "s"}`,
    buildingType: "detached_house",
    region: { countryCode: "IN", adminArea: "Kerala", locality: "Kochi", locale: "en-IN", currency: "INR" },
    displayUnit: "metric",
    site: {
      widthMm: fixture.widthMm,
      depthMm: fixture.depthMm,
      facing: fixture.facing,
      roadEdges: [fixture.facing],
      irregular: false,
      setbacksMm: { north: 1_000, east: 1_000, south: 1_000, west: 1_000 },
    },
    floors,
    rooms: floors.flatMap((floor) => roomTemplates.map((room) => ({
      id: `${floor.id.toLowerCase()}-${room.suffix}`,
      name: `${room.name} · ${floor.label}`,
      type: room.type,
      floorId: floor.id,
      minAreaMm2: squareMetresToMm2(room.areaM2 * 0.75),
      targetAreaMm2: squareMetresToMm2(room.areaM2),
      privacy: room.privacy,
      preferredZone: room.preferredZone,
      mustBeExterior: room.type === "living",
      accessible: floor.level === 0,
    }))),
    relationships: [],
    household: { occupants: 5, accessibilityRequired: true },
    vertical: { stairFamily: "dog_leg", stairWidthMm: 1_000, liftProvision: false },
    architecture: { style: "contemporary_tropical", formStrategy: "stepped_terraces", roofCharacter: "mixed", materialDirection: "warm_natural" },
    budget: { qualityTier: "standard", contingencyPercent: 7.5, taxPercent: 0 },
    seed,
  });
}

function circulationRatio(building: ReturnType<typeof generateBuildingSchemes>["schemes"][number]["building"]) {
  return building.floors.map((floor) => {
    const constructedArea = floor.spaces
      .filter((space) => space.occupied)
      .reduce((sum, space) => sum + space.areaMm2, 0);
    const circulationArea = floor.spaces
      .filter((space) => space.occupied && space.type === "circulation")
      .reduce((sum, space) => sum + space.areaMm2, 0);
    return constructedArea === 0 ? 0 : circulationArea / constructedArea;
  });
}

describe("T12 deterministic property and multiplicity bank", () => {
  for (const fixture of PROPERTY_FIXTURES) {
    for (const floorCount of FLOOR_COUNTS) {
      test(`${fixture.id} × ${floorCount} floor(s) × 8 seeds`, () => {
        const rows = PROPERTY_BANK_SEEDS.map((seed) => {
          const requirements = requirementsFor(fixture, floorCount, seed);
          const first = generateBuildingSchemes(requirements);
          const replay = generateBuildingSchemes(requirements);
          const firstHashes = first.schemes.map((scheme) => scheme.building.candidate.geometryHash);
          const replayHashes = replay.schemes.map((scheme) => scheme.building.candidate.geometryHash);

          expect(firstHashes).toEqual(replayHashes);
          expect(first.diagnostics.quotaUsage).toEqual(replay.diagnostics.quotaUsage);
          expect(first.diagnostics.constructedCandidateCount).toBe(replay.diagnostics.constructedCandidateCount);
          expect(first.schemes.length).toBeGreaterThanOrEqual(1);
          expect(first.schemes.length).toBeLessThanOrEqual(3);
          expect(new Set(firstHashes).size).toBe(firstHashes.length);

          for (const scheme of first.schemes) {
            expect(scheme.validation.valid).toBe(true);
            expect(shapeRuleFindings(scheme.building)).toEqual([]);
            for (const ratio of circulationRatio(scheme.building)) {
              expect(ratio).toBeLessThanOrEqual(0.15);
            }
          }

          return {
            seed,
            schemeCount: first.schemes.length,
            hashes: firstHashes,
            quotaUsage: first.diagnostics.quotaUsage.map((quota) => quota.attempted),
          };
        });

        // Feasibility is seed-independent: every supported seed returned a complete set, while
        // multiplicity is recorded explicitly instead of assuming that every brief yields three.
        expect(rows).toHaveLength(PROPERTY_BANK_SEEDS.length);
        expect(rows.every((row) => row.schemeCount >= 1 && row.schemeCount <= 3)).toBe(true);
        expect(new Set(rows.map((row) => row.quotaUsage.join(","))).size).toBe(1);
        MULTIPLICITY_REPORT.push(...rows.map((row) => ({
          fixtureId: fixture.id,
          floorCount,
          seed: row.seed,
          schemeCount: row.schemeCount,
        })));
      }, 30_000);
    }
  }

  test("locks the aggregate multiplicity report used by the scheme-rack evidence gate", () => {
    const singleSchemeRuns = MULTIPLICITY_REPORT.filter((row) => row.schemeCount === 1).length;
    const multiSchemeRuns = MULTIPLICITY_REPORT.filter((row) => row.schemeCount > 1).length;
    expect({
      totalRuns: MULTIPLICITY_REPORT.length,
      singleSchemeRuns,
      multiSchemeRuns,
      multiSchemeCoveragePercent: Number((multiSchemeRuns / MULTIPLICITY_REPORT.length * 100).toFixed(1)),
    }).toEqual({
      totalRuns: 96,
      singleSchemeRuns: 8,
      multiSchemeRuns: 88,
      multiSchemeCoveragePercent: 91.7,
    });
  });
});
