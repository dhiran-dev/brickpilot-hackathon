import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ProjectDeletionControl } from "@/components/project-deletion-control";

const baseProps = {
  projectId: "project-a",
  designId: "design-a",
  projectTitle: "Courtyard Home",
  onCompleted: () => {},
};

describe("ProjectDeletionControl", () => {
  test("exposes a discoverable delete action only when capabilities allow it", () => {
    const allowed = renderToStaticMarkup(createElement(ProjectDeletionControl, { ...baseProps, canDelete: true }));
    const denied = renderToStaticMarkup(createElement(ProjectDeletionControl, { ...baseProps, canDelete: false }));

    expect(allowed).toContain("Delete project");
    expect(denied).not.toContain("Delete project");
  });
});
