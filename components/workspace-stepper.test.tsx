import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { WorkspaceStepper, type WorkspaceStepperItem } from "@/components/workspace-stepper";

const items: WorkspaceStepperItem[] = [
  { id: "directions", complete: true, onSelect: () => undefined },
  { id: "plan", onSelect: () => undefined },
  { id: "massing", href: "/workspace/designs/abc123/massing" },
  { id: "render", disabled: true },
];

describe("workspace stepper", () => {
  test("marks the current step and labels all four workflow steps", () => {
    const markup = renderToStaticMarkup(createElement(WorkspaceStepper, { current: "plan", items }));
    expect(markup).toContain('aria-current="step"');
    for (const label of ["Directions", "2D plan", "3D massing", "Render"]) expect(markup).toContain(label);
  });

  test("renders linked steps as anchors and disabled steps as plain muted text", () => {
    const markup = renderToStaticMarkup(createElement(WorkspaceStepper, { current: "directions", items }));
    expect(markup).toContain('href="/workspace/designs/abc123/massing"');
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).not.toContain("render-gallery");
  });
});
