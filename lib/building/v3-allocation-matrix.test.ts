import { describe, expect, test } from "bun:test";

import {
  createCurrentRequirements,
  DEFAULT_INTAKE_DRAFT,
  type FloorProgram,
  type IntakeDraft,
} from "@/components/guided-intake/model";
import { floorAreaPolicies } from "@/lib/building/area-policy-v3";
import {
  DENSE_COURTYARD_CURRENT_DRAFT,
  DENSE_COURTYARD_CURRENT_EXPECTED_FACTS,
  DENSE_COURTYARD_CURRENT_REQUIREMENTS,
} from "@/lib/building/fixtures/dense-courtyard-current";
import {
  generateV3AllocationStage,
  V3AllocationGenerationError,
  withRequiredV3VerticalCirculation,
} from "@/lib/building/generate-v3-allocation";
import { generateV3PhysicalStage } from "@/lib/building/generate-v3-physical";
import {
  currentBuildingRequirementsSchema,
  type CardinalDirection,
  type CurrentBuildingRequirements,
  type FormStrategy,
} from "@/lib/building/requirements";
import { roomAreaDefaultsMm2 } from "@/lib/building/room-defaults";
import { validateV3SchemeStage } from "@/lib/validation/validate-v3";

type MatrixForm = "compact" | "articulated" | "t_hub" | "courtyard";
type MatrixOutdoor = "none" | "verandah" | "balcony" | "terrace";
type MatrixAboveParking = "occupied_rooms" | "balcony" | "terrace" | "unbuilt";
type MatrixDensity = "sparse" | "target_dense" | "minimum_borderline" | "impossible";
type ExpectedClassification = "feasible" | "impossible";

export type V3AllocationMatrixCase = {
  id: string;
  entrySide: CardinalDirection;
  roadEdges: CardinalDirection[];
  floorCount: 1 | 2 | 3 | 4;
  form: MatrixForm;
  parking: boolean;
  outdoor: MatrixOutdoor;
  courtyard: boolean;
  aboveParking: MatrixAboveParking;
  density: MatrixDensity;
  secondaryEntry: "none" | "rear" | "service_side";
  expected: ExpectedClassification;
};

const FORM_STRATEGY: Readonly<Record<MatrixForm, FormStrategy>> = {
  compact: "compact",
  articulated: "articulated_wings",
  // The current questionnaire has no literal t_hub value. stepped_terraces is its
  // stable public-contract mapping; the solver may realize a t_hub planning structure.
  t_hub: "stepped_terraces",
  courtyard: "courtyard",
};

const CASE_TUPLES: ReadonlyArray<readonly [
  CardinalDirection,
  CardinalDirection[],
  1 | 2 | 3 | 4,
  MatrixForm,
  boolean,
  MatrixOutdoor,
  boolean,
  MatrixAboveParking,
  MatrixDensity,
]> = [
  ["north", ["north"], 1, "compact", false, "none", false, "unbuilt", "sparse"],
  ["east", ["east"], 2, "articulated", true, "balcony", false, "occupied_rooms", "target_dense"],
  ["south", ["south"], 3, "t_hub", true, "verandah", false, "balcony", "minimum_borderline"],
  ["west", ["west"], 4, "courtyard", true, "terrace", true, "terrace", "target_dense"],
  ["north", ["north", "east"], 2, "courtyard", true, "verandah", true, "occupied_rooms", "minimum_borderline"],
  ["east", ["east", "south"], 3, "compact", false, "balcony", false, "unbuilt", "sparse"],
  ["south", ["south", "west"], 4, "articulated", true, "terrace", false, "terrace", "target_dense"],
  ["west", ["west", "north"], 1, "t_hub", true, "verandah", false, "unbuilt", "minimum_borderline"],
  ["north", ["north"], 3, "articulated", true, "balcony", true, "balcony", "target_dense"],
  ["east", ["east"], 4, "t_hub", false, "none", false, "unbuilt", "minimum_borderline"],
  ["south", ["south"], 1, "courtyard", true, "verandah", true, "unbuilt", "sparse"],
  ["west", ["west"], 2, "compact", true, "terrace", false, "terrace", "target_dense"],
  ["north", ["north", "west"], 4, "t_hub", true, "balcony", false, "occupied_rooms", "sparse"],
  ["east", ["east", "north"], 2, "compact", true, "none", false, "occupied_rooms", "target_dense"],
  ["south", ["south", "east"], 2, "courtyard", false, "balcony", true, "unbuilt", "minimum_borderline"],
  ["west", ["west", "south"], 3, "articulated", true, "verandah", false, "balcony", "sparse"],
  ["north", ["north"], 4, "courtyard", true, "terrace", true, "terrace", "minimum_borderline"],
  ["east", ["east"], 3, "t_hub", true, "none", false, "occupied_rooms", "target_dense"],
  ["south", ["south"], 2, "compact", true, "balcony", false, "balcony", "sparse"],
  ["west", ["west"], 4, "articulated", false, "balcony", true, "unbuilt", "target_dense"],
  ["north", ["north", "east"], 1, "articulated", true, "verandah", false, "unbuilt", "impossible"],
  ["east", ["east", "south"], 2, "t_hub", true, "terrace", true, "terrace", "impossible"],
  ["south", ["south", "west"], 3, "courtyard", true, "verandah", true, "occupied_rooms", "impossible"],
  ["west", ["west", "north"], 4, "compact", false, "none", false, "unbuilt", "impossible"],
  ["north", ["north"], 2, "compact", true, "balcony", false, "balcony", "impossible"],
  ["east", ["east"], 1, "courtyard", true, "verandah", true, "unbuilt", "impossible"],
  ["south", ["south"], 4, "t_hub", true, "terrace", false, "terrace", "impossible"],
  ["west", ["west"], 3, "articulated", true, "balcony", true, "occupied_rooms", "impossible"],
  ["north", ["north"], 2, "compact", false, "none", false, "unbuilt", "minimum_borderline"],
  ["east", ["east"], 2, "articulated", false, "none", false, "unbuilt", "sparse"],
  ["south", ["south"], 2, "t_hub", false, "none", false, "unbuilt", "sparse"],
  ["west", ["west"], 1, "compact", false, "none", false, "unbuilt", "target_dense"],
];

export const V3_ALLOCATION_PAIRWISE_CASES: V3AllocationMatrixCase[] = CASE_TUPLES.map(
  ([
    entrySide,
    roadEdges,
    floorCount,
    form,
    parking,
    outdoor,
    courtyard,
    aboveParking,
    density,
  ], index) => ({
    id: `pairwise-${String(index + 1).padStart(2, "0")}-${entrySide}-${form}-${density.replaceAll("_", "-")}`,
    entrySide,
    roadEdges: [...roadEdges],
    floorCount,
    form,
    parking,
    outdoor,
    courtyard,
    aboveParking,
    density,
    secondaryEntry: index === 1
      ? "rear"
      : index === 15
        ? "service_side"
        : "none",
    expected: density === "impossible" ? "impossible" : "feasible",
  }),
);

function floorProgram(
  level: number,
  floorCount: number,
  density: MatrixDensity,
  outdoor: MatrixOutdoor,
): FloorProgram {
  if (level >= floorCount) return { bedrooms: 0, bathrooms: 0, attachedBathrooms: 0, studies: 0, balcony: false };
  const balcony = outdoor === "balcony" && level > 0;
  if (density === "sparse") {
    return {
      bedrooms: 1,
      bathrooms: 1,
      attachedBathrooms: 1,
      studies: 0,
      balcony,
    };
  }
  if (density === "minimum_borderline") {
    return {
      bedrooms: level === 0 ? 1 : 2,
      bathrooms: level === 0 ? 2 : 2,
      attachedBathrooms: level === 0 ? 1 : 2,
      studies: level === 0 ? 1 : 0,
      balcony,
    };
  }
  return {
    bedrooms: level === 0 ? 2 : 3,
    bathrooms: level === 0 ? 2 : 3,
    attachedBathrooms: level === 0 ? 1 : 2,
    studies: level % 2,
    balcony,
  };
}

function draftForMatrixCase(matrixCase: V3AllocationMatrixCase): IntakeDraft {
  const impossible = matrixCase.density === "impossible";
  const minimumBorderline = matrixCase.density === "minimum_borderline";
  const siteWidth = impossible ? 8 : minimumBorderline ? 12 : matrixCase.density === "target_dense" ? 16 : 18;
  const siteDepth = impossible ? 10 : minimumBorderline ? 16 : matrixCase.density === "target_dense" ? 20 : 22;
  const setbacks = impossible
    ? { north: 1, east: 1, south: 1, west: 1 }
    : minimumBorderline
      ? { north: 1.2, east: 1.2, south: 1.2, west: 1.2 }
      : { north: 1.5, east: 1.2, south: 1.5, west: 1.2 };
  const parking = matrixCase.parking;
  const terrace = matrixCase.outdoor === "terrace";
  return {
    ...DEFAULT_INTAKE_DRAFT,
    projectName: `Allocation matrix ${matrixCase.id}`,
    siteWidth,
    siteDepth,
    facing: matrixCase.entrySide,
    roadEdges: [...matrixCase.roadEdges],
    setbacks,
    floorCount: matrixCase.floorCount,
    formStrategy: FORM_STRATEGY[matrixCase.form],
    includeUtility: !impossible,
    includePooja: !impossible,
    includeParking: parking,
    includeVerandah: matrixCase.outdoor === "verandah",
    includeCourtyard: matrixCase.courtyard,
    programs: DEFAULT_INTAKE_DRAFT.programs.map((_, level) => {
      const program = floorProgram(level, matrixCase.floorCount, matrixCase.density, matrixCase.outdoor);
      return matrixCase.parking && matrixCase.aboveParking === "balcony" && level === 1
        ? { ...program, balcony: true }
        : program;
    }),
    currentEntry: {
      primarySide: { value: matrixCase.entrySide, source: "user" },
      secondaryEntry: { value: matrixCase.secondaryEntry, source: "user" },
      primaryDoorClearWidthMm: 1200,
    },
    shadeStructures: terrace
      ? [{ id: "terrace-open-pergola", type: "open_pergola", location: "terrace", source: "user" }]
      : [],
    aboveParkingUse: parking
      ? { value: terrace ? "terrace" : matrixCase.aboveParking, source: "user" }
      : { value: "auto", source: "default" },
    seed: 10_000 + Number(matrixCase.id.slice(9, 11)),
  };
}

export function requirementsForMatrixCase(
  matrixCase: V3AllocationMatrixCase,
): CurrentBuildingRequirements {
  const requirements = createCurrentRequirements(draftForMatrixCase(matrixCase));
  if (!matrixCase.parking || matrixCase.aboveParking !== "terrace") {
    return currentBuildingRequirementsSchema.parse(requirements);
  }
  return currentBuildingRequirementsSchema.parse({
    ...requirements,
    rooms: [...requirements.rooms, {
      id: "above-parking-terrace-f1",
      name: "Above-parking terrace",
      type: "terrace",
      floorId: "F1",
      ...roomAreaDefaultsMm2("terrace"),
      privacy: "semi_private",
      preferredZone: matrixCase.entrySide,
      mustBeExterior: true,
      accessible: false,
    }],
  });
}

function buildableAreaMm2(requirements: CurrentBuildingRequirements) {
  return (
    requirements.site.widthMm
    - requirements.site.setbacksMm.east
    - requirements.site.setbacksMm.west
  ) * (
    requirements.site.depthMm
    - requirements.site.setbacksMm.north
    - requirements.site.setbacksMm.south
  );
}

function floorMinimumAudit(requirements: CurrentBuildingRequirements) {
  const withStairs = withRequiredV3VerticalCirculation(requirements);
  const envelopeAreaMm2 = buildableAreaMm2(withStairs);
  return withStairs.floors.map((floor) => {
    const minimumAreaMm2 = floorAreaPolicies(withStairs, floor.id, envelopeAreaMm2)
      .reduce((sum, policy) => sum + policy.minimumAreaMm2, 0);
    return {
      floorId: floor.id,
      minimumAreaMm2,
      envelopeAreaMm2,
      fitsHardMinimumArea: minimumAreaMm2 <= envelopeAreaMm2,
    };
  });
}

describe("dense courtyard current questionnaire fixture", () => {
  test("parses independently of allocation and records the reproduced requirements", () => {
    const parsed = currentBuildingRequirementsSchema.parse(
      JSON.parse(JSON.stringify(DENSE_COURTYARD_CURRENT_REQUIREMENTS)),
    );
    const groundRooms = parsed.rooms.filter((room) => room.floorId === "F0");
    const buildableWidthMm = parsed.site.widthMm
      - parsed.site.setbacksMm.east
      - parsed.site.setbacksMm.west;
    const buildableDepthMm = parsed.site.depthMm
      - parsed.site.setbacksMm.north
      - parsed.site.setbacksMm.south;

    expect(parsed.projectName).toBe("Dense courtyard regression");
    expect(buildableWidthMm).toBe(DENSE_COURTYARD_CURRENT_EXPECTED_FACTS.buildableWidthMm);
    expect(buildableDepthMm).toBe(DENSE_COURTYARD_CURRENT_EXPECTED_FACTS.buildableDepthMm);
    expect(parsed.floors).toHaveLength(DENSE_COURTYARD_CURRENT_EXPECTED_FACTS.floorCount);
    expect(parsed.site.roadEdges).toEqual([...DENSE_COURTYARD_CURRENT_EXPECTED_FACTS.roadEdges]);
    expect(parsed.entry.primarySide.value).toBe(DENSE_COURTYARD_CURRENT_EXPECTED_FACTS.resolvedPrimaryEntrySide);
    expect(parsed.parking.preferredSide.value).toBe(DENSE_COURTYARD_CURRENT_EXPECTED_FACTS.resolvedParkingSide);
    expect(parsed.roof.value).toBe(DENSE_COURTYARD_CURRENT_EXPECTED_FACTS.roof);
    expect(parsed.seed).toBe(DENSE_COURTYARD_CURRENT_EXPECTED_FACTS.seed);
    expect(parsed.parking.vehicleCount).toBe(DENSE_COURTYARD_CURRENT_EXPECTED_FACTS.parkingVehicleCount);
    expect(parsed.courtyard.value).toBe(DENSE_COURTYARD_CURRENT_EXPECTED_FACTS.courtyard);
    expect(parsed.aboveParkingUse.value).toBe(DENSE_COURTYARD_CURRENT_EXPECTED_FACTS.aboveParkingUse);
    expect(groundRooms).toHaveLength(DENSE_COURTYARD_CURRENT_EXPECTED_FACTS.groundProgramRoomCountBeforeInferredStair);
    expect(groundRooms.map((room) => room.id).sort()).toEqual(
      [...DENSE_COURTYARD_CURRENT_EXPECTED_FACTS.groundRoomIdsBeforeInferredStair].sort(),
    );
    expect(Object.fromEntries(groundRooms.map((room) => [
      room.id,
      {
        minimum: room.minAreaMm2 / 1_000_000,
        target: room.targetAreaMm2 / 1_000_000,
      },
    ]))).toEqual(DENSE_COURTYARD_CURRENT_EXPECTED_FACTS.groundAreaM2ByRoomId);
    expect(parsed.relationships).toEqual(expect.arrayContaining([
      { type: "must_connect", fromRoomId: "foyer", toRoomId: "living" },
      { type: "must_connect", fromRoomId: "living", toRoomId: "dining" },
      { type: "must_connect", fromRoomId: "bedroom-f0-1", toRoomId: "bathroom-f0-1" },
      { type: "stack_with", fromRoomId: "bathroom-f1-1", toRoomId: "bathroom-f0-1" },
      { type: "stack_with", fromRoomId: "bathroom-f2-1", toRoomId: "bathroom-f1-1" },
    ]));
    expect(parsed.shadeStructures.map((shade) => shade.location).sort()).toEqual(
      [...DENSE_COURTYARD_CURRENT_EXPECTED_FACTS.requestedShadeLocations].sort(),
    );
    expect(parsed).toEqual(createCurrentRequirements(DENSE_COURTYARD_CURRENT_DRAFT));
  });

  test("is physically plausible by aggregate hard minimum area before geometric search", () => {
    const audit = floorMinimumAudit(DENSE_COURTYARD_CURRENT_REQUIREMENTS);
    expect(audit.every((floor) => floor.fitsHardMinimumArea)).toBe(true);
    expect(audit.find((floor) => floor.floorId === "F0")).toMatchObject({
      minimumAreaMm2: 102_400_000,
      envelopeAreaMm2: 134_400_000,
      fitsHardMinimumArea: true,
    });
  });
});

describe("v3 universal allocation coverage matrix contract", () => {
  test("contains deterministic broad coverage with classifications derived from hard minimums", () => {
    expect(V3_ALLOCATION_PAIRWISE_CASES.length).toBeGreaterThanOrEqual(24);
    expect(new Set(V3_ALLOCATION_PAIRWISE_CASES.map((matrixCase) => matrixCase.id)).size)
      .toBe(V3_ALLOCATION_PAIRWISE_CASES.length);

    expect(new Set(V3_ALLOCATION_PAIRWISE_CASES.map((matrixCase) => matrixCase.entrySide)))
      .toEqual(new Set(["north", "east", "south", "west"]));
    expect(new Set(V3_ALLOCATION_PAIRWISE_CASES.map((matrixCase) => matrixCase.roadEdges.length)))
      .toEqual(new Set([1, 2]));
    expect(new Set(V3_ALLOCATION_PAIRWISE_CASES.map((matrixCase) => matrixCase.floorCount)))
      .toEqual(new Set([1, 2, 3, 4]));
    expect(new Set(V3_ALLOCATION_PAIRWISE_CASES.map((matrixCase) => matrixCase.form)))
      .toEqual(new Set(["compact", "articulated", "t_hub", "courtyard"]));
    expect(new Set(V3_ALLOCATION_PAIRWISE_CASES.map((matrixCase) => matrixCase.outdoor)))
      .toEqual(new Set(["none", "verandah", "balcony", "terrace"]));
    expect(new Set(V3_ALLOCATION_PAIRWISE_CASES.map((matrixCase) => matrixCase.aboveParking)))
      .toEqual(new Set(["occupied_rooms", "balcony", "terrace", "unbuilt"]));
    expect(new Set(V3_ALLOCATION_PAIRWISE_CASES.map((matrixCase) => matrixCase.density)))
      .toEqual(new Set(["sparse", "target_dense", "minimum_borderline", "impossible"]));
    expect(new Set(V3_ALLOCATION_PAIRWISE_CASES.map((matrixCase) => matrixCase.secondaryEntry)))
      .toEqual(new Set(["none", "rear", "service_side"]));
    expect(V3_ALLOCATION_PAIRWISE_CASES.some((matrixCase) =>
      matrixCase.form === "compact" && matrixCase.density === "minimum_borderline")).toBe(true);
    expect(V3_ALLOCATION_PAIRWISE_CASES.some((matrixCase) =>
      matrixCase.form === "articulated" && matrixCase.outdoor === "none")).toBe(true);
    expect(V3_ALLOCATION_PAIRWISE_CASES.some((matrixCase) =>
      matrixCase.entrySide === "south" && matrixCase.outdoor === "none")).toBe(true);
    expect(V3_ALLOCATION_PAIRWISE_CASES.some((matrixCase) =>
      matrixCase.floorCount === 1 && matrixCase.density === "target_dense")).toBe(true);

    for (const matrixCase of V3_ALLOCATION_PAIRWISE_CASES) {
      const requirements = requirementsForMatrixCase(matrixCase);
      expect(currentBuildingRequirementsSchema.safeParse(requirements).success).toBe(true);
      if (matrixCase.parking && matrixCase.aboveParking === "balcony") {
        expect(requirements.rooms.some((room) => room.floorId === "F1" && room.type === "balcony")).toBe(true);
      }
      if (matrixCase.parking && matrixCase.aboveParking === "terrace") {
        expect(requirements.rooms.some((room) => room.floorId === "F1" && room.type === "terrace")).toBe(true);
      }
      const audit = floorMinimumAudit(requirements);
      const aggregateAreaPossible = audit.every((floor) => floor.fitsHardMinimumArea);
      expect(aggregateAreaPossible, `${matrixCase.id}: ${JSON.stringify(audit)}`)
        .toBe(matrixCase.expected === "feasible");
    }
  });
});

describe("v3 universal allocation coverage generation acceptance", () => {
  test("the named dense-courtyard regression generates without deleting requirements", () => {
    const result = generateV3AllocationStage(DENSE_COURTYARD_CURRENT_REQUIREMENTS);
    expect(result.schemes.length).toBeGreaterThan(0);
    const requestedIds = new Set(DENSE_COURTYARD_CURRENT_REQUIREMENTS.rooms.map((room) => room.id));
    for (const scheme of result.schemes) {
      const realizedIds = new Set(scheme.floors.flatMap((floor) => floor.spaces.map((space) => space.id)));
      for (const requirementId of requestedIds) {
        expect(realizedIds.has(requirementId), `${scheme.schemeId} dropped ${requirementId}`).toBe(true);
      }
    }
  });

  for (const matrixCase of V3_ALLOCATION_PAIRWISE_CASES) {
    test(`${matrixCase.id} is ${matrixCase.expected}`, () => {
      const requirements = requirementsForMatrixCase(matrixCase);
      if (matrixCase.expected === "feasible") {
        const result = generateV3AllocationStage(requirements);
        expect(result.schemes.length).toBeGreaterThan(0);
        expect(result.diagnostics.allocatedSchemeCount).toBe(result.schemes.length);
        const requestedIds = new Set(
          withRequiredV3VerticalCirculation(requirements).rooms.map((room) => room.id),
        );
        for (const scheme of result.schemes) {
          const realizedIds = new Set(scheme.floors.flatMap((floor) =>
            floor.spaces.map((space) => space.id)));
          for (const requirementId of requestedIds) {
            expect(realizedIds.has(requirementId), `${matrixCase.id} dropped ${requirementId}`)
              .toBe(true);
          }
        }
        const physical = generateV3PhysicalStage(requirements);
        expect(physical.schemes.length).toBeGreaterThan(0);
        const validated = validateV3SchemeStage(physical.schemes, requirements);
        expect(validated.schemes.length).toBeGreaterThan(0);
        return;
      }

      try {
        generateV3AllocationStage(requirements);
        throw new Error(`Expected ${matrixCase.id} to be rejected`);
      } catch (error) {
        expect(error).toBeInstanceOf(V3AllocationGenerationError);
        expect(error).toMatchObject({ code: "PROGRAM_AREA_INFEASIBLE" });
      }
    }, 20_000);
  }
});
