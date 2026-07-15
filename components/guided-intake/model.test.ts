import { describe, expect, test } from "bun:test";

import { buildingRequirementsSchema } from "@/lib/building/requirements";
import { generateBuilding } from "@/lib/building/generate";
import { assessBriefCapacity, createRequirements, DEFAULT_INTAKE_DRAFT, draftFromRequirements, floorProgramBrief, normalizeFloorProgram, updateFloorProgramBrief, upgradeLegacyFloorProgram, type FloorProgram } from "@/components/guided-intake/model";

describe("guided intake mapping", () => {
  test("emits a schema-valid structured ground-floor brief", () => {
    const requirements = createRequirements(DEFAULT_INTAKE_DRAFT);
    expect(buildingRequirementsSchema.safeParse(requirements).success).toBe(true);
    expect(requirements.buildingType).toBe("detached_house");
    expect(requirements.region.currency).toBe("INR");
    expect(requirements.site.widthMm).toBe(12_000);
    expect(requirements.rooms.some((room) => room.type === "living")).toBe(true);
    expect(requirements.rooms.some((room) => room.type === "bedroom")).toBe(true);
  });

  test("generates the default attached-first brief with a valid direct bathroom connection", () => {
    const requirements = createRequirements(DEFAULT_INTAKE_DRAFT);
    const generated = generateBuilding(requirements);
    expect(generated.validation.valid).toBe(true);
    expect(requirements.relationships).toContainEqual({
      type: "must_connect",
      fromRoomId: "bedroom-f0-1",
      toRoomId: "bathroom-f0-1",
    });
  });

  test("supports G+3 with one generator-owned stair core per floor", () => {
    const requirements = createRequirements({ ...DEFAULT_INTAKE_DRAFT, projectName: "Four-level home", floorCount: 4, accessibilityRequired: true });
    expect(requirements.floors).toHaveLength(4);
    expect(requirements.rooms.filter((room) => room.type === "stair")).toHaveLength(0);
    expect(requirements.rooms.some((room) => room.floorId === "F3" && room.type === "bedroom")).toBe(true);
    expect(requirements.rooms.some((room) => room.accessible && room.floorId === "F0" && room.type === "bedroom")).toBe(true);
    expect(requirements.relationships.some((relationship) => relationship.type === "stack_with")).toBe(true);
    const generated = generateBuilding(requirements);
    expect(generated.building.floors.every((floor) => floor.spaces.filter((space) => space.type === "stair").length === 1)).toBe(true);
  });

  test("generates the previously failing dense G+1 courtyard brief without duplicate stair rooms", () => {
    for (const seed of [1, 4, 26, 44, 84, 99]) {
      const requirements = createRequirements({
        ...DEFAULT_INTAKE_DRAFT,
        programs: DEFAULT_INTAKE_DRAFT.programs.map((program) => ({ ...program, attachedBathrooms: 0 })),
        floorCount: 2,
        facing: "east",
        roadEdges: ["south"],
        includeCourtyard: true,
        liftProvision: true,
        taxPercent: 18,
        seed,
      });
      const generated = generateBuilding(requirements);
      expect(generated.validation.valid).toBe(true);
      expect(generated.building.floors).toHaveLength(2);
      expect(generated.building.floors.every((floor) => floor.spaces.filter((space) => space.type === "stair").length === 1)).toBe(true);
    }
  });

  test("preserves multiple road edges and blocks an area-over-capacity brief before generation", () => {
    const multiRoad = createRequirements({ ...DEFAULT_INTAKE_DRAFT, roadEdges: ["east", "south"] });
    expect(multiRoad.site.roadEdges).toEqual(["east", "south"]);
    const constrained = createRequirements({
      ...DEFAULT_INTAKE_DRAFT,
      siteWidth: 8,
      siteDepth: 10,
      setbacks: { north: 2, east: 1, south: 2, west: 1 },
      floorCount: 2,
      includeCourtyard: true,
    });
    const assessment = assessBriefCapacity(constrained);
    expect(assessment.blocking).toBe(true);
    expect(assessment.floors.some((floor) => floor.status === "over_capacity")).toBe(true);
    expect(assessment.actions.length).toBeGreaterThan(0);
  });

  test("normalizes imperial display values into integer millimetres", () => {
    const requirements = createRequirements({ ...DEFAULT_INTAKE_DRAFT, displayUnit: "imperial", siteWidth: 40, siteDepth: 60, setbacks: { north: 5, east: 4, south: 8, west: 4 } });
    expect(requirements.site.widthMm).toBe(12_192);
    expect(requirements.site.depthMm).toBe(18_288);
    expect(requirements.site.setbacksMm.north).toBe(1524);
  });

  test("maps attached-bedroom answers to required direct bathroom connections", () => {
    const programs = DEFAULT_INTAKE_DRAFT.programs.map((program, level) => level === 0
      ? { ...program, bedrooms: 3, bathrooms: 2, attachedBathrooms: 2 }
      : program);
    const requirements = createRequirements({ ...DEFAULT_INTAKE_DRAFT, programs });

    expect(requirements.relationships).toContainEqual({
      type: "must_connect",
      fromRoomId: "bedroom-f0-1",
      toRoomId: "bathroom-f0-1",
    });
    expect(requirements.relationships).toContainEqual({
      type: "must_connect",
      fromRoomId: "bedroom-f0-2",
      toRoomId: "bathroom-f0-2",
    });
    expect(requirements.rooms.find((room) => room.id === "bathroom-f0-1")?.name).toBe("Attached bathroom 1");
    expect(draftFromRequirements(requirements).programs[0].attachedBathrooms).toBe(2);
  });

  test("bounds attached bathrooms and safely upgrades old floor-program drafts", () => {
    const oldSavedProgram = { bedrooms: 2, bathrooms: 1, studies: 0, balcony: false } as Partial<FloorProgram>;
    expect(normalizeFloorProgram(oldSavedProgram, DEFAULT_INTAKE_DRAFT.programs[0]).attachedBathrooms).toBe(0);
    expect(upgradeLegacyFloorProgram(oldSavedProgram, DEFAULT_INTAKE_DRAFT.programs[0])).toMatchObject({
      bedrooms: 2,
      bathrooms: 1,
      attachedBathrooms: 1,
    });
    expect(upgradeLegacyFloorProgram({ ...oldSavedProgram, bedrooms: 0 }, DEFAULT_INTAKE_DRAFT.programs[0]).attachedBathrooms).toBe(0);
    expect(normalizeFloorProgram({ ...oldSavedProgram, attachedBathrooms: 8 }, DEFAULT_INTAKE_DRAFT.programs[0]).attachedBathrooms).toBe(1);
  });

  test("uses attached bedrooms as the primary brief while preserving internal totals", () => {
    const initial = DEFAULT_INTAKE_DRAFT.programs[0];
    expect(floorProgramBrief(initial)).toEqual({
      attachedBedrooms: 1,
      bedroomsWithoutAttachedBathroom: 2,
      sharedBathrooms: 1,
    });

    const moreAttached = updateFloorProgramBrief(initial, { attachedBedrooms: 2 });
    expect(moreAttached).toMatchObject({ bedrooms: 4, bathrooms: 3, attachedBathrooms: 2 });
    expect(floorProgramBrief(moreAttached)).toEqual({
      attachedBedrooms: 2,
      bedroomsWithoutAttachedBathroom: 2,
      sharedBathrooms: 1,
    });

    const bounded = updateFloorProgramBrief(moreAttached, { bedroomsWithoutAttachedBathroom: 99, sharedBathrooms: 99 });
    expect(bounded).toMatchObject({ bedrooms: 8, bathrooms: 8, attachedBathrooms: 2 });
  });

  test("maps separate or combined social spaces without inventing a second room", () => {
    const separate = createRequirements(DEFAULT_INTAKE_DRAFT);
    expect(separate.rooms.find((room) => room.id === "living")?.name).toBe("Living room");
    expect(separate.rooms.some((room) => room.id === "dining")).toBe(true);
    expect(draftFromRequirements(separate).socialSpaceMode).toBe("separate");
    const legacy = { ...DEFAULT_INTAKE_DRAFT } as Partial<typeof DEFAULT_INTAKE_DRAFT>;
    delete legacy.socialSpaceMode;
    expect(createRequirements(legacy as typeof DEFAULT_INTAKE_DRAFT).rooms.some((room) => room.id === "dining")).toBe(true);

    const combined = createRequirements({ ...DEFAULT_INTAKE_DRAFT, socialSpaceMode: "combined" });
    const hall = combined.rooms.find((room) => room.id === "living");
    expect(hall?.name).toBe("Living / dining hall");
    expect(hall?.minAreaMm2).toBe(24_000_000);
    expect(hall?.targetAreaMm2).toBe(35_000_000);
    expect(combined.rooms.some((room) => room.id === "dining")).toBe(false);
    expect(combined.relationships).toContainEqual({ type: "prefer_near", fromRoomId: "living", toRoomId: "kitchen" });
    expect(draftFromRequirements(combined).socialSpaceMode).toBe("combined");
  });
});
