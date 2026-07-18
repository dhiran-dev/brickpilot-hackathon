import { describe, expect, test } from "bun:test";

import { capabilitiesForWorkspace, projectCapabilityPresentation } from "@/components/project-capability-ui";
import { createDraftId, resolveWorkspaceDraft, saveDraft } from "@/lib/design/draft-storage";
import { deleteStoredAssetsExact } from "@/lib/render/storage";
import { resolveProjectCapabilities } from "@/lib/server/project-capabilities";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("browser-independent lifecycle acceptance contracts", () => {
  test("new project creates a blank identity while resume requires an explicit draft id", () => {
    const storage = new MemoryStorage();
    const first = resolveWorkspaceDraft(storage, null).draftId;
    const second = resolveWorkspaceDraft(storage, null).draftId;
    expect(second).not.toBe(first);
    saveDraft(storage, first, { version: 4, draft: { projectName: "First" }, stepIndex: 2 });
    expect(resolveWorkspaceDraft(storage, first)).toEqual({ draftId: first, resumed: true });
    expect(createDraftId()).not.toBe(first);
  });

  test("legacy results remain viewable while all AI, scheme, capture and render mutations are denied", () => {
    const capabilities = resolveProjectCapabilities("legacy_view_only", "ready");
    expect(capabilities).toMatchObject({ canView: true, canReadAssets: true, canApplyAiSuggestion: false, canSelectScheme: false, canGenerateRender: false, canRetryRender: false });
    expect(capabilitiesForWorkspace(capabilities)).toEqual(capabilities);
    expect(projectCapabilityPresentation({ capabilityProfile: "legacy_view_only", projectStatus: "ready", capabilities }))
      .toMatchObject({ kind: "view_only", blocksNormalAccess: false });
  });

  test("deleting projects block normal access and exact-object deletion can be retried", async () => {
    expect(projectCapabilityPresentation({
      capabilityProfile: "current_v3",
      projectStatus: "deleting",
      capabilities: resolveProjectCapabilities("current_v3", "deleting"),
    })).toMatchObject({ kind: "deleting", blocksNormalAccess: true });
    const failedOnce = new Set<string>();
    const deleteOne = async (key: string) => {
      if (key.endsWith("two.webp") && !failedOnce.has(key)) {
        failedOnce.add(key);
        throw new Error("transient failure");
      }
    };
    const first = await deleteStoredAssetsExact(["renders/job/one.webp", "renders/job/two.webp"], deleteOne);
    expect(first.failed).toHaveLength(1);
    const retry = await deleteStoredAssetsExact(first.failed.map((failure) => failure.storageKey), deleteOne);
    expect(retry).toEqual({ deleted: ["renders/job/two.webp"], failed: [] });
  });
});
