export const DRAFT_STORAGE_PREFIX = "brickpilot:draft:";
export const DRAFT_INDEX_KEY = "brickpilot:drafts";

const DRAFT_INDEX_VERSION = 1;
const DRAFT_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type DraftSnapshot<T> = {
  version: number;
  draft: T;
  stepIndex: number;
  updatedAt: string;
};

export type DraftIndexEntry = {
  draftId: string;
  title: string;
  updatedAt: string;
  consumed: boolean;
};

type DraftIndex = {
  version: number;
  drafts: DraftIndexEntry[];
};

export function isDraftId(value: string | null | undefined): value is string {
  return typeof value === "string" && DRAFT_ID_PATTERN.test(value);
}

export function createDraftId(randomUuid: () => string = () => crypto.randomUUID()): string {
  const draftId = randomUuid();
  if (!isDraftId(draftId)) throw new Error("Draft IDs must be URL-safe and at least eight characters long.");
  return draftId;
}

export function draftStorageKey(draftId: string): string {
  if (!isDraftId(draftId)) throw new Error("Invalid draft ID.");
  return `${DRAFT_STORAGE_PREFIX}${draftId}`;
}

export function clientRequestIdForDraft(draftId: string): string {
  return `draft:${draftStorageKey(draftId).slice(DRAFT_STORAGE_PREFIX.length)}`;
}

function parseIndex(storage: DraftStorage): DraftIndex {
  try {
    const parsed = JSON.parse(storage.getItem(DRAFT_INDEX_KEY) ?? "null") as Partial<DraftIndex> | null;
    if (!parsed || !Array.isArray(parsed.drafts)) return { version: DRAFT_INDEX_VERSION, drafts: [] };
    return {
      version: DRAFT_INDEX_VERSION,
      drafts: parsed.drafts.filter((entry): entry is DraftIndexEntry => Boolean(
        entry
        && isDraftId(entry.draftId)
        && typeof entry.title === "string"
        && typeof entry.updatedAt === "string"
        && typeof entry.consumed === "boolean",
      )),
    };
  } catch {
    return { version: DRAFT_INDEX_VERSION, drafts: [] };
  }
}

function writeIndex(storage: DraftStorage, drafts: DraftIndexEntry[]) {
  storage.setItem(DRAFT_INDEX_KEY, JSON.stringify({ version: DRAFT_INDEX_VERSION, drafts } satisfies DraftIndex));
}

export function listResumableDrafts(storage: DraftStorage): DraftIndexEntry[] {
  return parseIndex(storage).drafts
    .filter((entry) => !entry.consumed && storage.getItem(draftStorageKey(entry.draftId)) != null)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function loadDraft<T>(storage: DraftStorage, draftId: string): DraftSnapshot<T> | null {
  try {
    const parsed = JSON.parse(storage.getItem(draftStorageKey(draftId)) ?? "null") as Partial<DraftSnapshot<T>> | null;
    if (!parsed || typeof parsed.version !== "number" || parsed.draft == null || typeof parsed.stepIndex !== "number" || typeof parsed.updatedAt !== "string") return null;
    return {
      version: parsed.version,
      draft: parsed.draft,
      stepIndex: parsed.stepIndex,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

export function resolveWorkspaceDraft(
  storage: DraftStorage,
  requestedDraftId: string | null,
  createId: () => string = createDraftId,
): { draftId: string; resumed: boolean } {
  if (requestedDraftId && loadDraft(storage, requestedDraftId)) return { draftId: requestedDraftId, resumed: true };
  return { draftId: createId(), resumed: false };
}

export function saveDraft<T>(
  storage: DraftStorage,
  draftId: string,
  snapshot: Omit<DraftSnapshot<T>, "updatedAt">,
  options: { title?: string; now?: string } = {},
): DraftSnapshot<T> {
  const updatedAt = options.now ?? new Date().toISOString();
  const stored = { ...snapshot, updatedAt };
  storage.setItem(draftStorageKey(draftId), JSON.stringify(stored));

  const current = parseIndex(storage).drafts.filter((entry) => entry.draftId !== draftId);
  writeIndex(storage, [{
    draftId,
    title: options.title?.trim() || "Untitled project",
    updatedAt,
    consumed: false,
  }, ...current]);
  return stored;
}

export function consumeDraft(storage: DraftStorage, draftId: string, now = new Date().toISOString()) {
  storage.removeItem(draftStorageKey(draftId));
  const current = parseIndex(storage).drafts;
  const existing = current.find((entry) => entry.draftId === draftId);
  if (!existing) return;
  writeIndex(storage, current.map((entry) => entry.draftId === draftId
    ? { ...entry, consumed: true, updatedAt: now }
    : entry));
}

export function clearDraft(storage: DraftStorage, draftId: string) {
  storage.removeItem(draftStorageKey(draftId));
  writeIndex(storage, parseIndex(storage).drafts.filter((entry) => entry.draftId !== draftId));
}

export function resolveDraftHydration<T>({
  authoritativeValue,
  storedDraft,
  defaultValue,
}: {
  authoritativeValue?: T;
  storedDraft: DraftSnapshot<T> | null;
  defaultValue: T;
}): { value: T; stepIndex: number; source: "authoritative" | "draft" | "default" } {
  if (authoritativeValue !== undefined) return { value: authoritativeValue, stepIndex: 0, source: "authoritative" };
  if (storedDraft) return { value: storedDraft.draft, stepIndex: storedDraft.stepIndex, source: "draft" };
  return { value: defaultValue, stepIndex: 0, source: "default" };
}
