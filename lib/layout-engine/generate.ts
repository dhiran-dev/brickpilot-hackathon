import { z } from "zod";

import {
  layoutDataSchema,
  requirementDataSchema,
  type LayoutData,
  type PreferredZone,
  type RequirementData,
  type RoomRequirement,
  type RoomType,
} from "@/lib/layout-engine/schemas";

const EPSILON = 1e-8;

type Bounds = { xFt: number; yFt: number; widthFt: number; depthFt: number };
type WeightedRoom = RoomRequirement & { allocationSqFt: number; orderJitter: number };

export type LayoutGenerationErrorCode = "INVALID_REQUIREMENTS" | "INFEASIBLE_REQUIREMENTS" | "INVALID_LAYOUT";

export class LayoutGenerationError extends Error {
  constructor(
    readonly code: LayoutGenerationErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LayoutGenerationError";
  }
}

function normaliseSeed(seed: number) {
  if (!Number.isFinite(seed) || !Number.isInteger(seed)) {
    throw new LayoutGenerationError("INVALID_REQUIREMENTS", "The layout seed must be a finite integer.");
  }
  return seed >>> 0;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const zonePoints: Record<PreferredZone, readonly [number, number]> = {
  northwest: [0.08, 0.08],
  north: [0.5, 0.08],
  northeast: [0.92, 0.08],
  west: [0.08, 0.5],
  center: [0.5, 0.5],
  any: [0.5, 0.5],
  east: [0.92, 0.5],
  southwest: [0.08, 0.92],
  south: [0.5, 0.92],
  southeast: [0.92, 0.92],
};

const wetRoomTypes = new Set<RoomType>(["bathroom", "kitchen", "utility"]);

function desiredCoordinate(room: WeightedRoom, axis: "x" | "y") {
  const coordinate = zonePoints[room.preferredZone][axis === "x" ? 0 : 1];
  const wetBias = wetRoomTypes.has(room.type) ? 0.08 : 0;
  return coordinate + wetBias + room.orderJitter;
}

function sumAllocation(rooms: WeightedRoom[]) {
  return rooms.reduce((total, room) => total + room.allocationSqFt, 0);
}

function chooseSplitIndex(rooms: WeightedRoom[], random: () => number) {
  const totalArea = sumAllocation(rooms);
  let runningArea = 0;
  let bestIndex = 1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let index = 1; index < rooms.length; index += 1) {
    runningArea += rooms[index - 1].allocationSqFt;
    const areaRatio = runningArea / totalArea;
    const countRatio = index / rooms.length;
    const score = Math.abs(areaRatio - 0.5) + Math.abs(areaRatio - countRatio) * 0.22 + random() * 0.09;
    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function rectangleAspect(bounds: Bounds) {
  return Math.max(bounds.widthFt / bounds.depthFt, bounds.depthFt / bounds.widthFt);
}

function splitPair(
  rooms: WeightedRoom[],
  bounds: Bounds,
  random: () => number,
): { first: WeightedRoom[]; second: WeightedRoom[]; splitVertically: boolean; firstRatio: number } {
  const total = sumAllocation(rooms);
  const candidates = (["x", "y"] as const).map((axis) => {
    const ordered = [...rooms].sort((left, right) => {
      const delta = desiredCoordinate(left, axis) - desiredCoordinate(right, axis);
      return Math.abs(delta) > EPSILON ? delta : left.id.localeCompare(right.id);
    });
    const firstRatio = ordered[0].allocationSqFt / total;
    const firstBounds =
      axis === "x"
        ? { ...bounds, widthFt: bounds.widthFt * firstRatio }
        : { ...bounds, depthFt: bounds.depthFt * firstRatio };
    const secondBounds =
      axis === "x"
        ? { ...bounds, xFt: bounds.xFt + firstBounds.widthFt, widthFt: bounds.widthFt - firstBounds.widthFt }
        : { ...bounds, yFt: bounds.yFt + firstBounds.depthFt, depthFt: bounds.depthFt - firstBounds.depthFt };
    return {
      first: [ordered[0]],
      second: [ordered[1]],
      splitVertically: axis === "x",
      firstRatio,
      score: Math.max(rectangleAspect(firstBounds), rectangleAspect(secondBounds)) + random() * 0.08,
    };
  });

  const selected = candidates.sort((left, right) => left.score - right.score)[0];
  return selected;
}

function partition(
  rooms: WeightedRoom[],
  bounds: Bounds,
  random: () => number,
  cells: Map<string, Bounds>,
  depth = 0,
) {
  if (rooms.length === 1) {
    cells.set(rooms[0].id, bounds);
    return;
  }

  let splitVertically: boolean;
  let first: WeightedRoom[];
  let second: WeightedRoom[];
  let firstRatio: number;

  if (rooms.length === 2) {
    ({ splitVertically, first, second, firstRatio } = splitPair(rooms, bounds, random));
  } else {
    const aspect = bounds.widthFt / bounds.depthFt;
    const nearSquare = aspect > 0.78 && aspect < 1.28;
    splitVertically = nearSquare ? (random() + depth * 0.173) % 1 >= 0.5 : bounds.widthFt >= bounds.depthFt;
    const axis = splitVertically ? "x" : "y";
    const ordered = [...rooms].sort((left, right) => {
      const delta = desiredCoordinate(left, axis) - desiredCoordinate(right, axis);
      return Math.abs(delta) > EPSILON ? delta : left.id.localeCompare(right.id);
    });
    const splitIndex = chooseSplitIndex(ordered, random);
    first = ordered.slice(0, splitIndex);
    second = ordered.slice(splitIndex);
    firstRatio = sumAllocation(first) / sumAllocation(ordered);
  }

  if (splitVertically) {
    const firstWidth = bounds.widthFt * firstRatio;
    partition(first, { ...bounds, widthFt: firstWidth }, random, cells, depth + 1);
    partition(
      second,
      { xFt: bounds.xFt + firstWidth, yFt: bounds.yFt, widthFt: bounds.widthFt - firstWidth, depthFt: bounds.depthFt },
      random,
      cells,
      depth + 1,
    );
    return;
  }

  const firstDepth = bounds.depthFt * firstRatio;
  partition(first, { ...bounds, depthFt: firstDepth }, random, cells, depth + 1);
  partition(
    second,
    { xFt: bounds.xFt, yFt: bounds.yFt + firstDepth, widthFt: bounds.widthFt, depthFt: bounds.depthFt - firstDepth },
    random,
    cells,
    depth + 1,
  );
}

function prepareRooms(requirements: RequirementData, buildableArea: number, random: () => number): WeightedRoom[] {
  const minimumArea = requirements.rooms.reduce((total, room) => total + room.minAreaSqFt, 0);
  if (minimumArea > buildableArea + EPSILON) {
    throw new LayoutGenerationError(
      "INFEASIBLE_REQUIREMENTS",
      `Room minimums require ${minimumArea.toFixed(1)} sq ft, but only ${buildableArea.toFixed(1)} sq ft is buildable.`,
    );
  }

  const distributableArea = Math.max(0, buildableArea - minimumArea);
  const desiredWeights = requirements.rooms.map((room) => room.targetAreaSqFt ?? room.minAreaSqFt);
  const desiredTotal = desiredWeights.reduce((total, area) => total + area, 0);

  return requirements.rooms.map((room, index) => ({
    ...room,
    allocationSqFt: room.minAreaSqFt + distributableArea * (desiredWeights[index] / desiredTotal),
    orderJitter: (random() - 0.5) * 0.38,
  }));
}

export function generateLayout(input: RequirementData | unknown, seed = 1): LayoutData {
  const parsed = requirementDataSchema.safeParse(input);
  if (!parsed.success) {
    throw new LayoutGenerationError("INVALID_REQUIREMENTS", z.prettifyError(parsed.error), parsed.error);
  }

  const requirements = parsed.data;
  const resolvedSeed = normaliseSeed(seed);
  const random = mulberry32(resolvedSeed);
  const buildableBounds: Bounds = {
    xFt: requirements.setbacks.westFt,
    yFt: requirements.setbacks.northFt,
    widthFt: requirements.plot.widthFt - requirements.setbacks.westFt - requirements.setbacks.eastFt,
    depthFt: requirements.plot.depthFt - requirements.setbacks.northFt - requirements.setbacks.southFt,
  };
  const buildableArea = buildableBounds.widthFt * buildableBounds.depthFt;
  const rooms = prepareRooms(requirements, buildableArea, random);
  const cells = new Map<string, Bounds>();
  partition(rooms, buildableBounds, random, cells);

  const layoutRooms = rooms.map((room) => {
    const cell = cells.get(room.id);
    if (!cell) throw new LayoutGenerationError("INVALID_LAYOUT", `No partition was produced for ${room.id}.`);
    return {
      id: room.id,
      name: room.name,
      type: room.type,
      floor: "G" as const,
      preferredZone: room.preferredZone,
      minAreaSqFt: room.minAreaSqFt,
      ...cell,
      areaSqFt: cell.widthFt * cell.depthFt,
    };
  });
  const coveredArea = layoutRooms.reduce((total, room) => total + room.areaSqFt, 0);

  const layout = {
    schemaVersion: 1 as const,
    algorithmVersion: "recursive-slicing-v1" as const,
    units: "feet" as const,
    seed: resolvedSeed,
    floor: "G" as const,
    plot: requirements.plot,
    buildableBounds: { ...buildableBounds, areaSqFt: buildableArea },
    rooms: layoutRooms,
    coverageRatio: coveredArea / buildableArea,
  };
  const validated = layoutDataSchema.safeParse(layout);
  if (!validated.success) {
    throw new LayoutGenerationError("INVALID_LAYOUT", z.prettifyError(validated.error), validated.error);
  }
  return validated.data;
}
