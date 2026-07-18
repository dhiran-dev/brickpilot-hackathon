import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LayerPanel } from "@/components/cad-workspace/LayerPanel";
import { visibilityForPreset } from "@/lib/drawing/schema";

describe("2D drawing layer controls", () => {
  test("does not offer the deferred roof overlay while preserving other drawing controls", () => {
    const markup = renderToStaticMarkup(createElement(LayerPanel, {
      appearance: "cad-dark",
      layers: visibilityForPreset("architectural"),
      activePreset: "architectural",
      onAppearanceChange: () => undefined,
      onLayerChange: () => undefined,
      onPresetChange: () => undefined,
    }));

    expect(markup).not.toContain("Roof planes + ridges");
    expect(markup).toContain("Walls + columns");
    expect(markup).toContain("Supports + edge protection");
  });
});
