import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ARCHITECTURAL_STYLE_PREVIEWS,
  FORM_STRATEGY_PREVIEWS,
  formStrategyPatch,
} from "@/components/guided-intake/architecture-options";
import { architecturalStyleSchema, formStrategySchema } from "@/lib/building/requirements";

describe("architecture preview options", () => {
  test("covers every persisted style and form value with a bundled unique asset", () => {
    expect(ARCHITECTURAL_STYLE_PREVIEWS.map((option) => option.value).sort()).toEqual([...architecturalStyleSchema.options].sort());
    expect(FORM_STRATEGY_PREVIEWS.map((option) => option.value).sort()).toEqual([...formStrategySchema.options].sort());

    const options = [...ARCHITECTURAL_STYLE_PREVIEWS, ...FORM_STRATEGY_PREVIEWS];
    expect(new Set(options.map((option) => option.imageSrc)).size).toBe(options.length);
    expect(options.every((option) => option.imageSrc.startsWith("/style-cards/") && option.imageSrc.endsWith(".svg"))).toBe(true);
    expect(options.every((option) => existsSync(join(process.cwd(), "public", option.imageSrc)))).toBe(true);

    for (const option of options) {
      const source = readFileSync(join(process.cwd(), "public", option.imageSrc), "utf8");
      expect(source).toContain("<svg");
      expect(source).toContain('viewBox="0 0 720 432"');
      expect(source).toMatch(/<title[^>]*>[^<]+<\/title>/);
      expect(source).toMatch(/<desc[^>]*>[^<]+<\/desc>/);
      expect(source).not.toMatch(/<(?:script|foreignObject)\b/i);
    }
  });

  test("keeps form selection editable while making courtyard an explicit programme constraint", () => {
    expect(formStrategyPatch("courtyard")).toEqual({ formStrategy: "courtyard", includeCourtyard: true });
    expect(formStrategyPatch("compact")).toEqual({ formStrategy: "compact" });
    expect(formStrategyPatch("articulated_wings")).toEqual({ formStrategy: "articulated_wings" });
  });
});
