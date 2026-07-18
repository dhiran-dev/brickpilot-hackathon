import { describe, expect, test } from "bun:test";

import {
  DRAFT_INDEX_KEY,
  clientRequestIdForDraft,
  consumeDraft,
  createDraftId,
  draftStorageKey,
  listResumableDrafts,
  loadDraft,
  resolveDraftHydration,
  resolveWorkspaceDraft,
  saveDraft,
  type DraftStorage,
} from "@/lib/design/draft-storage";

class MemoryStorage implements DraftStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";

describe("draft storage", () => {
  test("creates unique URL-safe IDs and uses one isolated payload key per project draft", () => {
    const ids = [FIRST_ID, SECOND_ID];
    expect(createDraftId(() => ids.shift()!)).toBe(FIRST_ID);
    expect(createDraftId(() => ids.shift()!)).toBe(SECOND_ID);
    expect(draftStorageKey(FIRST_ID)).toBe(`brickpilot:draft:${FIRST_ID}`);
    expect(draftStorageKey(SECOND_ID)).not.toBe(draftStorageKey(FIRST_ID));
  });

  test("refresh and explicit resume load only the addressed draft", () => {
    const storage = new MemoryStorage();
    saveDraft(storage, FIRST_ID, { version: 4, draft: { projectName: "First" }, stepIndex: 3 }, { title: "First", now: "2026-07-18T10:00:00.000Z" });
    saveDraft(storage, SECOND_ID, { version: 4, draft: { projectName: "Second" }, stepIndex: 6 }, { title: "Second", now: "2026-07-18T11:00:00.000Z" });

    expect(loadDraft<{ projectName: string }>(storage, FIRST_ID)).toMatchObject({ draft: { projectName: "First" }, stepIndex: 3 });
    expect(loadDraft<{ projectName: string }>(storage, SECOND_ID)).toMatchObject({ draft: { projectName: "Second" }, stepIndex: 6 });
    expect(listResumableDrafts(storage).map((entry) => entry.draftId)).toEqual([SECOND_ID, FIRST_ID]);
  });

  test("a clean new project does not implicitly select the most recent old draft", () => {
    const storage = new MemoryStorage();
    saveDraft(storage, FIRST_ID, { version: 4, draft: { projectName: "Old answer" }, stepIndex: 5 }, { title: "Old answer" });
    const route = resolveWorkspaceDraft(storage, null, () => SECOND_ID);
    const hydration = resolveDraftHydration({ authoritativeValue: undefined, storedDraft: null, defaultValue: { projectName: "" } });

    expect(route).toEqual({ draftId: SECOND_ID, resumed: false });
    expect(hydration).toEqual({ value: { projectName: "" }, stepIndex: 0, source: "default" });
    expect(listResumableDrafts(storage)).toHaveLength(1);
  });

  test("a refresh resumes only the draft explicitly carried in the URL", () => {
    const storage = new MemoryStorage();
    saveDraft(storage, FIRST_ID, { version: 4, draft: { projectName: "Addressed" }, stepIndex: 4 }, { title: "Addressed" });

    expect(resolveWorkspaceDraft(storage, FIRST_ID, () => SECOND_ID)).toEqual({ draftId: FIRST_ID, resumed: true });
    expect(resolveWorkspaceDraft(storage, "missing-draft-id", () => SECOND_ID)).toEqual({ draftId: SECOND_ID, resumed: false });
  });

  test("authoritative saved-project or explicit prefill data outranks browser storage", () => {
    const hydration = resolveDraftHydration({
      authoritativeValue: { projectName: "Saved server project" },
      storedDraft: { version: 4, draft: { projectName: "Browser draft" }, stepIndex: 7, updatedAt: "2026-07-18T10:00:00.000Z" },
      defaultValue: { projectName: "Default" },
    });

    expect(hydration).toEqual({ value: { projectName: "Saved server project" }, stepIndex: 0, source: "authoritative" });
  });

  test("successful creation consumes the payload and excludes it from resume without affecting other drafts", () => {
    const storage = new MemoryStorage();
    saveDraft(storage, FIRST_ID, { version: 4, draft: { projectName: "Created" }, stepIndex: 7 }, { title: "Created" });
    saveDraft(storage, SECOND_ID, { version: 4, draft: { projectName: "Keep me" }, stepIndex: 2 }, { title: "Keep me" });

    consumeDraft(storage, FIRST_ID, "2026-07-18T12:00:00.000Z");

    expect(loadDraft(storage, FIRST_ID)).toBeNull();
    expect(loadDraft(storage, SECOND_ID)).not.toBeNull();
    expect(listResumableDrafts(storage).map((entry) => entry.draftId)).toEqual([SECOND_ID]);
    expect(storage.getItem(DRAFT_INDEX_KEY)).toContain(`"draftId":"${FIRST_ID}"`);
    expect(storage.getItem(DRAFT_INDEX_KEY)).toContain('"consumed":true');
  });

  test("keeps one stable create idempotency key for every retry of a draft", () => {
    expect(clientRequestIdForDraft(FIRST_ID)).toBe(`draft:${FIRST_ID}`);
    expect(clientRequestIdForDraft(FIRST_ID)).toBe(clientRequestIdForDraft(FIRST_ID));
    expect(clientRequestIdForDraft(SECOND_ID)).not.toBe(clientRequestIdForDraft(FIRST_ID));
  });

  test("ignores malformed index and payload data", () => {
    const storage = new MemoryStorage();
    storage.setItem(DRAFT_INDEX_KEY, "not-json");
    storage.setItem(draftStorageKey(FIRST_ID), "not-json");
    expect(listResumableDrafts(storage)).toEqual([]);
    expect(loadDraft(storage, FIRST_ID)).toBeNull();
  });
});
