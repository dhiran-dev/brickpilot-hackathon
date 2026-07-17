import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DrawingUnavailableState } from "@/components/cad-workspace/DrawingUnavailableState";

describe("DrawingUnavailableState", () => {
  test("uses warm recovery copy instead of presenting an empty board as a fatal error", () => {
    const markup = renderToStaticMarkup(createElement(DrawingUnavailableState));

    expect(markup).toContain('role="status"');
    expect(markup).toContain("There is no floor sheet to pin yet.");
    expect(markup).toContain("Adjust the room programme or floor allocation");
    expect(markup).not.toContain("#ff4e00");
  });
});
