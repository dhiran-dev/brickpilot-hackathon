import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("workspace product copy", () => {
  test("removes retired workspace actions and render-idle instructions", () => {
    const workspace = readFileSync("components/design-workspace.tsx", "utf8");
    const massing = readFileSync("components/massing/MassingWorkspace.tsx", "utf8");

    expect(workspace).not.toContain("> New study</button>");
    expect(workspace).not.toContain("<ProjectDeletionControl");
    expect(massing).not.toContain("Nothing has been sent to GPT Image 2.");
    expect(massing).not.toContain("Prepare and review the local reference set, then confirm explicitly.");
  });
});
