import { describe, expect, test } from "bun:test";

import { generateBuilding, BuildingGenerationError } from "@/lib/building/generate";
import { buildingRequirementsSchema, squareMetresToMm2, type BuildingRequirements, type RoomRequirement, type RoomType } from "@/lib/building/requirements";
import { analyzeCoverage, deriveClearSpaceBounds, isOpenToSkySpace } from "@/lib/building/topology";
import { circulationPassageConflicts, unreachableOccupiedSpaces } from "@/lib/building/circulation";
import { validateBuilding } from "@/lib/validation";
import { generateRecursiveSlicingCandidate } from "@/lib/building/candidates/recursive-slicing";
import { generateSpineGrowthCandidate } from "@/lib/building/candidates/spine-growth";

function requirements(floorCount: 1 | 2 | 3 | 4 = 1): BuildingRequirements {
  const floors = Array.from({ length: floorCount }, (_, level) => ({
    id: `F${level}` as `F${0 | 1 | 2 | 3}`,
    label: level === 0 ? "Ground" : `Floor ${level}`,
    level,
    floorHeightMm: 3000,
  }));
  const roomTemplates = [
    { suffix: "living", name: "Living", type: "living" as const, area: 18, privacy: "public" as const, zone: "north" as const },
    { suffix: "kitchen", name: "Kitchen", type: "kitchen" as const, area: 10, privacy: "service" as const, zone: "southeast" as const },
    { suffix: "bed", name: "Bedroom", type: "bedroom" as const, area: 14, privacy: "private" as const, zone: "southwest" as const },
    { suffix: "bath", name: "Bathroom", type: "bathroom" as const, area: 5, privacy: "service" as const, zone: "west" as const },
  ];
  return {
    requirementSchemaVersion: 2,
    projectName: "Deterministic residential fixture",
    buildingType: "detached_house",
    region: { countryCode: "IN", adminArea: "Kerala", locality: "Kochi", locale: "en-IN", currency: "INR" },
    displayUnit: "metric",
    site: {
      widthMm: 12_000, depthMm: 18_000, facing: "east", roadEdges: ["east"], irregular: false,
      setbacksMm: { north: 1000, east: 1000, south: 1000, west: 1000 },
    },
    floors,
    rooms: floors.flatMap((floor) => roomTemplates.map((room) => ({
      id: `${floor.id.toLowerCase()}-${room.suffix}`,
      name: `${room.name} ${floor.label}`,
      type: room.type,
      floorId: floor.id,
      minAreaMm2: squareMetresToMm2(room.area * 0.75),
      targetAreaMm2: squareMetresToMm2(room.area),
      privacy: room.privacy,
      preferredZone: room.zone,
      mustBeExterior: room.type === "living",
      accessible: floor.level === 0,
    }))),
    relationships: [],
    household: { occupants: 5, accessibilityRequired: true },
    vertical: { stairFamily: "dog_leg", stairWidthMm: 1000, liftProvision: false },
    architecture: { style: "contemporary_tropical", formStrategy: "stepped_terraces", roofCharacter: "mixed", materialDirection: "warm_natural" },
    budget: { qualityTier: "standard", contingencyPercent: 7.5, taxPercent: 0 },
    seed: 42,
  };
}

function denseMultiStoryRecoveryRequirements(seed: number): BuildingRequirements {
  const rooms: RoomRequirement[] = [];
  const relationships: BuildingRequirements["relationships"] = [
    { type: "must_connect", fromRoomId: "foyer", toRoomId: "living" },
    { type: "must_connect", fromRoomId: "living", toRoomId: "dining" },
    { type: "prefer_near", fromRoomId: "dining", toRoomId: "kitchen" },
    { type: "prefer_near", fromRoomId: "kitchen", toRoomId: "utility" },
  ];
  const areas: Record<RoomType, readonly [number, number]> = {
    living: [15, 22], dining: [9, 13], kitchen: [8, 12], bedroom: [10, 14], bathroom: [3.2, 4.5],
    pooja: [2.5, 4], utility: [3.5, 5], foyer: [3, 5], parking: [14, 18], study: [7, 10],
    balcony: [4, 7], circulation: [4, 8], stair: [6, 9], store: [2, 3], courtyard: [8, 14], terrace: [8, 16],
  };
  const add = (
    id: string,
    name: string,
    type: RoomType,
    floorId: string,
    privacy: RoomRequirement["privacy"],
    options: Partial<Pick<RoomRequirement, "preferredZone" | "mustBeExterior" | "accessible">> = {},
  ) => {
    const [minimum, target] = areas[type];
    rooms.push({
      id, name, type, floorId,
      minAreaMm2: squareMetresToMm2(minimum),
      targetAreaMm2: squareMetresToMm2(target),
      privacy,
      preferredZone: options.preferredZone ?? "any",
      mustBeExterior: options.mustBeExterior ?? false,
      accessible: options.accessible ?? false,
    });
  };

  add("foyer", "Entry foyer", "foyer", "F0", "public", { preferredZone: "east" });
  add("living", "Living room", "living", "F0", "public", { mustBeExterior: true });
  add("dining", "Dining", "dining", "F0", "public");
  add("kitchen", "Kitchen", "kitchen", "F0", "service", { mustBeExterior: true });
  add("circulation-f0", "Circulation", "circulation", "F0", "semi_private");
  add("utility", "Utility", "utility", "F0", "service", { mustBeExterior: true });
  add("pooja", "Pooja", "pooja", "F0", "private", { preferredZone: "northeast" });
  add("courtyard", "Courtyard", "courtyard", "F0", "semi_private", { preferredZone: "center", mustBeExterior: true });
  add("parking", "Covered parking", "parking", "F0", "service", { preferredZone: "east", mustBeExterior: true });

  const programs = [
    { bedrooms: 1, bathrooms: 2, attachedBathrooms: 1, studies: 1, balcony: false },
    { bedrooms: 2, bathrooms: 2, attachedBathrooms: 1, studies: 1, balcony: true },
    { bedrooms: 1, bathrooms: 1, attachedBathrooms: 1, studies: 1, balcony: true },
  ];
  const firstBathrooms: string[] = [];
  for (const [level, program] of programs.entries()) {
    const floorId = `F${level}`;
    if (level > 0) add(`circulation-f${level}`, "Upper lobby", "circulation", floorId, "semi_private");
    for (let index = 1; index <= program.bedrooms; index += 1) {
      const id = `bedroom-f${level}-${index}`;
      add(id, `L${level} Bedroom ${index}`, "bedroom", floorId, "private", { mustBeExterior: true });
      relationships.push({ type: "prefer_near", fromRoomId: id, toRoomId: `circulation-f${level}` });
    }
    for (let index = 1; index <= program.bathrooms; index += 1) {
      const id = `bathroom-f${level}-${index}`;
      add(id, `L${level} ${index <= program.attachedBathrooms ? "Attached bathroom" : "Bathroom"} ${index}`, "bathroom", floorId, "service", { mustBeExterior: true });
      if (index <= program.attachedBathrooms) relationships.push({ type: "must_connect", fromRoomId: `bedroom-f${level}-${index}`, toRoomId: id });
      if (index === 1) firstBathrooms.push(id);
    }
    for (let index = 1; index <= program.studies; index += 1) add(`study-f${level}-${index}`, "Study / office", "study", floorId, "private", { mustBeExterior: true });
    if (level > 0 && program.balcony) add(`balcony-f${level}`, "Balcony", "balcony", floorId, "semi_private", { mustBeExterior: true });
  }
  for (let index = 1; index < firstBathrooms.length; index += 1) relationships.push({ type: "stack_with", fromRoomId: firstBathrooms[index], toRoomId: firstBathrooms[index - 1] });

  return {
    requirementSchemaVersion: 2,
    projectName: "Dense G+2 recovery regression",
    buildingType: "detached_house",
    region: { countryCode: "IN", adminArea: "Kerala", locality: "Kochi", locale: "en-IN", currency: "INR" },
    displayUnit: "metric",
    site: {
      widthMm: 12_000, depthMm: 18_000, facing: "east", roadEdges: ["south", "east"], irregular: false,
      setbacksMm: { north: 1500, east: 1200, south: 2500, west: 1200 },
    },
    floors: [
      { id: "F0", label: "Ground floor", level: 0, floorHeightMm: 3100 },
      { id: "F1", label: "Floor 1", level: 1, floorHeightMm: 3100 },
      { id: "F2", label: "Floor 2", level: 2, floorHeightMm: 3100 },
    ],
    rooms,
    relationships,
    household: { occupants: 5, accessibilityRequired: false },
    vertical: { stairFamily: "dog_leg", stairWidthMm: 1000, liftProvision: true },
    architecture: { style: "contemporary_tropical", formStrategy: "stepped_terraces", roofCharacter: "mixed", materialDirection: "warm_natural" },
    budget: { qualityTier: "standard", contingencyPercent: 7.5, taxPercent: 0 },
    seed,
  };
}

describe("topology-first residential generator", () => {
  test("rejects duplicate, skipped, or mismatched canonical floors", () => {
    const duplicateLevel = structuredClone(requirements(2));
    duplicateLevel.floors[1].level = 0;
    expect(buildingRequirementsSchema.safeParse(duplicateLevel).success).toBe(false);

    const skippedLevel = structuredClone(requirements(2));
    skippedLevel.floors[1] = { ...skippedLevel.floors[1], id: "F2", level: 2 };
    skippedLevel.rooms.filter((room) => room.floorId === "F1").forEach((room) => { room.floorId = "F2"; });
    expect(buildingRequirementsSchema.safeParse(skippedLevel).success).toBe(false);

    const mismatchedId = structuredClone(requirements(1));
    mismatchedId.floors[0].id = "F1";
    mismatchedId.rooms.forEach((room) => { room.floorId = "F1"; });
    expect(buildingRequirementsSchema.safeParse(mismatchedId).success).toBe(false);

    const reversedButCanonical = structuredClone(requirements(2));
    reversedButCanonical.floors.reverse();
    expect(buildingRequirementsSchema.safeParse(reversedButCanonical).success).toBe(true);
  });

  test("generates an exact, deterministic and reachable ground-floor topology", () => {
    const input = requirements(1);
    const first = generateBuilding(input);
    const second = generateBuilding(input);
    expect(second).toEqual(first);
    expect(first.validation.valid).toBe(true);
    expect(circulationPassageConflicts(first.building, input)).toEqual([]);
    expect(first.evaluatedCandidateCount).toBeGreaterThan(0);
    expect(first.building.rendererVersion).toBe("cad-svg-v2");
    expect(unreachableOccupiedSpaces(first.building)).toEqual([]);

    const floor = first.building.floors[0];
    expect(analyzeCoverage(floor.envelope, floor.spaces)).toEqual({
      envelopeAreaMm2: 160_000_000,
      coveredAreaMm2: 160_000_000,
      overlapAreaMm2: 0,
      gapAreaMm2: 0,
      outsideAreaMm2: 0,
    });
    expect(new Set(floor.walls.map((wall) => `${wall.start.x},${wall.start.y}:${wall.end.x},${wall.end.y}`)).size).toBe(floor.walls.length);
    const clear = deriveClearSpaceBounds(floor, floor.spaces[0]);
    expect(clear.width).toBeLessThan(floor.spaces[0].bounds.width);
    expect(clear.depth).toBeLessThan(floor.spaces[0].bounds.depth);
    expect(floor.openings.some((opening) => opening.connects.includes("EXTERIOR") && opening.kind !== "window")).toBe(true);
    expect(floor.openings.some((opening) => opening.kind === "window")).toBe(true);
  });

  test("turns noncompact taste into sectioned open-to-sky setbacks on every floor", () => {
    const input = requirements(3);
    input.site.facing = "east";
    input.site.roadEdges = ["east"];
    const result = generateBuilding(input);
    expect(result.validation.valid).toBe(true);
    for (const floor of result.building.floors) {
      const voids = floor.spaces.filter(isOpenToSkySpace);
      const constructedArea = floor.spaces.filter((space) => !isOpenToSkySpace(space)).reduce((sum, space) => sum + space.areaMm2, 0);
      expect(voids.length).toBeGreaterThan(0);
      expect(constructedArea).toBeLessThan(floor.envelope.width * floor.envelope.depth);
      expect(voids.some((space) => space.bounds.x + space.bounds.width === floor.envelope.x + floor.envelope.width)).toBe(true);
      expect(floor.walls.some((wall) => wall.type === "exterior" && wall.adjacentSpaceIds.some((id) => voids.some((space) => space.id === id)))).toBe(true);
      expect(floor.walls.every((wall) => !wall.adjacentSpaceIds.every((id) => voids.some((space) => space.id === id)))).toBe(true);
      expect(analyzeCoverage(floor.envelope, floor.spaces).gapAreaMm2).toBe(0);
    }
  });

  test("keeps compact villas efficient without inventing a footprint recess", () => {
    const input = requirements(2);
    input.architecture.formStrategy = "compact";
    const result = generateBuilding(input);
    expect(result.validation.valid).toBe(true);
    expect(result.building.floors.flatMap((floor) => floor.spaces).some(isOpenToSkySpace)).toBe(false);
  });

  test("uses nested side bays for an attached suite instead of parallel full-wing bands", () => {
    const floor = { id: "F0" as const, label: "Ground floor", level: 0, floorHeightMm: 3_100 };
    const envelope = { x: 0, y: 0, width: 10_000, depth: 14_000 };
    const base = {
      floorId: "F0" as const,
      privacy: "semi_private" as const,
      preferredZone: "any" as const,
      mustBeExterior: false,
      accessible: false,
    };
    const rooms: RoomRequirement[] = [
      { ...base, id: "circulation", name: "Gallery", type: "circulation", minAreaMm2: 8_000_000, targetAreaMm2: 12_000_000 },
      { ...base, id: "bedroom-suite", name: "Bedroom suite", type: "bedroom", privacy: "private", minAreaMm2: 12_000_000, targetAreaMm2: 15_000_000 },
      { ...base, id: "bathroom-suite", name: "Attached bathroom suite", type: "bathroom", privacy: "service", minAreaMm2: 3_200_000, targetAreaMm2: 4_500_000 },
      { ...base, id: "study", name: "Study", type: "study", privacy: "private", minAreaMm2: 8_000_000, targetAreaMm2: 10_000_000 },
    ];
    const candidate = generateSpineGrowthCandidate({ envelope, floor, rooms, seed: 42, variant: 0 });
    const bedroom = candidate.cells.find((cell) => cell.id === "bedroom-suite")!;
    const bathroom = candidate.cells.find((cell) => cell.id === "bathroom-suite")!;
    expect(bedroom.bounds.y).toBe(bathroom.bounds.y);
    expect(bedroom.bounds.depth).toBe(bathroom.bounds.depth);
    expect(bedroom.bounds.x).not.toBe(bathroom.bounds.x);
    expect(
      bedroom.bounds.x + bedroom.bounds.width === bathroom.bounds.x
      || bathroom.bounds.x + bathroom.bounds.width === bedroom.bounds.x,
    ).toBe(true);
  });

  for (const floorCount of [2, 3, 4] as const) {
    test(`supports a continuous G+${floorCount - 1} stair and valid topology`, () => {
      const input = requirements(floorCount);
      const result = generateBuilding(input);
      expect(result.validation.valid).toBe(true);
      expect(result.building.floors).toHaveLength(floorCount);
      expect(result.building.verticalConnectors).toHaveLength(1);
      const stair = result.building.verticalConnectors[0];
      expect(stair.servedFloorIds).toEqual(result.building.floors.map((floor) => floor.id));
      expect(new Set(Object.values(stair.boundsByFloor).map((bounds) => JSON.stringify(bounds))).size).toBe(1);
      expect(unreachableOccupiedSpaces(result.building)).toEqual([]);
      expect(circulationPassageConflicts(result.building, input)).toEqual([]);
      for (const floor of result.building.floors) {
        const audit = analyzeCoverage(floor.envelope, floor.spaces);
        expect(audit.gapAreaMm2).toBe(0);
        expect(audit.overlapAreaMm2).toBe(0);
      }
    });
  }

  test("rejects an impossible program with a stable typed error", () => {
    const input = requirements(2);
    input.rooms = input.rooms.map((room) => ({ ...room, minAreaMm2: squareMetresToMm2(100), targetAreaMm2: squareMetresToMm2(100) }));
    expect(() => generateBuilding(input)).toThrow(BuildingGenerationError);
    try {
      generateBuilding(input);
    } catch (error) {
      expect((error as BuildingGenerationError).code).toBe("UNSUPPORTED_PROGRAM_TOPOLOGY");
    }
  });

  test("honours a feasible required direct connection", () => {
    const input = requirements(1);
    input.relationships = [{ type: "must_connect", fromRoomId: "f0-living", toRoomId: "f0-kitchen" }];
    const result = generateBuilding(input);
    expect(result.validation.valid).toBe(true);
    expect(result.building.floors[0].openings.some((opening) =>
      opening.kind !== "window" && opening.connects.includes("f0-living") && opening.connects.includes("f0-kitchen"),
    )).toBe(true);
  });

  test("recovers the exact historical G+2 lift brief across every previously failed server seed", () => {
    const historicalSeeds = [126_151_910, 3_150_183_438, 3_827_664_302, 2_807_986_978, 2_871_937_447];
    const geometryHashes = new Set<string>();
    for (const seed of historicalSeeds) {
      const input = denseMultiStoryRecoveryRequirements(seed);
      expect(input.rooms).toHaveLength(25);
      expect(input.vertical.liftProvision).toBe(true);
      const generated = generateBuilding(input);
      geometryHashes.add(generated.building.candidate.geometryHash);
      expect(generated.validation.valid).toBe(true);
      expect(circulationPassageConflicts(generated.building, input)).toEqual([]);
      expect(generated.building.seed).toBe(seed);
      expect(generated.building.floors).toHaveLength(3);
      expect(generated.evaluatedCandidateCount).toBeGreaterThan(0);
      expect(generated.evaluatedCandidateCount).toBeLessThanOrEqual(1152);
      for (const relation of input.relationships.filter((candidate) => candidate.type === "must_connect")) {
        expect(generated.building.floors.some((floor) => floor.openings.some((opening) =>
          opening.kind !== "window" && opening.connects.includes(relation.fromRoomId) && opening.connects.includes(relation.toRoomId),
        ))).toBe(true);
      }
      for (const relation of input.relationships.filter((candidate) => {
        const from = input.rooms.find((room) => room.id === candidate.fromRoomId);
        const to = input.rooms.find((room) => room.id === candidate.toRoomId);
        return candidate.type === "must_connect" && from?.type === "bedroom" && to?.type === "bathroom";
      })) {
        const bathroomOpenings = generated.building.floors
          .flatMap((floor) => floor.openings)
          .filter((opening) => opening.kind !== "window" && opening.connects.includes(relation.toRoomId));
        expect(bathroomOpenings).toHaveLength(1);
        expect(bathroomOpenings[0].connects).toContain(relation.fromRoomId);
      }
    }
    expect(geometryHashes.size).toBe(1);
  });

  test("keeps dense-brief feasibility independent of a broader bounded style-seed sample", () => {
    const sampleSeeds = Array.from({ length: 12 }, (_, index) => Math.imul(index + 1, 0x9e3779b1) >>> 0);
    const results = sampleSeeds.map((seed) => generateBuilding(denseMultiStoryRecoveryRequirements(seed)));
    expect(results.every((result) => result.validation.valid)).toBe(true);
    expect(new Set(results.map((result) => result.building.candidate.geometryHash)).size).toBe(1);
  });

  test("summarizes bounded construction rejection reasons without changing the typed failure", () => {
    const input = requirements(2);
    input.site = {
      ...input.site,
      widthMm: 5_000,
      setbacksMm: { north: 0, east: 0, south: 0, west: 0 },
    };
    input.vertical = { ...input.vertical, stairWidthMm: 2_400 };
    try {
      generateBuilding(input);
      throw new Error("Expected generation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(BuildingGenerationError);
      expect((error as BuildingGenerationError).code).toBe("NO_FEASIBLE_LAYOUT");
      expect((error as BuildingGenerationError).message).toContain("Construction rejections: STAIR_CORE_EXCEEDS_ENVELOPE=");
    }
  });

  test("keeps a requested upper-floor balcony near target and assigns sparse surplus to open terrace", () => {
    const input = requirements(2);
    input.rooms.push({
      id: "f1-circulation",
      name: "Upper lobby",
      type: "circulation",
      floorId: "F1",
      minAreaMm2: squareMetresToMm2(4),
      targetAreaMm2: squareMetresToMm2(8),
      privacy: "semi_private",
      preferredZone: "center",
      mustBeExterior: false,
      accessible: false,
    }, {
      id: "f1-balcony",
      name: "Balcony",
      type: "balcony",
      floorId: "F1",
      minAreaMm2: squareMetresToMm2(4),
      targetAreaMm2: squareMetresToMm2(7),
      privacy: "semi_private",
      preferredZone: "south",
      mustBeExterior: true,
      accessible: false,
    });
    const result = generateBuilding(input);
    const upper = result.building.floors[1];
    const balcony = upper.spaces.find((space) => space.id === "f1-balcony");
    const terrace = upper.spaces.find((space) => space.type === "terrace");
    expect(result.validation.valid).toBe(true);
    expect(balcony).toBeDefined();
    expect((balcony?.areaMm2 ?? Number.POSITIVE_INFINITY) / 1_000_000).toBeLessThanOrEqual(10);
    if (terrace) {
      expect(["Open terrace / unbuilt", "Sectioned setback terrace"]).toContain(terrace.name);
      expect(terrace.occupied).toBe(false);
    }
    expect(analyzeCoverage(upper.envelope, upper.spaces).gapAreaMm2).toBe(0);
  });

  test("normalizes oversized balconies for both recursive and spine candidate families", () => {
    const floor = { id: "F1", label: "Floor 1", level: 1, floorHeightMm: 3_000 };
    const envelope = { x: 1_000, y: 1_000, width: 10_000, depth: 16_000 };
    const balcony = {
      id: "f1-balcony-only",
      name: "Balcony",
      type: "balcony" as const,
      floorId: "F1",
      minAreaMm2: squareMetresToMm2(4),
      targetAreaMm2: squareMetresToMm2(7),
      privacy: "semi_private" as const,
      preferredZone: "south" as const,
      mustBeExterior: true,
      accessible: false,
    };
    for (const generator of [generateRecursiveSlicingCandidate, generateSpineGrowthCandidate]) {
      const circulation = {
        ...balcony,
        id: "f1-circulation",
        name: "Upper lobby",
        type: "circulation" as const,
        targetAreaMm2: squareMetresToMm2(8),
        preferredZone: "center" as const,
      };
      const bedroom = {
        ...balcony,
        id: "f1-bedroom",
        name: "Bedroom",
        type: "bedroom" as const,
        minAreaMm2: squareMetresToMm2(10),
        targetAreaMm2: squareMetresToMm2(14),
        privacy: "private" as const,
        preferredZone: "west" as const,
      };
      const candidate = generator({ envelope, floor, rooms: [circulation, bedroom, balcony], seed: 42, variant: 0 });
      const balconyCell = candidate.cells.find((cell) => cell.id === balcony.id);
      const terraceCell = candidate.cells.find((cell) => cell.type === "terrace");
      const balconyArea = (balconyCell?.bounds.width ?? 0) * (balconyCell?.bounds.depth ?? 0);
      const terraceArea = (terraceCell?.bounds.width ?? 0) * (terraceCell?.bounds.depth ?? 0);
      expect(balconyArea).toBeLessThanOrEqual(10_000_000);
      expect(terraceArea).toBeGreaterThan(0);
      expect(balconyArea + terraceArea).toBeGreaterThan(10_000_000);
    }
  });

  test("structured validation identifies deliberate gaps and broken circulation", () => {
    const input = requirements(1);
    const generated = generateBuilding(input).building;
    const floor = generated.floors[0];
    const broken = structuredClone(generated);
    broken.floors[0].spaces[0].bounds.width -= 100;
    broken.floors[0].spaces[0].areaMm2 = broken.floors[0].spaces[0].bounds.width * broken.floors[0].spaces[0].bounds.depth;
    broken.floors[0].openings = floor.openings.filter((opening) => !opening.connects.includes(floor.spaces[0].id));
    const report = validateBuilding(broken, input);
    expect(report.valid).toBe(false);
    expect(report.findings.map((finding) => finding.ruleId)).toContain("GEOMETRY_NO_GAPS");
    expect(report.findings.map((finding) => finding.ruleId)).toContain("OPENING_REQUIRED");
    expect(report.findings.map((finding) => finding.ruleId)).toContain("CIRCULATION_REACHABLE");
  });
});
