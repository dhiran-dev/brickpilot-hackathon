import {
  HABITABLE_MAX_ASPECT_RATIO,
  MAX_CIRCULATION_RATIO,
  MAX_CONSECUTIVE_PARALLEL_BANDS,
  MAX_GALLERY_ENVELOPE_DEPTH_RATIO,
  PARALLEL_BAND_MIN_ENVELOPE_SPAN_RATIO,
  SERVICE_MAX_ASPECT_RATIO,
  SMALL_PLATE_AREA_THRESHOLD_MM2,
  SMALL_PLATE_MAX_CIRCULATION_RATIO,
} from "@/lib/building/dimensions";
import type { Building, Floor, Rectangle, Space } from "@/lib/building/schema";
import { isVerandahSpace } from "@/lib/building/space-semantics";
import { isOpenToSkySpace, isPerimeterOpenSpace, rectangleIntersectionArea } from "@/lib/building/topology";
import { finding, RULES } from "@/lib/validation/rules";
import type { ValidationFinding } from "@/lib/validation/types";

export type ShapeRuleThresholds = {
  habitableMaxAspectRatio: number;
  serviceMaxAspectRatio: number;
  maxConsecutiveParallelBands: number;
  parallelBandMinEnvelopeSpanRatio: number;
  maxCirculationRatio: number;
  smallPlateAreaThresholdMm2: number;
  smallPlateMaxCirculationRatio: number;
  maxGalleryEnvelopeDepthRatio: number;
  maxFloatingVolumeOverlapMm2: number;
};

/** The production profile exercised by the deterministic T4 threshold sweep. */
export const PRODUCTION_SHAPE_RULE_THRESHOLDS: Readonly<ShapeRuleThresholds> = Object.freeze({
  habitableMaxAspectRatio: HABITABLE_MAX_ASPECT_RATIO,
  serviceMaxAspectRatio: SERVICE_MAX_ASPECT_RATIO,
  maxConsecutiveParallelBands: MAX_CONSECUTIVE_PARALLEL_BANDS,
  parallelBandMinEnvelopeSpanRatio: PARALLEL_BAND_MIN_ENVELOPE_SPAN_RATIO,
  maxCirculationRatio: MAX_CIRCULATION_RATIO,
  smallPlateAreaThresholdMm2: SMALL_PLATE_AREA_THRESHOLD_MM2,
  smallPlateMaxCirculationRatio: SMALL_PLATE_MAX_CIRCULATION_RATIO,
  maxGalleryEnvelopeDepthRatio: MAX_GALLERY_ENVELOPE_DEPTH_RATIO,
  maxFloatingVolumeOverlapMm2: 0,
});

const HABITABLE_TYPES: ReadonlySet<Space["type"]> = new Set([
  "bedroom",
  "living",
  "dining",
  "kitchen",
  "study",
]);

const SERVICE_TYPES: ReadonlySet<Space["type"]> = new Set([
  "bathroom",
  "utility",
  "store",
  "pooja",
  "foyer",
]);

function right(bounds: Rectangle) {
  return bounds.x + bounds.width;
}

function bottom(bounds: Rectangle) {
  return bounds.y + bounds.depth;
}

function boundsArea(bounds: Rectangle) {
  return bounds.width * bounds.depth;
}

function roundedRatio(value: number) {
  return Number(value.toFixed(3));
}

function roomProportionFindings(floor: Floor, thresholds: ShapeRuleThresholds): ValidationFinding[] {
  return floor.spaces.flatMap((space) => {
    const maximum = HABITABLE_TYPES.has(space.type)
      ? thresholds.habitableMaxAspectRatio
      : SERVICE_TYPES.has(space.type)
        ? thresholds.serviceMaxAspectRatio
        : undefined;
    if (!maximum) return [];
    const aspect = Math.max(space.bounds.width, space.bounds.depth) / Math.min(space.bounds.width, space.bounds.depth);
    if (aspect <= maximum) return [];
    return [finding(
      RULES.roomProportion,
      "error",
      "planning",
      `${space.name} is too elongated for its room type.`,
      {
        floorId: floor.id,
        objectIds: [space.id],
        measured: { value: roundedRatio(aspect), unit: "ratio" },
        required: { max: maximum, unit: "ratio" },
        suggestedAction: "Retile this room with a shorter run or a wider clear dimension.",
        repairType: "retile_room_proportion",
      },
    )];
  });
}

type StackAxis = "x" | "y";

function precedes(left: Space, rightSpace: Space, axis: StackAxis) {
  return axis === "x"
    ? right(left.bounds) === rightSpace.bounds.x
    : bottom(left.bounds) === rightSpace.bounds.y;
}

function commonPerpendicularSpan(spaces: Space[], axis: StackAxis) {
  const starts = spaces.map((space) => axis === "x" ? space.bounds.y : space.bounds.x);
  const ends = spaces.map((space) => axis === "x" ? bottom(space.bounds) : right(space.bounds));
  return Math.max(0, Math.min(...ends) - Math.max(...starts));
}

/**
 * Finds the shortest prohibited run: three edge-adjacent constructed cells with a common
 * perpendicular span covering at least 60% of the whole floor envelope. Using the envelope,
 * rather than the occupied footprint, prevents courts and setbacks from tightening the rule.
 */
function parallelBandFindings(floor: Floor, thresholds: ShapeRuleThresholds): ValidationFinding[] {
  const constructed = floor.spaces
    .filter((space) => !isPerimeterOpenSpace(space))
    .sort((left, rightSpace) => left.bounds.x - rightSpace.bounds.x
      || left.bounds.y - rightSpace.bounds.y
      || left.id.localeCompare(rightSpace.id));
  const prohibitedCount = thresholds.maxConsecutiveParallelBands + 1;
  const findings: ValidationFinding[] = [];
  const recorded = new Set<string>();

  for (const axis of ["x", "y"] as const) {
    const requiredSpan = (axis === "x" ? floor.envelope.depth : floor.envelope.width)
      * thresholds.parallelBandMinEnvelopeSpanRatio;
    const visit = (run: Space[]) => {
      const last = run.at(-1);
      if (!last) return;
      for (const successor of constructed.filter((space) => !run.includes(space) && precedes(last, space, axis))) {
        const nextRun = [...run, successor];
        const span = commonPerpendicularSpan(nextRun, axis);
        // Common intersection can only shrink as the run grows, so this branch cannot recover.
        if (span < requiredSpan) continue;
        if (nextRun.length < prohibitedCount) {
          visit(nextRun);
          continue;
        }
        const key = `${axis}:${nextRun.map((space) => space.id).join("|")}`;
        if (recorded.has(key)) continue;
        recorded.add(key);
        findings.push(finding(
          RULES.parallelBands,
          "error",
          "planning",
          `${nextRun.length} consecutive planning cells form a full-span parallel-band layout.`,
          {
            floorId: floor.id,
            objectIds: nextRun.map((space) => space.id),
            measured: { value: nextRun.length, unit: "consecutive_cells" },
            required: { max: thresholds.maxConsecutiveParallelBands, unit: "consecutive_cells" },
            suggestedAction: `Break the strip sequence with a two-dimensional room cluster, hub, or court; its shared span is ${Math.round(span / (axis === "x" ? floor.envelope.depth : floor.envelope.width) * 100)}% of the envelope.`,
            repairType: "break_parallel_bands",
          },
        ));
      }
    };
    for (const start of constructed) {
      visit([start]);
    }
  }
  return findings;
}

function circulationRatioFindings(floor: Floor, thresholds: ShapeRuleThresholds): ValidationFinding[] {
  // Covered parking is constructed floor plate even though its perimeter is open. Verandahs are
  // explicitly excluded because they are exterior circulation, as are true open-to-sky cells.
  const chargeableSpaces = floor.spaces.filter((space) => (
    space.type !== "stair" && !isOpenToSkySpace(space) && !isVerandahSpace(space)
  ));
  const constructedArea = chargeableSpaces.reduce((sum, space) => sum + boundsArea(space.bounds), 0);
  const circulationArea = chargeableSpaces
    .filter((space) => space.type === "circulation")
    .reduce((sum, space) => sum + boundsArea(space.bounds), 0);
  if (constructedArea === 0) return [];
  const maximum = constructedArea < thresholds.smallPlateAreaThresholdMm2
    ? thresholds.smallPlateMaxCirculationRatio
    : thresholds.maxCirculationRatio;
  const ratio = circulationArea / constructedArea;
  const excessArea = circulationArea - maximum * constructedArea;
  if (ratio <= maximum || excessArea <= 100) return [];
  return [finding(
    RULES.circulationRatio,
    "error",
    "planning",
    "Internal circulation consumes too much of this floor plate.",
    {
      floorId: floor.id,
      objectIds: chargeableSpaces.filter((space) => space.type === "circulation").map((space) => space.id),
      measured: { value: roundedRatio(ratio), unit: "ratio" },
      required: { max: maximum, unit: "ratio" },
      suggestedAction: "Replace long corridors with a compact lobby, hub, or shorter gallery.",
      repairType: "reduce_circulation_area",
    },
  )];
}

function galleryLengthFindings(floor: Floor, thresholds: ShapeRuleThresholds): ValidationFinding[] {
  const envelopeDepth = floor.envelope.depth;
  return floor.spaces
    .filter((space) => space.type === "circulation")
    .flatMap((space) => {
      const galleryLength = Math.max(space.bounds.width, space.bounds.depth);
      const ratio = galleryLength / envelopeDepth;
      if (ratio <= thresholds.maxGalleryEnvelopeDepthRatio) return [];
      return [finding(
        RULES.galleryLength,
        "error",
        "planning",
        `${space.name} runs too far across the floor envelope.`,
        {
          floorId: floor.id,
          objectIds: [space.id],
          measured: { value: roundedRatio(ratio), unit: "envelope_ratio" },
          required: { max: thresholds.maxGalleryEnvelopeDepthRatio, unit: "envelope_ratio" },
          suggestedAction: "Shorten the gallery and distribute rooms from a compact hub.",
          repairType: "shorten_gallery",
        },
      )];
    });
}

function floatingVolumeFindings(building: Building, thresholds: ShapeRuleThresholds): ValidationFinding[] {
  const floors = [...building.floors].sort((left, rightFloor) => left.level - rightFloor.level || left.id.localeCompare(rightFloor.id));
  const findings: ValidationFinding[] = [];
  for (let upperIndex = 1; upperIndex < floors.length; upperIndex += 1) {
    const upperFloor = floors[upperIndex];
    const lowerVoids = floors
      .slice(0, upperIndex)
      .flatMap((floor) => floor.spaces.filter(isOpenToSkySpace));
    for (const upperSpace of upperFloor.spaces.filter((space) => !isOpenToSkySpace(space))) {
      for (const lowerVoid of lowerVoids) {
        const overlapArea = rectangleIntersectionArea(upperSpace.bounds, lowerVoid.bounds);
        if (overlapArea <= thresholds.maxFloatingVolumeOverlapMm2) continue;
        findings.push(finding(
          RULES.floatingVolume,
          "error",
          "vertical",
          `${upperSpace.name} projects above an open floor cell without a modeled cantilever strategy.`,
          {
            floorId: upperFloor.id,
            objectIds: [upperSpace.id, lowerVoid.id],
            measured: { value: overlapArea, unit: "mm2" },
            required: { max: thresholds.maxFloatingVolumeOverlapMm2, unit: "mm2" },
            suggestedAction: "Project the lower court or setback through this floor, or keep the upper cell over built volume.",
            repairType: "coordinate_vertical_void",
          },
        ));
      }
    }
  }
  return findings;
}

export function shapeRuleFindings(
  building: Building,
  thresholds: ShapeRuleThresholds = PRODUCTION_SHAPE_RULE_THRESHOLDS,
): ValidationFinding[] {
  return [
    ...building.floors.flatMap((floor) => roomProportionFindings(floor, thresholds)),
    ...building.floors.flatMap((floor) => parallelBandFindings(floor, thresholds)),
    ...building.floors.flatMap((floor) => circulationRatioFindings(floor, thresholds)),
    ...building.floors.flatMap((floor) => galleryLengthFindings(floor, thresholds)),
    ...floatingVolumeFindings(building, thresholds),
  ];
}
