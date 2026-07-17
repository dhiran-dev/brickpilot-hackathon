import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SchemeRack, shouldShowSchemeRack } from "@/components/scheme-rack/SchemeRack";
import { BUILDING_FIXTURES } from "@/lib/building/fixtures";
import { generateBuildingSchemes } from "@/lib/building/generate";

describe("gate-aware scheme rack", () => {
  test("hides the picker for one scheme or while the evidence gate is off", () => {
    expect(shouldShowSchemeRack(1, true)).toBe(false);
    expect(shouldShowSchemeRack(3, false)).toBe(false);
    expect(shouldShowSchemeRack(2, true)).toBe(true);
  });

  test("renders two native radio choices without a blank third slot", () => {
    const generated = generateBuildingSchemes({ ...BUILDING_FIXTURES[1].requirements, seed: 42 });
    const schemes = generated.schemes.slice(0, 2);
    expect(schemes).toHaveLength(2);
    const markup = renderToStaticMarkup(createElement(SchemeRack, {
      schemes,
      selectedSchemeId: schemes[0].schemeId,
      pendingSchemeId: schemes[1].schemeId,
      onChange: () => undefined,
    }));
    expect((markup.match(/type="radio"/g) ?? [])).toHaveLength(2);
    expect(markup).toContain('data-scheme-count="2"');
    expect(markup).toContain("Pinned");
    expect(markup).toContain("Ready");
  });

  test("renders exactly three labeled choices and a mobile tab treatment for a three-scheme study", () => {
    const generated = generateBuildingSchemes({ ...BUILDING_FIXTURES[1].requirements, seed: 42 });
    const schemes = generated.schemes.slice(0, 3);
    expect(schemes).toHaveLength(3);

    const markup = renderToStaticMarkup(createElement(SchemeRack, {
      schemes,
      selectedSchemeId: schemes[0].schemeId,
      pendingSchemeId: schemes[0].schemeId,
      onChange: () => undefined,
    }));

    expect((markup.match(/type="radio"/g) ?? [])).toHaveLength(3);
    expect(markup).toContain('data-scheme-count="3"');
    expect(markup).toContain("min-w-[13.5rem]");
    expect(markup).toContain("hidden aspect-[3/2]");
    for (const scheme of schemes) expect(markup).toContain(scheme.name);
  });
});
