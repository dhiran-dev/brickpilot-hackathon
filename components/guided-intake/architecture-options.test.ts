import { describe, expect, test } from "bun:test";

import {
  ARCHITECTURAL_STYLE_PREVIEWS,
  FORM_STRATEGY_PREVIEWS,
  constrainArchitectureChoices,
  formStrategyPatch,
} from "@/components/guided-intake/architecture-options";
import { DEFAULT_INTAKE_DRAFT } from "@/components/guided-intake/model";
import { architecturalStyleSchema, formStrategySchema } from "@/lib/building/requirements";

describe("architecture preview options", () => {
  test("covers every persisted style and form value with a unique PNG card path", () => {
    expect(ARCHITECTURAL_STYLE_PREVIEWS.map((option) => option.value).sort()).toEqual([...architecturalStyleSchema.options].sort());
    expect(FORM_STRATEGY_PREVIEWS.map((option) => option.value).sort()).toEqual([...formStrategySchema.options].sort());

    const options = [...ARCHITECTURAL_STYLE_PREVIEWS, ...FORM_STRATEGY_PREVIEWS];
    expect(new Set(options.map((option) => option.imageSrc)).size).toBe(options.length);
    expect(options.every((option) => option.imageSrc.startsWith("/style-cards/") && option.imageSrc.endsWith(".png"))).toBe(true);
    expect(options.every((option) => option.imageAlt.trim().length > 0 && option.plate.trim().length > 0 && option.title.trim().length > 0 && option.detail.trim().length > 0)).toBe(true);
  });

  test("puts the only available choices first and constrains questionnaire drafts to them", () => {
    expect(ARCHITECTURAL_STYLE_PREVIEWS[0]).toMatchObject({ value: "modernist", available: true });
    expect(FORM_STRATEGY_PREVIEWS[0]).toMatchObject({ value: "stepped_terraces", available: true });
    expect(ARCHITECTURAL_STYLE_PREVIEWS.filter((option) => option.available)).toHaveLength(1);
    expect(FORM_STRATEGY_PREVIEWS.filter((option) => option.available)).toHaveLength(1);
    expect(constrainArchitectureChoices(DEFAULT_INTAKE_DRAFT)).toMatchObject({
      architecturalStyle: "modernist",
      formStrategy: "stepped_terraces",
    });
  });

  test("keeps form selection editable while making courtyard an explicit programme constraint", () => {
    expect(formStrategyPatch("courtyard")).toEqual({ formStrategy: "courtyard", includeCourtyard: true });
    expect(formStrategyPatch("compact")).toEqual({ formStrategy: "compact" });
    expect(formStrategyPatch("articulated_wings")).toEqual({ formStrategy: "articulated_wings" });
  });
});
