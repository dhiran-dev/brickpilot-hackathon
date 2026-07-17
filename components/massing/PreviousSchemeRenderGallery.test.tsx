import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PreviousSchemeRenderGallery, type PreviousSchemeRenderAsset } from "@/components/massing/PreviousSchemeRenderGallery";

const assets: PreviousSchemeRenderAsset[] = [
  {
    id: "render-a",
    role: "exterior_front",
    url: "/api/assets/render-a.webp",
    contentType: "image/webp",
    index: 0,
    schemeId: "scheme-a",
    schemeDisposition: "previous",
  },
  {
    id: "render-legacy",
    role: "interior",
    url: "/api/assets/render-legacy.webp",
    contentType: "image/webp",
    index: 1,
    schemeId: null,
    schemeDisposition: "previous",
  },
];

describe("PreviousSchemeRenderGallery", () => {
  test("renders nothing when no previous artifacts exist", () => {
    const markup = renderToStaticMarkup(createElement(PreviousSchemeRenderGallery, {
      assets: [],
      schemeNameById: new Map(),
    }));

    expect(markup).toBe("");
  });

  test("groups preserved artifacts away from current evidence and labels bound and legacy schemes", () => {
    const markup = renderToStaticMarkup(createElement(PreviousSchemeRenderGallery, {
      assets,
      schemeNameById: new Map([["scheme-a", "Courtyard Villa · Scheme A"]]),
    }));

    expect(markup).toContain('aria-label="Previous scheme renders"');
    expect(markup).toContain("not evidence for the current geometry");
    expect(markup).toContain('data-scheme-id="scheme-a"');
    expect(markup).toContain("Previous scheme · Courtyard Villa · Scheme A");
    expect(markup).toContain('data-scheme-id="legacy"');
    expect(markup).toContain("Previous scheme · Legacy scheme");
  });
});
