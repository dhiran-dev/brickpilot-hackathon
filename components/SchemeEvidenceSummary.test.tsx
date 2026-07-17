import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SchemeEvidenceSummary } from "@/components/SchemeEvidenceSummary";

describe("SchemeEvidenceSummary", () => {
  test("marks cost and review evidence busy while a canonical scheme update is running", () => {
    const markup = renderToStaticMarkup(createElement(SchemeEvidenceSummary, {
      evidence: { busy: true, cost: "Updating…", review: "Updating…" },
      validationScore: 100,
    }));

    expect(markup).toContain('aria-busy="true"');
    expect(markup.match(/Updating…/g)).toHaveLength(2);
  });

  test("labels unavailable cost and review honestly after the canonical update", () => {
    const markup = renderToStaticMarkup(createElement(SchemeEvidenceSummary, {
      evidence: { busy: false, cost: "Unavailable", review: "Unavailable" },
      validationScore: 96,
    }));

    expect(markup).toContain('aria-busy="false"');
    expect(markup.match(/Unavailable/g)).toHaveLength(2);
    expect(markup).toContain("96 / 100");
  });
});
