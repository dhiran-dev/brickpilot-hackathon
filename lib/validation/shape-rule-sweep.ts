import type { Building } from "@/lib/building/schema";
import {
  PRODUCTION_SHAPE_RULE_THRESHOLDS,
  shapeRuleFindings,
  type ShapeRuleThresholds,
} from "@/lib/validation/shape-rules";

export const SHAPE_RULE_CALIBRATION_VERSION = "villa-fixture-sweep-v1";

export const SHAPE_RULE_SWEEP_PROFILES: Readonly<Record<string, Readonly<ShapeRuleThresholds>>> = Object.freeze({
  strict: Object.freeze({
    ...PRODUCTION_SHAPE_RULE_THRESHOLDS,
    habitableMaxAspectRatio: 1.6,
    serviceMaxAspectRatio: 2,
    maxCirculationRatio: 0.12,
    smallPlateMaxCirculationRatio: 0.18,
    maxGalleryEnvelopeDepthRatio: 0.35,
  }),
  production: PRODUCTION_SHAPE_RULE_THRESHOLDS,
  loose: Object.freeze({
    ...PRODUCTION_SHAPE_RULE_THRESHOLDS,
    habitableMaxAspectRatio: 2,
    serviceMaxAspectRatio: 2.5,
    maxCirculationRatio: 0.18,
    smallPlateMaxCirculationRatio: 0.25,
    maxGalleryEnvelopeDepthRatio: 0.5,
  }),
});

export type ShapeRuleSweepRow = {
  profile: string;
  evaluatedBuildings: number;
  rejectedBuildings: number;
  findingsByRule: Record<string, number>;
};

/** Deterministic calibration report over an explicit, caller-owned fixture bank. */
export function sweepShapeRuleThresholds(buildings: readonly Building[]): ShapeRuleSweepRow[] {
  return Object.entries(SHAPE_RULE_SWEEP_PROFILES).map(([profile, thresholds]) => {
    const findingsByRule: Record<string, number> = {};
    let rejectedBuildings = 0;
    for (const building of buildings) {
      const findings = shapeRuleFindings(building, thresholds);
      if (findings.length > 0) rejectedBuildings += 1;
      for (const finding of findings) findingsByRule[finding.ruleId] = (findingsByRule[finding.ruleId] ?? 0) + 1;
    }
    return { profile, evaluatedBuildings: buildings.length, rejectedBuildings, findingsByRule };
  });
}
