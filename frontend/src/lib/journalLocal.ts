'use client';

import type { Entry, EntryCreatePayload, EntryTemplateId, SavedEntrySearch } from '@/types/api';

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
const SAVED_SEARCHES_KEY = 'journal.savedSearches.v2';
const SAVED_SEARCHES_LEGACY_KEY = 'journal.savedSearches.v1';
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
  normalizeSavedEntrySearches([
    ...readJson<unknown[]>(SAVED_SEARCHES_KEY, []),
    ...readJson<unknown[]>(SAVED_SEARCHES_LEGACY_KEY, []),
  ]);

export const writeSavedEntrySearches = (searches: SavedEntrySearch[]) => {
  writeJson(SAVED_SEARCHES_KEY, normalizeSavedEntrySearches(searches));
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
    writeSavedEntrySearches(normalizeSavedEntrySearches(savedSearches));
    writeOfflineCreateQueue(queue as OfflineCreateQueueItem[]);
  }

  return {
    restoredDrafts: Object.keys(drafts).length,
    restoredSearches: savedSearches.length,
    restoredQueue: queue.length,
  };
};

const normalizeSavedEntrySearch = (value: unknown): SavedEntrySearch | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : '';
  const name = typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim() : '';
  if (!id || !name) return null;

  const giOrNoGi = candidate.giOrNoGi === 'gi' || candidate.giOrNoGi === 'no-gi' ? candidate.giOrNoGi : '';
  const sortBy = candidate.sortBy === 'intensity' ? 'intensity' : 'createdAt';
  const sortDirection = candidate.sortDirection === 'asc' ? 'asc' : 'desc';

  return {
    id,
    name,
    query: typeof candidate.query === 'string' ? candidate.query : '',
    tag: typeof candidate.tag === 'string' ? candidate.tag : '',
    giOrNoGi,
    minIntensity: typeof candidate.minIntensity === 'string' ? candidate.minIntensity : '',
    maxIntensity: typeof candidate.maxIntensity === 'string' ? candidate.maxIntensity : '',
    ...(typeof candidate.dateFrom === 'string' && candidate.dateFrom.trim()
      ? { dateFrom: candidate.dateFrom.trim() }
      : {}),
    ...(typeof candidate.dateTo === 'string' && candidate.dateTo.trim()
      ? { dateTo: candidate.dateTo.trim() }
      : {}),
    ...(typeof candidate.position === 'string' && candidate.position.trim()
      ? { position: candidate.position.trim() }
      : {}),
    ...(typeof candidate.partner === 'string' && candidate.partner.trim()
      ? { partner: candidate.partner.trim() }
      : {}),
    ...(typeof candidate.technique === 'string' && candidate.technique.trim()
      ? { technique: candidate.technique.trim() }
      : {}),
    ...(typeof candidate.outcome === 'string' && candidate.outcome.trim()
      ? { outcome: candidate.outcome.trim() }
      : {}),
    ...(typeof candidate.classType === 'string' && candidate.classType.trim()
      ? { classType: candidate.classType.trim() }
      : {}),
    sortBy,
    sortDirection,
    ...(typeof candidate.isPinned === 'boolean' ? { isPinned: candidate.isPinned } : {}),
    ...(typeof candidate.isFavorite === 'boolean' ? { isFavorite: candidate.isFavorite } : {}),
  };
};

const normalizeSavedEntrySearches = (value: unknown): SavedEntrySearch[] => {
  if (!Array.isArray(value)) return [];

  const seenIds = new Set<string>();
  const normalized: SavedEntrySearch[] = [];

  value.forEach((item) => {
    const search = normalizeSavedEntrySearch(item);
    if (!search || seenIds.has(search.id)) return;
    seenIds.add(search.id);
    normalized.push(search);
  });

  return normalized;
};

export const entryMatchesSavedSearch = (entry: Entry, search: SavedEntrySearch): boolean => {
  const entryTs = Date.parse(entry.createdAt);
  const fromTs = search.dateFrom ? Date.parse(search.dateFrom) : Number.NaN;
  const toTs = search.dateTo ? Date.parse(search.dateTo) : Number.NaN;
  const q = search.query.trim().toLowerCase();
  const text = [
    entry.createdAt,
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
  if (search.dateFrom && Number.isFinite(fromTs) && Number.isFinite(entryTs) && entryTs < fromTs) return false;
  if (search.dateTo && Number.isFinite(toTs) && Number.isFinite(entryTs)) {
    const inclusiveUpperBound = search.dateTo.length === 10 ? toTs + 86_399_999 : toTs;
    if (entryTs > inclusiveUpperBound) return false;
  }
  if (search.position && !text.includes(search.position.trim().toLowerCase())) return false;
  if (search.partner && !text.includes(search.partner.trim().toLowerCase())) return false;
  if (search.technique && !text.includes(search.technique.trim().toLowerCase())) return false;
  if (search.outcome && !text.includes(search.outcome.trim().toLowerCase())) return false;
  if (search.classType && !text.includes(search.classType.trim().toLowerCase())) return false;
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
    case 'class-notes':
      return {
        sections: { shared: 'Class notes: key wins, leaks, and one focus for next session.', private: '' },
        sessionMetrics: { durationMinutes: 60, intensity: 6, rounds: 4, giOrNoGi: 'gi', tags: ['class-notes'] },
        rawTechniqueMentions: [],
        templateId: 'class-notes',
      };
    case 'open-mat-rounds':
      return {
        sections: { shared: 'Open mat rounds: experiments, outcomes, and decision points.', private: '' },
        sessionMetrics: { durationMinutes: 75, intensity: 7, rounds: 7, giOrNoGi: 'no-gi', tags: ['open-mat'] },
        rawTechniqueMentions: [],
        templateId: 'open-mat-rounds',
      };
    case 'drill-session':
      return {
        sections: { shared: 'Drill session: reps completed, constraints, and transfer to live rounds.', private: '' },
        sessionMetrics: { durationMinutes: 50, intensity: 4, rounds: 0, giOrNoGi: 'gi', tags: ['drilling'] },
        rawTechniqueMentions: [],
        templateId: 'drill-session',
      };
    default:
      return {};
  }
};
