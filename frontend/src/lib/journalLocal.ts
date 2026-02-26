'use client';

import type { Entry, EntryCreatePayload } from '@/types/api';

export type EntryTemplateId = 'quick-roll' | 'comp-class' | 'drill-day' | 'open-mat';

export interface SavedEntrySearch {
  id: string;
  name: string;
  query: string;
  tag: string;
  giOrNoGi: '' | 'gi' | 'no-gi';
  minIntensity: string;
  maxIntensity: string;
}

export interface OfflineCreateQueueItem {
  queueId: string;
  createdAt: string;
  payload: EntryCreatePayload;
}

type LocalBackup = {
  savedAt: string;
  drafts: Record<string, unknown>;
  savedSearches: SavedEntrySearch[];
  offlineCreateQueue: OfflineCreateQueueItem[];
};

const ENTRY_DRAFT_PREFIX = 'journal.entryDraft.';
const SAVED_SEARCHES_KEY = 'journal.savedSearches.v1';
const OFFLINE_CREATE_QUEUE_KEY = 'journal.offlineCreateQueue.v1';

const canUseStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const readJson = <T>(key: string, fallback: T): T => {
  if (!canUseStorage()) return fallback;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown) => {
  if (!canUseStorage()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
};

export const listEntryDraftKeys = (): string[] => {
  if (!canUseStorage()) return [];
  return Object.keys(window.localStorage).filter((key) => key.startsWith(ENTRY_DRAFT_PREFIX));
};

export const readEntryDraft = <T>(draftId: string): T | null =>
  readJson<T | null>(`${ENTRY_DRAFT_PREFIX}${draftId}`, null);

export const writeEntryDraft = (draftId: string, value: unknown) => {
  writeJson(`${ENTRY_DRAFT_PREFIX}${draftId}`, value);
};

export const clearEntryDraft = (draftId: string) => {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(`${ENTRY_DRAFT_PREFIX}${draftId}`);
};

export const readSavedEntrySearches = (): SavedEntrySearch[] =>
  readJson<SavedEntrySearch[]>(SAVED_SEARCHES_KEY, []);

export const writeSavedEntrySearches = (searches: SavedEntrySearch[]) => {
  writeJson(SAVED_SEARCHES_KEY, searches);
};

export const readOfflineCreateQueue = (): OfflineCreateQueueItem[] =>
  readJson<OfflineCreateQueueItem[]>(OFFLINE_CREATE_QUEUE_KEY, []);

export const writeOfflineCreateQueue = (items: OfflineCreateQueueItem[]) => {
  writeJson(OFFLINE_CREATE_QUEUE_KEY, items);
};

export const enqueueOfflineCreate = (payload: EntryCreatePayload): OfflineCreateQueueItem => {
  const next: OfflineCreateQueueItem = {
    queueId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    payload,
  };
  writeOfflineCreateQueue([...readOfflineCreateQueue(), next]);
  return next;
};

export const buildLocalJournalBackup = (): LocalBackup => {
  const drafts = Object.fromEntries(
    listEntryDraftKeys().map((key) => [key.replace(ENTRY_DRAFT_PREFIX, ''), readJson(key, null)]),
  );
  return {
    savedAt: new Date().toISOString(),
    drafts,
    savedSearches: readSavedEntrySearches(),
    offlineCreateQueue: readOfflineCreateQueue(),
  };
};

export const restoreLocalJournalBackup = (payload: unknown): { restoredDrafts: number; restoredSearches: number; restoredQueue: number } => {
  const candidate = (payload ?? {}) as Partial<LocalBackup>;
  const drafts = candidate.drafts && typeof candidate.drafts === 'object' ? candidate.drafts : {};
  const savedSearches = Array.isArray(candidate.savedSearches) ? candidate.savedSearches : [];
  const queue = Array.isArray(candidate.offlineCreateQueue) ? candidate.offlineCreateQueue : [];

  if (canUseStorage()) {
    Object.entries(drafts).forEach(([draftId, value]) => writeEntryDraft(draftId, value));
    writeSavedEntrySearches(savedSearches as SavedEntrySearch[]);
    writeOfflineCreateQueue(queue as OfflineCreateQueueItem[]);
  }

  return {
    restoredDrafts: Object.keys(drafts).length,
    restoredSearches: savedSearches.length,
    restoredQueue: queue.length,
  };
};

export const entryMatchesSavedSearch = (entry: Entry, search: SavedEntrySearch): boolean => {
  const q = search.query.trim().toLowerCase();
  const text = [
    entry.sections.shared,
    entry.sections.private ?? '',
    ...(entry.sessionMetrics.tags ?? []),
    ...(entry.rawTechniqueMentions ?? []),
    ...(entry.mediaAttachments ?? []).flatMap((attachment) => [
      attachment.title,
      attachment.url,
      attachment.notes ?? '',
      ...attachment.clipNotes.map((clip) => `${clip.label} ${clip.note}`),
    ]),
  ]
    .join(' ')
    .toLowerCase();

  if (q && !text.includes(q)) return false;
  if (search.tag && !(entry.sessionMetrics.tags ?? []).includes(search.tag)) return false;
  if (search.giOrNoGi && entry.sessionMetrics.giOrNoGi !== search.giOrNoGi) return false;

  const min = Number(search.minIntensity);
  if (search.minIntensity !== '' && Number.isFinite(min) && entry.sessionMetrics.intensity < min) return false;
  const max = Number(search.maxIntensity);
  if (search.maxIntensity !== '' && Number.isFinite(max) && entry.sessionMetrics.intensity > max) return false;

  return true;
};

export const applyEntryTemplate = (templateId: EntryTemplateId): Partial<EntryCreatePayload> => {
  switch (templateId) {
    case 'quick-roll':
      return {
        sections: { shared: 'What happened in one round?', private: '' },
        sessionMetrics: { durationMinutes: 30, intensity: 7, rounds: 4, giOrNoGi: 'no-gi', tags: ['live'] },
        rawTechniqueMentions: [],
      };
    case 'comp-class':
      return {
        sections: { shared: 'Competition class focus + outcomes', private: '' },
        sessionMetrics: { durationMinutes: 75, intensity: 8, rounds: 6, giOrNoGi: 'gi', tags: ['competition'] },
        rawTechniqueMentions: [],
      };
    case 'drill-day':
      return {
        sections: { shared: 'Drilling focus and reps', private: '' },
        sessionMetrics: { durationMinutes: 60, intensity: 4, rounds: 0, giOrNoGi: 'gi', tags: ['drilling'] },
        rawTechniqueMentions: [],
      };
    case 'open-mat':
      return {
        sections: { shared: 'Open mat experiments and constraints', private: '' },
        sessionMetrics: { durationMinutes: 90, intensity: 6, rounds: 8, giOrNoGi: 'no-gi', tags: ['open-mat'] },
        rawTechniqueMentions: [],
      };
    default:
      return {};
  }
};
