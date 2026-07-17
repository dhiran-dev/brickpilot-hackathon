import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ArchitectureReferencePicker } from "@/components/guided-intake/GuidedIntake";
import { ARCHITECTURAL_STYLE_PREVIEWS, FORM_STRATEGY_PREVIEWS } from "@/components/guided-intake/architecture-options";

describe("GuidedIntake pinned architecture references", () => {
  test("renders a native radio group with one pinned selected reference", () => {
    const markup = renderToStaticMarkup(createElement(ArchitectureReferencePicker, {
      legend: "Choose the villa language",
      description: "Choose a grounded regional reference.",
      name: "architectural-style-test",
      options: ARCHITECTURAL_STYLE_PREVIEWS,
      value: "contemporary_tropical",
      suggestedValue: "contemporary_tropical",
      suggestionLabel: "Kerala",
      onChange: () => undefined,
    }));

    expect(markup).toContain("<fieldset");
    expect(markup).toContain("data-layout=\"pinned-reference-choice-rail\"");
    expect(markup.match(/type="radio"/g)?.length).toBe(ARCHITECTURAL_STYLE_PREVIEWS.length);
    expect(markup.match(/checked=""/g)?.length).toBe(1);
    expect(markup).toContain("name=\"architectural-style-test-");
    expect(markup).toContain("Suggested for Kerala");
    expect(markup).toContain("Layered tropical villa with deep overhangs and screened terraces");
    expect(markup).toContain("reference illustration unavailable");
    expect(markup).toContain("aria-live=\"polite\"");
    expect(markup).not.toContain("aria-pressed");
  });

  test("preserves complete long labels and uses a separate radio group for form strategy", () => {
    const longOptions = [{
      ...FORM_STRATEGY_PREVIEWS[0],
      title: "Stepped terraces with a deliberately extended architectural reference label",
    }, ...FORM_STRATEGY_PREVIEWS.slice(1)] as const;
    const markup = renderToStaticMarkup(createElement(ArchitectureReferencePicker, {
      legend: "Choose the built-form strategy",
      description: "Choose the volumetric rule.",
      name: "form-strategy-test",
      options: longOptions,
      value: "stepped_terraces",
      onChange: () => undefined,
    }));

    expect(markup.match(/type="radio"/g)?.length).toBe(FORM_STRATEGY_PREVIEWS.length);
    expect(markup).toContain("name=\"form-strategy-test-");
    expect(markup).toContain("Stepped terraces with a deliberately extended architectural reference label");
  });

  test("defines the approved three responsive bands, 44px targets and reduced-motion override", () => {
    const css = readFileSync("app/globals.css", "utf8");

    expect(css).toContain("@media (min-width: 1200px)");
    expect(css).toContain("@media (min-width: 768px) and (max-width: 1199px)");
    expect(css).toContain("@media (max-width: 767px)");
    expect(css).toContain("min-height: 44px");
    expect(css).toContain("min-height: 56px");
    expect(css).toContain("env(safe-area-inset-bottom)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("grid-template-columns: minmax(0, 2fr) minmax(16rem, 1fr)");
    expect(css).toContain("aspect-ratio: 4 / 3");
    expect(css).toContain("-webkit-line-clamp: 2");
  });
});
