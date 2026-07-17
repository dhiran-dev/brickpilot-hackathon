import { describe, expect, test } from "bun:test";

import { rectanglePolygon, type Building, type Floor, type Rectangle, type Space } from "@/lib/building/schema";
import {
  CAPTURED_DORMITORY_PATTERN_BUILDING,
  HAND_TILED_KNOWN_GOOD_BUILDING,
} from "@/lib/validation/shape-rule-fixtures";
import { shapeRuleFindings } from "@/lib/validation/shape-rules";
import { validateBuilding } from "@/lib/validation/validate";

const SHAPE_RULE_IDS = new Set([
  "ROOM_PROPORTION",
  "PARALLEL_BANDS",
  "CIRCULATION_RATIO",
  "GALLERY_LENGTH",
  "FLOATING_VOLUME",
]);

function cell(id: string, type: Space["type"], bounds: Rectangle): Space {
  return {
    id,
    floorId: "F0",
    name: id,
    type,
    bounds,
    planningCellPolygon: rectanglePolygon(bounds),
    areaMm2: bounds.width * bounds.depth,
    occupied: !["stair", "terrace", "courtyard"].includes(type),
    accessible: false,
  };
}

function buildingFor(envelope: Rectangle, spaces: Space[]): Building {
  const floor: Floor = {
    id: "F0",
    label: "Ground floor",
    level: 0,
    elevationMm: 0,
    floorHeightMm: 3_100,
    envelope,
    spaces,
    walls: [],
    openings: [],
  };
  return {
    buildingSchemaVersion: 2,
    algorithmVersion: "shape-test",
    rulePackVersion: "shape-test",
    rendererVersion: "shape-test",
    seed: 1,
    candidate: { generatorId: "shape-test", index: 0, score: 0, geometryHash: "shape-test" },
    site: { widthMm: envelope.width, depthMm: envelope.depth, facing: "north", roadEdges: ["north"], buildableEnvelope: envelope },
    floors: [floor],
    verticalConnectors: [],
  };
}

function findingsFor(ruleId: string, building: Building) {
  return shapeRuleFindings(building).filter((item) => item.ruleId === ruleId);
}

describe("hard villa shape rules", () => {
  test("accepts the hand-tiled, vertically coordinated multi-floor golden fixture", () => {
    expect(shapeRuleFindings(HAND_TILED_KNOWN_GOOD_BUILDING)).toEqual([]);
  });

  test("rejects the captured dormitory pattern at the integrated validation boundary", () => {
    const findings = validateBuilding(CAPTURED_DORMITORY_PATTERN_BUILDING).findings
      .filter((item) => SHAPE_RULE_IDS.has(item.ruleId));

    expect(findings).toContainEqual(expect.objectContaining({
      ruleId: "GALLERY_LENGTH",
      severity: "error",
      objectIds: ["full-depth-spine"],
    }));
    expect(findings).toContainEqual(expect.objectContaining({
      ruleId: "ROOM_PROPORTION",
      severity: "error",
      objectIds: ["right-pooja"],
    }));
  });

  test("enforces room-type proportion caps and exempts non-room circulation cells", () => {
    const envelope = { x: 0, y: 0, width: 10_000, depth: 12_000 };
    const building = buildingFor(envelope, [
      cell("good-bedroom", "bedroom", { x: 0, y: 0, width: 3_000, depth: 5_400 }),
      cell("bad-bedroom", "bedroom", { x: 0, y: 0, width: 3_000, depth: 5_401 }),
      cell("good-utility", "utility", { x: 0, y: 0, width: 1_500, depth: 3_300 }),
      cell("bad-utility", "utility", { x: 0, y: 0, width: 1_500, depth: 3_301 }),
      cell("corridor-exempt", "circulation", { x: 0, y: 0, width: 1_000, depth: 10_000 }),
    ]);

    expect(findingsFor("ROOM_PROPORTION", building).map((item) => item.objectIds[0])).toEqual([
      "bad-bedroom",
      "bad-utility",
    ]);
  });

  test("exempts covered verandahs from proportion, parallel-band, and internal-circulation rules", () => {
    const envelope = { x: 0, y: 0, width: 10_000, depth: 14_000 };
    const building = buildingFor(envelope, [
      cell("living", "living", { x: 0, y: 0, width: 5_000, depth: 6_800 }),
      cell("gallery", "circulation", { x: 5_000, y: 0, width: 5_000, depth: 1_200 }),
      cell("verandah-a", "verandah", { x: 0, y: 8_000, width: 10_000, depth: 2_000 }),
      cell("verandah-b", "verandah", { x: 0, y: 10_000, width: 10_000, depth: 2_000 }),
      cell("verandah-c", "verandah", { x: 0, y: 12_000, width: 10_000, depth: 2_000 }),
    ]);

    expect(findingsFor("ROOM_PROPORTION", building)).toEqual([]);
    expect(findingsFor("PARALLEL_BANDS", building)).toEqual([]);
    expect(findingsFor("CIRCULATION_RATIO", building)).toEqual([]);
  });

  test("uses common whole-envelope span for parallel bands", () => {
    const envelope = { x: 0, y: 0, width: 9_000, depth: 12_000 };
    const fullSpanStrips = buildingFor(envelope, [
      cell("strip-a", "living", { x: 0, y: 0, width: 9_000, depth: 4_000 }),
      cell("strip-b", "living", { x: 0, y: 4_000, width: 9_000, depth: 4_000 }),
      cell("strip-c", "living", { x: 0, y: 8_000, width: 9_000, depth: 4_000 }),
    ]);
    const roomsOffGallery = buildingFor(envelope, [
      cell("gallery", "circulation", { x: 0, y: 0, width: 9_000, depth: 1_200 }),
      cell("bedroom-a", "bedroom", { x: 0, y: 1_200, width: 3_000, depth: 4_000 }),
      cell("bedroom-b", "bedroom", { x: 3_000, y: 1_200, width: 3_000, depth: 4_000 }),
      cell("bedroom-c", "bedroom", { x: 6_000, y: 1_200, width: 3_000, depth: 4_000 }),
    ]);

    expect(findingsFor("PARALLEL_BANDS", fullSpanStrips)).toContainEqual(expect.objectContaining({
      objectIds: ["strip-a", "strip-b", "strip-c"],
      measured: { value: 3, unit: "consecutive_cells" },
      required: { max: 2, unit: "consecutive_cells" },
    }));
    expect(findingsFor("PARALLEL_BANDS", roomsOffGallery)).toEqual([]);
  });

  test("caps circulation per floor, excluding stair and open-to-sky cells", () => {
    const envelope = { x: 0, y: 0, width: 5_000, depth: 10_000 };
    const atLargePlateCap = buildingFor(envelope, [
      cell("gallery", "circulation", { x: 0, y: 0, width: 5_000, depth: 1_200 }),
      cell("living", "living", { x: 0, y: 1_200, width: 5_000, depth: 6_800 }),
      cell("stair", "stair", { x: 0, y: 8_000, width: 5_000, depth: 1_000 }),
      cell("terrace", "terrace", { x: 0, y: 9_000, width: 5_000, depth: 1_000 }),
    ]);
    const aboveLargePlateCap = structuredClone(atLargePlateCap);
    aboveLargePlateCap.floors[0].spaces[0].bounds.depth = 1_201;
    const smallEnvelope = { x: 0, y: 0, width: 5_000, depth: 6_000 };
    const atSmallPlateCap = buildingFor(smallEnvelope, [
      cell("small-gallery", "circulation", { x: 0, y: 0, width: 5_000, depth: 1_320 }),
      cell("small-living", "living", { x: 0, y: 1_320, width: 5_000, depth: 4_680 }),
    ]);
    const aboveSmallPlateCap = structuredClone(atSmallPlateCap);
    aboveSmallPlateCap.floors[0].spaces[0].bounds.depth = 1_321;

    expect(findingsFor("CIRCULATION_RATIO", atLargePlateCap)).toEqual([]);
    expect(findingsFor("CIRCULATION_RATIO", aboveLargePlateCap)[0]?.required).toEqual({ max: 0.15, unit: "ratio" });
    expect(findingsFor("CIRCULATION_RATIO", atSmallPlateCap)).toEqual([]);
    expect(findingsFor("CIRCULATION_RATIO", aboveSmallPlateCap)[0]?.required).toEqual({ max: 0.22, unit: "ratio" });
  });

  test("counts covered parking in constructed area while excluding verandah", () => {
    const envelope = { x: 0, y: 0, width: 10_000, depth: 10_000 };
    const building = buildingFor(envelope, [
      cell("gallery", "circulation", { x: 0, y: 0, width: 3_800, depth: 4_000 }),
      cell("living", "living", { x: 3_800, y: 0, width: 6_200, depth: 12_000 }),
      cell("parking", "parking", { x: 0, y: 4_000, width: 3_800, depth: 4_000 }),
      cell("verandah", "verandah", { x: 0, y: 8_000, width: 3_800, depth: 4_000 }),
    ]);

    // Excluding parking would read 15.2 / 89.6 = 17%; the covered-parking denominator makes it
    // 15.2 / 104.8 = 14.5%. The equally sized verandah remains excluded.
    expect(findingsFor("CIRCULATION_RATIO", building)).toEqual([]);
  });

  test("limits each gallery to 40% of envelope depth", () => {
    const envelope = { x: 0, y: 0, width: 10_000, depth: 12_000 };
    const atCap = buildingFor(envelope, [cell("gallery", "circulation", { x: 0, y: 0, width: 1_200, depth: 4_800 })]);
    const aboveCap = buildingFor(envelope, [cell("gallery", "circulation", { x: 0, y: 0, width: 1_200, depth: 4_801 })]);

    expect(findingsFor("GALLERY_LENGTH", atCap)).toEqual([]);
    expect(findingsFor("GALLERY_LENGTH", aboveCap)).toContainEqual(expect.objectContaining({
      objectIds: ["gallery"],
      required: { max: 0.4, unit: "envelope_ratio" },
    }));
  });

  test("rejects constructed upper cells above any lower open-to-sky cell", () => {
    const floating = structuredClone(HAND_TILED_KNOWN_GOOD_BUILDING);
    const projectedTerrace = floating.floors[1].spaces.find((space) => space.id === "f1-terrace");
    if (!projectedTerrace) throw new Error("Golden fixture terrace is missing.");
    projectedTerrace.type = "living";
    projectedTerrace.occupied = true;

    expect(findingsFor("FLOATING_VOLUME", floating)).toContainEqual(expect.objectContaining({
      floorId: "F1",
      objectIds: ["f1-terrace", "f0-court"],
      measured: { value: 12_000_000, unit: "mm2" },
    }));
  });
});
