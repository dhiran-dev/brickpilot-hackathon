import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RelaxationNoticeBadge } from "@/components/RelaxationNoticeBadge";

describe("RelaxationNoticeBadge", () => {
  test("renders the exact rung-3 disclosure and stays absent for an unrelaxed scheme", () => {
    expect(renderToStaticMarkup(createElement(RelaxationNoticeBadge, { rung: 0 }))).toBe("");
    expect(renderToStaticMarkup(createElement(RelaxationNoticeBadge, { rung: 3 }))).toContain("Compact fallback used");
  });
});
