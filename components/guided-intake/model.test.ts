import { describe, expect, test } from "bun:test";

import { buildingRequirementsSchema } from "@/lib/building/requirements";
import { generateBuilding } from "@/lib/building/generate";
import { MAIN_ENTRY_CLEAR_WIDTH_MM } from "@/lib/building/openings";
import { partiStairAnchor } from "@/lib/building/partis";
import { analyzeCoverage } from "@/lib/building/topology";
import { applyRegionalPrefill, applyShadeStructureChoice, assessBriefCapacity, createCurrentRequirements, createRequirements, DEFAULT_INTAKE_DRAFT, draftFromRequirements, floorProgramBrief, normalizeFloorProgram, updateFloorProgramBrief, upgradeLegacyFloorProgram, type FloorProgram, type IntakeDraft } from "@/components/guided-intake/model";

describe("guided intake mapping", () => {
  test("turns the open-pergola selector into one provenance-aware requirement and removes it when cleared", () => {
    const selected = applyShadeStructureChoice(DEFAULT_INTAKE_DRAFT, "parking", "open_pergola");
    expect(selected.shadeStructures).toEqual([{
      id: "parking-open-pergola",
      location: "parking",
      type: "open_pergola",
      source: "user",
    }]);
    expect(createCurrentRequirements(selected).shadeStructures).toEqual(selected.shadeStructures);
    expect(applyShadeStructureChoice(selected, "parking", "none").shadeStructures).toEqual([]);
  });

  test("round-trips explicit v3 entry, pergola and above-parking provenance", () => {
    const requirements = createCurrentRequirements({
      ...DEFAULT_INTAKE_DRAFT,
      currentEntry: {
        primarySide: { value: "south", source: "user" },
        secondaryEntry: { value: "rear", source: "user" },
        primaryDoorClearWidthMm: 1400,
      },
      shadeStructures: [{ id: "parking-open-pergola", type: "open_pergola", location: "parking", source: "user" }],
      aboveParkingUse: { value: "occupied_rooms", source: "user" },
      maxExteriorPedestrianEntryCount: 2,
    });

    expect(requirements).toMatchObject({
      requirementSchemaVersion: 3,
      entry: { primarySide: { value: "south", source: "user" }, primaryDoorClearWidthMm: 1400 },
      shadeStructures: [{ type: "open_pergola", location: "parking", source: "user" }],
      aboveParkingUse: { value: "occupied_rooms", source: "user" },
    });
    expect(draftFromRequirements(requirements)).toMatchObject({
      currentEntry: requirements.entry,
      shadeStructures: requirements.shadeStructures,
      aboveParkingUse: requirements.aboveParkingUse,
    });
  });

  test("emits a schema-valid structured ground-floor brief", () => {
    const requirements = createRequirements(DEFAULT_INTAKE_DRAFT);
    expect(buildingRequirementsSchema.safeParse(requirements).success).toBe(true);
    expect(requirements.buildingType).toBe("detached_house");
    expect(requirements.region.currency).toBe("INR");
    expect(requirements.site.widthMm).toBe(12_000);
    expect(requirements.architecture).toEqual({
      style: "contemporary_tropical",
      formStrategy: "articulated_wings",
      roofCharacter: "mixed",
      materialDirection: "warm_natural",
    });
    expect(requirements.rooms.some((room) => room.type === "living")).toBe(true);
    expect(requirements.rooms.some((room) => room.type === "bedroom")).toBe(true);
  });

  test("generates the default attached-first brief with a valid direct bathroom connection", () => {
    const requirements = createRequirements(DEFAULT_INTAKE_DRAFT);
    const generated = generateBuilding(requirements);
    expect(generated.validation.valid).toBe(true);
    expect(generated.building.floors[0].openings.find((opening) => opening.id === "F0-entrance")?.widthMm).toBe(MAIN_ENTRY_CLEAR_WIDTH_MM);
    expect(requirements.relationships).toContainEqual({
      type: "must_connect",
      fromRoomId: "bedroom-f0-1",
      toRoomId: "bathroom-f0-1",
    });
  });

  test("generates a real perimeter entrance on every single-road orientation", () => {
    for (const facing of ["north", "east", "south", "west"] as const) {
      const generated = generateBuilding(createRequirements({
        ...DEFAULT_INTAKE_DRAFT,
        facing,
        roadEdges: [facing],
      }));
      const floor = generated.building.floors[0];
      const entrance = floor.openings.find((opening) => opening.id === "F0-entrance");
      const wall = floor.walls.find((candidate) => candidate.id === entrance?.wallId);
      expect(generated.validation.valid).toBe(true);
      expect(entrance?.connects).toContain("EXTERIOR");
      expect(entrance?.widthMm).toBe(MAIN_ENTRY_CLEAR_WIDTH_MM);
      expect(wall).toBeDefined();
      if (!wall) continue;
      if (facing === "north") expect(wall.start.y).toBe(floor.envelope.y);
      if (facing === "south") expect(wall.start.y).toBe(floor.envelope.y + floor.envelope.depth);
      if (facing === "west") expect(wall.start.x).toBe(floor.envelope.x);
      if (facing === "east") expect(wall.start.x).toBe(floor.envelope.x + floor.envelope.width);
    }
  });

  test("keeps a valid road-facing entry when a projected courtyard constrains the 1200 mm bay", () => {
    for (const facing of ["north", "east", "south", "west"] as const) {
      const generated = generateBuilding(createRequirements({
        ...DEFAULT_INTAKE_DRAFT,
        facing,
        roadEdges: [facing],
        floorCount: 2,
        includeCourtyard: true,
      }));
      const ground = generated.building.floors[0];
      const entrance = ground.openings.find((opening) => opening.id === "F0-entrance");
      const wall = ground.walls.find((candidate) => candidate.id === entrance?.wallId);
      expect(generated.validation.valid).toBe(true);
      expect(entrance?.widthMm).toBeGreaterThanOrEqual(900);
      if (facing === "north") expect(wall?.start.y).toBe(ground.envelope.y);
      if (facing === "south") expect(wall?.start.y).toBe(ground.envelope.y + ground.envelope.depth);
      if (facing === "west") expect(wall?.start.x).toBe(ground.envelope.x);
      if (facing === "east") expect(wall?.start.x).toBe(ground.envelope.x + ground.envelope.width);
    }
  });

  test("defaults a three-floor villa to practical clusters, an open car court, and a coordinated top-floor setback", () => {
    const requirements = createRequirements({ ...DEFAULT_INTAKE_DRAFT, floorCount: 3 });
    const generated = generateBuilding(requirements);
    const ground = generated.building.floors[0];
    const parking = ground.spaces.find((space) => space.type === "parking")!;
    const upperFloors = generated.building.floors.slice(1);

    expect(generated.validation.valid).toBe(true);
    expect(ground.openings.find((opening) => opening.id === "F0-entrance")?.widthMm).toBe(MAIN_ENTRY_CLEAR_WIDTH_MM);
    expect(requirements.rooms.filter((room) => room.floorId === "F2" && room.type === "bedroom")).toHaveLength(2);
    expect(requirements.rooms.some((room) => room.id === "family-lounge-f1" && room.type === "living")).toBe(true);
    expect(requirements.rooms.some((room) => room.id === "family-lounge-f2" && room.type === "living")).toBe(true);
    expect(generated.validation.findings.some((finding) => finding.ruleId === "PLANNING_ROOM_MIN_DIMENSION")).toBe(false);
    expect(ground.spaces.filter((space) => space.type === "circulation").length).toBeGreaterThan(1);
    expect(ground.walls.some((wall) => wall.type === "exterior" && wall.adjacentSpaceIds.includes(parking.id))).toBe(true);
    expect(ground.walls.some((wall) => wall.adjacentSpaceIds.length === 1 && wall.adjacentSpaceIds.includes(parking.id))).toBe(false);
    for (const floor of upperFloors) {
      const generatedFacadeBays = floor.spaces.filter((space) => (
        space.type === "verandah"
        && (space.id.endsWith("-entry-verandah") || space.id.endsWith("-covered-gallery") || space.id.endsWith("-branch"))
      ));
      expect(generatedFacadeBays.length).toBeGreaterThan(0);
      expect(generatedFacadeBays.every((space) => space.perimeterOpen === false)).toBe(true);
      expect(generatedFacadeBays.some((space) => floor.walls.some((wall) => (
        wall.adjacentSpaceIds.length === 1 && wall.adjacentSpaceIds.includes(space.id)
      )))).toBe(true);
    }
    expect(upperFloors.every((floor) => floor.spaces.some((space) => ["balcony", "terrace"].includes(space.type)))).toBe(true);
    expect(upperFloors.at(-1)?.spaces.some((space) => space.type === "terrace")).toBe(true);
    expect(generated.validation.findings.some((finding) => finding.ruleId === "FLOATING_VOLUME")).toBe(false);
    for (const floor of upperFloors) {
      const envelopeArea = floor.envelope.width * floor.envelope.depth;
      const outdoorArea = floor.spaces
        .filter((space) => ["balcony", "terrace"].includes(space.type))
        .reduce((sum, space) => sum + space.areaMm2, 0);
      if (floor.spaces.some((space) => space.type === "terrace")) {
        expect(outdoorArea / envelopeArea).toBeGreaterThan(0.08);
        expect(outdoorArea / envelopeArea).toBeLessThan(0.25);
      }
      expect(floor.spaces
        .filter((space) => space.name === "Sectioned setback terrace")
        .every((space) => Math.min(space.bounds.width, space.bounds.depth) <= 2_400 && space.areaMm2 <= 13_000_000)).toBe(true);
    }
  });

  test("supports G+3 with one generator-owned stair core per floor", () => {
    const requirements = createRequirements({ ...DEFAULT_INTAKE_DRAFT, projectName: "Four-level home", floorCount: 4, accessibilityRequired: true });
    expect(requirements.floors).toHaveLength(4);
    expect(requirements.rooms.filter((room) => room.type === "stair")).toHaveLength(0);
    expect(requirements.rooms.some((room) => room.floorId === "F3" && room.type === "bedroom")).toBe(true);
    expect(requirements.rooms.some((room) => room.accessible && room.floorId === "F0" && room.type === "bedroom")).toBe(true);
    expect(requirements.relationships.some((relationship) => relationship.type === "stack_with")).toBe(true);
    const generated = generateBuilding(requirements);
    expect(generated.validation.valid).toBe(true);
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

  test("generates the exact wide G+2 courtyard brief accepted by questionnaire preflight", () => {
    const draft: IntakeDraft = {
      ...DEFAULT_INTAKE_DRAFT,
      projectName: "Wide-envelope judge regression",
      siteWidth: 20,
      siteDepth: 18,
      facing: "north",
      roadEdges: ["south", "east"],
      floorCount: 3,
      socialSpaceMode: "combined",
      architecturalStyle: "courtyard_vernacular",
      formStrategy: "articulated_wings",
      roofCharacter: "mixed",
      materialDirection: "monochrome",
      includeCourtyard: true,
      qualityTier: "premium",
      seed: 1_710_739_781,
    };
    const requirements = createRequirements(draft);

    expect(assessBriefCapacity(requirements).blocking).toBe(false);
    const generated = generateBuilding(requirements);
    expect(generated.validation.valid).toBe(true);
    expect(generated.validation.findings.some((finding) => finding.ruleId === "GALLERY_LENGTH")).toBe(false);
    expect(generated.validation.findings.some((finding) => finding.ruleId === "ROOM_PROPORTION")).toBe(false);
    const stair = generated.building.verticalConnectors[0];
    expect(stair).toBeDefined();
    expect(new Set(Object.values(stair.boundsByFloor).map((bounds) => JSON.stringify(bounds))).size).toBe(1);
    const courtBounds = generated.building.floors.map((floor) => floor.spaces.find((space) => space.type === "courtyard")?.bounds);
    expect(new Set(courtBounds.map((bounds) => JSON.stringify(bounds))).size).toBe(1);
    for (const floor of generated.building.floors) {
      expect(floor.spaces.find((space) => space.type === "stair")?.bounds).toEqual(stair.boundsByFloor[floor.id]);
      expect(floor.spaces
        .filter((space) => space.type === "circulation")
        .every((space) => Math.max(space.bounds.width, space.bounds.depth) <= floor.envelope.depth * 0.4)).toBe(true);
      expect(analyzeCoverage(floor.envelope, floor.spaces)).toMatchObject({
        gapAreaMm2: 0,
        overlapAreaMm2: 0,
        outsideAreaMm2: 0,
      });
    }

    for (const seed of [1, 17, 42, 101, 997, 4096, 65_537, 2_871_937_447]) {
      expect(generateBuilding(createRequirements({ ...draft, seed })).validation.valid).toBe(true);
    }
  });

  test("keeps wide-envelope entrances on the requested road edge after quarter-turning the parti", () => {
    for (const facing of ["north", "east", "south", "west"] as const) {
      const generated = generateBuilding(createRequirements({
        ...DEFAULT_INTAKE_DRAFT,
        siteWidth: 20,
        siteDepth: 18,
        floorCount: 3,
        facing,
        roadEdges: [facing],
        includeCourtyard: true,
      }));
      const ground = generated.building.floors[0];
      const entrance = ground.openings.find((opening) => opening.id === "F0-entrance");
      const wall = ground.walls.find((candidate) => candidate.id === entrance?.wallId);
      const partiId = (["t_hub", "l_court", "courtyard", "verandah_bungalow", "compact"] as const)
        .find((id) => id === generated.building.candidate.generatorId);
      expect(partiId).toBeDefined();
      if (!partiId) continue;
      const expectedStairBounds = partiStairAnchor(
        partiId,
        createRequirements({
          ...DEFAULT_INTAKE_DRAFT,
          siteWidth: 20,
          siteDepth: 18,
          floorCount: 3,
          facing,
          roadEdges: [facing],
          includeCourtyard: true,
        }),
        ground.envelope,
      );

      expect(generated.validation.valid).toBe(true);
      expect(entrance?.connects).toContain("EXTERIOR");
      expect(wall).toBeDefined();
      expect(generated.building.floors.every((floor) =>
        JSON.stringify(floor.spaces.find((space) => space.type === "stair")?.bounds) === JSON.stringify(expectedStairBounds)
      )).toBe(true);
      const connector = generated.building.verticalConnectors[0];
      expect(Object.values(connector.boundsByFloor)
        .every((bounds) => JSON.stringify(bounds) === JSON.stringify(expectedStairBounds))).toBe(true);
      expect(["east", "west"].includes(connector.direction)).toBe(expectedStairBounds.width >= expectedStairBounds.depth);
      if (facing === "north") expect(wall?.start.y).toBe(ground.envelope.y);
      if (facing === "south") expect(wall?.start.y).toBe(ground.envelope.y + ground.envelope.depth);
      if (facing === "west") expect(wall?.start.x).toBe(ground.envelope.x);
      if (facing === "east") expect(wall?.start.x).toBe(ground.envelope.x + ground.envelope.width);
    }
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
    const initial = { bedrooms: 3, bathrooms: 2, attachedBathrooms: 1, studies: 1, balcony: false };
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

  test("round-trips architectural taste and makes courtyard form a real programme constraint", () => {
    const requirements = createRequirements({
      ...DEFAULT_INTAKE_DRAFT,
      architecturalStyle: "kerala_contemporary",
      formStrategy: "courtyard",
      roofCharacter: "sloped",
      materialDirection: "earthy_textured",
      includeCourtyard: false,
    });
    expect(requirements.rooms.some((room) => room.type === "courtyard")).toBe(true);
    expect(requirements.architecture).toEqual({
      style: "kerala_contemporary",
      formStrategy: "courtyard",
      roofCharacter: "sloped",
      materialDirection: "earthy_textured",
    });
    expect(draftFromRequirements(requirements)).toMatchObject({
      architecturalStyle: "kerala_contemporary",
      formStrategy: "courtyard",
      roofCharacter: "sloped",
      materialDirection: "earthy_textured",
      includeCourtyard: true,
    });
  });

  test("does not infer a balcony from an articulated form when every floor toggle is off", () => {
    const programs = DEFAULT_INTAKE_DRAFT.programs.map((program) => ({ ...program, balcony: false }));
    const draft = { ...DEFAULT_INTAKE_DRAFT, floorCount: 3, formStrategy: "articulated_wings" as const, programs };
    const legacy = createRequirements(draft);
    const current = createCurrentRequirements(draft);
    expect(legacy.rooms.some((room) => room.type === "balcony")).toBe(false);
    expect(current.rooms.some((room) => room.type === "balcony")).toBe(false);
    expect(current.outdoorAreas).toEqual([]);
  });

  test("prefills regional suggestions while round-tripping every editable architecture field", () => {
    const prefilled = applyRegionalPrefill({ ...DEFAULT_INTAKE_DRAFT, countryCode: "IN", adminArea: "Delhi" });
    const requirements = createRequirements(prefilled);

    expect(prefilled).toMatchObject({
      architecturalStyle: "courtyard_vernacular",
      formStrategy: "courtyard",
      roofCharacter: "flat_parapet",
      materialDirection: "earthy_textured",
      includeCourtyard: true,
    });
    expect(draftFromRequirements(requirements)).toMatchObject({
      architecturalStyle: prefilled.architecturalStyle,
      formStrategy: prefilled.formStrategy,
      roofCharacter: prefilled.roofCharacter,
      materialDirection: prefilled.materialDirection,
      includeCourtyard: true,
    });

    const edited = createRequirements({ ...prefilled, architecturalStyle: "modernist", roofCharacter: "mixed" });
    expect(draftFromRequirements(edited)).toMatchObject({ architecturalStyle: "modernist", roofCharacter: "mixed" });
  });

  test("upgrades legacy requirements with stable architectural defaults", () => {
    const current = createRequirements(DEFAULT_INTAKE_DRAFT);
    const legacy = structuredClone(current) as Record<string, unknown>;
    delete legacy.architecture;
    const parsed = buildingRequirementsSchema.parse(legacy);
    expect(parsed.architecture.formStrategy).toBe("stepped_terraces");
  });
});
