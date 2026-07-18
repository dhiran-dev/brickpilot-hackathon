import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ArchitectureOptionCard, ArchitectureReferencePicker } from "@/components/guided-intake/GuidedIntake";
import { ARCHITECTURAL_STYLE_PREVIEWS, FORM_STRATEGY_PREVIEWS } from "@/components/guided-intake/architecture-options";

function findElements(node: ReactNode, predicate: (element: ReactElement) => boolean): ReactElement[] {
  const matches: ReactElement[] = [];
  const visit = (child: ReactNode): void => {
    if (Array.isArray(child)) { child.forEach(visit); return; }
    if (!isValidElement(child)) return;
    if (predicate(child)) matches.push(child);
    visit((child.props as { children?: ReactNode }).children);
  };
  visit(node);
  return matches;
}

describe("GuidedIntake architecture option cards", () => {
  test("renders every option as a radio card in a responsive grid", () => {
    const markup = renderToStaticMarkup(createElement(ArchitectureReferencePicker, {
      legend: "Choose the villa language",
      description: "Choose a grounded regional reference.",
      name: "architectural-style-test",
      options: ARCHITECTURAL_STYLE_PREVIEWS,
      value: "contemporary_tropical",
      onChange: () => undefined,
    }));

    expect(markup).toContain("<fieldset");
    expect(markup).toContain("sm:grid-cols-2 xl:grid-cols-3");
    expect(markup).toContain("aspect-[16/10]");
    expect(markup).toContain("name=\"architectural-style-test-");
    expect(markup.match(/type="radio"/g)?.length).toBe(ARCHITECTURAL_STYLE_PREVIEWS.length);
    expect(markup.match(/<img /g)?.length).toBe(ARCHITECTURAL_STYLE_PREVIEWS.length);
    expect(markup.match(/disabled=""/g)?.length).toBe(ARCHITECTURAL_STYLE_PREVIEWS.length - 1);
    expect(markup.match(/Coming soon/g)?.length).toBe(ARCHITECTURAL_STYLE_PREVIEWS.length - 1);
    expect(markup.indexOf("Modernist")).toBeLessThan(markup.indexOf("Contemporary tropical"));
    for (const option of ARCHITECTURAL_STYLE_PREVIEWS) {
      expect(markup).toContain(option.title);
      expect(markup).toContain(option.detail);
      expect(markup).toContain(option.plate);
      expect(markup).toContain(`value="${option.value}"`);
      expect(markup).toContain(option.imageAlt);
    }
    expect(markup).not.toContain("data-layout=");
    expect(markup).not.toContain("intake-reference");
    expect(markup).not.toContain("intake-choice-rail");
    expect(markup).not.toContain("reference unavailable");
    expect(markup).not.toContain("aria-pressed");
  });

  test("marks the selected option with the checked radio and check badge", () => {
    const markup = renderToStaticMarkup(createElement(ArchitectureReferencePicker, {
      legend: "Choose the villa language",
      description: "Choose a grounded regional reference.",
      name: "architectural-style-test",
      options: ARCHITECTURAL_STYLE_PREVIEWS,
      value: "modernist",
      onChange: () => undefined,
    }));

    expect(markup.match(/checked=""/g)?.length).toBe(1);
    expect(markup).toMatch(/<input(?=[^>]*checked="")(?=[^>]*value="modernist")[^>]*>/);
    expect(markup).toContain("<span class=\"sr-only\">Selected</span>");
    expect(markup).toContain("aria-live=\"polite\"");
    expect(markup).toContain("Selected Modernist.");
  });

  test("shows the regional suggestion once as a compact badge", () => {
    const markup = renderToStaticMarkup(createElement(ArchitectureReferencePicker, {
      legend: "Choose the villa language",
      description: "Choose a grounded regional reference.",
      name: "architectural-style-test",
      options: ARCHITECTURAL_STYLE_PREVIEWS,
      value: "modernist",
      suggestedValue: "modernist",
      suggestionLabel: "Kerala",
      onChange: () => undefined,
    }));

    expect(markup.match(/Suggested for Kerala/g)?.length).toBe(1);
  });

  test("preserves complete long labels and uses a separate radio group per picker", () => {
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

  test("calls onChange with the option value when a card radio changes", () => {
    const option = FORM_STRATEGY_PREVIEWS[0];
    const selected: string[] = [];
    const card = ArchitectureOptionCard({
      option,
      checked: false,
      radioName: "form-strategy-group",
      onSelect: (value) => selected.push(value),
      onImageError: () => undefined,
    });

    const radios = findElements(card, (element) => element.type === "input");
    expect(radios).toHaveLength(1);
    expect((radios[0].props as { type: string }).type).toBe("radio");
    expect((radios[0].props as { value: string }).value).toBe(option.value);
    (radios[0].props as { onChange: () => void }).onChange();
    expect(selected).toEqual([option.value]);
  });

  test("keeps coming-soon cards inert even if their change handler is invoked", () => {
    const option = FORM_STRATEGY_PREVIEWS[1];
    const selected: string[] = [];
    const card = ArchitectureOptionCard({
      option,
      checked: false,
      radioName: "form-strategy-group",
      onSelect: (value) => selected.push(value),
      onImageError: () => undefined,
    });

    const radio = findElements(card, (element) => element.type === "input")[0];
    expect((radio.props as { disabled: boolean }).disabled).toBe(true);
    (radio.props as { onChange: () => void }).onChange();
    expect(selected).toEqual([]);
  });

  test("hides the thumbnail entirely after an image error so the card still reads complete", () => {
    const option = ARCHITECTURAL_STYLE_PREVIEWS[0];
    const failedSources: string[] = [];
    const props = {
      option,
      checked: true,
      radioName: "architectural-style-group",
      onSelect: () => undefined,
      onImageError: (source: string) => failedSources.push(source),
    };

    const card = ArchitectureOptionCard(props);
    const images = findElements(card, (element) => element.type === "img");
    expect(images).toHaveLength(1);
    expect((images[0].props as { alt: string }).alt).toBe(option.imageAlt);
    expect((images[0].props as { src: string }).src).toBe(option.imageSrc);
    (images[0].props as { onError: () => void }).onError();
    expect(failedSources).toEqual([option.imageSrc]);

    const degraded = renderToStaticMarkup(createElement(ArchitectureOptionCard, { ...props, imageFailed: true }));
    expect(degraded).not.toContain("<img");
    expect(degraded).not.toContain("aspect-[16/10]");
    expect(degraded).not.toContain("unavailable");
    expect(degraded).toContain(option.plate);
    expect(degraded).toContain(option.title);
    expect(degraded).toContain(option.detail);
  });

  test("drops the retired reference-sheet and choice-rail styles from globals.css", () => {
    const css = readFileSync("app/globals.css", "utf8");

    expect(css).not.toContain("intake-reference");
    expect(css).not.toContain("intake-choice-rail");
    expect(css).not.toContain("intake-radio-input");
    expect(css).not.toContain("-webkit-line-clamp");
    expect(css).toContain(".intake-stepper");
    expect(css).toContain(".intake-actions");
  });

  test("keeps the deferred roof character choice out of the questionnaire and review", () => {
    const source = readFileSync("components/guided-intake/GuidedIntake.tsx", "utf8");

    expect(source).not.toContain('Field label="Roof character"');
    expect(source).not.toContain('["Roof + shade"');
    expect(source).toContain('["Shade structures"');
  });

  test("returns every questionnaire step change to the top of the intake", () => {
    const source = readFileSync("components/guided-intake/GuidedIntake.tsx", "utf8");

    expect(source).toContain('intakeRef.current?.scrollIntoView({ behavior: "auto", block: "start" })');
    expect(source).toContain("onClick={() => showStep(index)}");
    expect(source).toContain("const goToNextStep = () => showStep(stepIndex + 1)");
  });
});
