'use client';

import type { Entry, EntryCreatePayload, EntryTemplateId, SavedEntrySearch } from '@/types/api';

export interface OfflineCreateQueueItem {
  queueId: string;
  createdAt: string;
  payload: EntryCreatePayload;
}

export type OfflineMutationFailureReason =
  | 'network'
  | 'conflict'
  | 'not-found'
  | 'validation'
  | 'unauthorized'
  | 'unknown';

export type OfflineMutationStatus = 'pending' | 'failed';

interface OfflineMutationQueueBase {
  queueId: string;
  createdAt: string;
  updatedAt: string;
  status: OfflineMutationStatus;
  attemptCount: number;
  lastAttemptAt?: string;
  failureReason?: OfflineMutationFailureReason;
  errorMessage?: string;
}

export interface OfflineCreateMutationQueueItem extends OfflineMutationQueueBase {
  mutationType: 'create';
  payload: EntryCreatePayload;
}

export interface OfflineUpdateMutationQueueItem extends OfflineMutationQueueBase {
  mutationType: 'update';
  entryId: string;
  payload: EntryCreatePayload;
  baseUpdatedAt?: string;
}

export type OfflineMutationQueueItem = OfflineCreateMutationQueueItem | OfflineUpdateMutationQueueItem;

type LocalBackup = {
  savedAt: string;
  drafts: Record<string, unknown>;
  savedSearches: SavedEntrySearch[];
  offlineMutationQueue: OfflineMutationQueueItem[];
};

const ENTRY_DRAFT_PREFIX = 'journal.entryDraft.';
const SAVED_SEARCHES_KEY = 'journal.savedSearches.v2';
const SAVED_SEARCHES_LEGACY_KEY = 'journal.savedSearches.v1';
const OFFLINE_MUTATION_QUEUE_KEY = 'journal.offlineMutationQueue.v1';
const OFFLINE_CREATE_QUEUE_LEGACY_KEY = 'journal.offlineCreateQueue.v1';

const canUseStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const randomId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `queue-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

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

const normalizeOfflineMutationQueueItem = (value: unknown): OfflineMutationQueueItem | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const queueId = typeof candidate.queueId === 'string' && candidate.queueId.trim() ? candidate.queueId : '';
  const createdAt = typeof candidate.createdAt === 'string' && candidate.createdAt.trim() ? candidate.createdAt : '';

  if (!queueId || !createdAt) return null;

  const status: OfflineMutationStatus = candidate.status === 'failed' ? 'failed' : 'pending';
  const updatedAt =
    typeof candidate.updatedAt === 'string' && candidate.updatedAt.trim() ? candidate.updatedAt : createdAt;
  const attemptCount = typeof candidate.attemptCount === 'number' && Number.isFinite(candidate.attemptCount)
    ? candidate.attemptCount
    : 0;
  const lastAttemptAt =
    typeof candidate.lastAttemptAt === 'string' && candidate.lastAttemptAt.trim() ? candidate.lastAttemptAt : undefined;
  const failureReason =
    candidate.failureReason === 'network' ||
    candidate.failureReason === 'conflict' ||
    candidate.failureReason === 'not-found' ||
    candidate.failureReason === 'validation' ||
    candidate.failureReason === 'unauthorized' ||
    candidate.failureReason === 'unknown'
      ? candidate.failureReason
      : undefined;
  const errorMessage =
    typeof candidate.errorMessage === 'string' && candidate.errorMessage.trim() ? candidate.errorMessage : undefined;

  if (candidate.mutationType === 'update') {
    const entryId = typeof candidate.entryId === 'string' && candidate.entryId.trim() ? candidate.entryId : '';
    const payload = candidate.payload as EntryCreatePayload;
    if (!entryId || !payload || typeof payload !== 'object') return null;

    return {
      mutationType: 'update',
      queueId,
      createdAt,
      updatedAt,
      status,
      attemptCount,
      payload,
      entryId,
      ...(typeof candidate.baseUpdatedAt === 'string' && candidate.baseUpdatedAt.trim()
        ? { baseUpdatedAt: candidate.baseUpdatedAt }
        : {}),
      ...(lastAttemptAt ? { lastAttemptAt } : {}),
      ...(failureReason ? { failureReason } : {}),
      ...(errorMessage ? { errorMessage } : {}),
    };
  }

  const payload = candidate.payload as EntryCreatePayload;
  if (!payload || typeof payload !== 'object') return null;

  return {
    mutationType: 'create',
    queueId,
    createdAt,
    updatedAt,
    status,
    attemptCount,
    payload,
    ...(lastAttemptAt ? { lastAttemptAt } : {}),
    ...(failureReason ? { failureReason } : {}),
    ...(errorMessage ? { errorMessage } : {}),
  };
};

const normalizeOfflineMutationQueue = (value: unknown): OfflineMutationQueueItem[] => {
  if (!Array.isArray(value)) return [];

  const deduped = new Map<string, OfflineMutationQueueItem>();
  value.forEach((item) => {
    const normalized = normalizeOfflineMutationQueueItem(item);
    if (!normalized) return;
    deduped.set(normalized.queueId, normalized);
  });

  return [...deduped.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
};

const migrateLegacyOfflineCreateQueue = (): OfflineMutationQueueItem[] => {
  const legacy = readJson<OfflineCreateQueueItem[]>(OFFLINE_CREATE_QUEUE_LEGACY_KEY, []);
  if (!Array.isArray(legacy) || legacy.length === 0) return [];

  return legacy
    .filter((item) => item && typeof item === 'object' && typeof item.queueId === 'string' && item.payload)
    .map((item) => ({
      mutationType: 'create' as const,
      queueId: item.queueId,
      createdAt: item.createdAt,
      updatedAt: item.createdAt,
      status: 'pending' as const,
      attemptCount: 0,
      payload: item.payload,
    }));
};

const readOfflineMutationQueueRaw = (): OfflineMutationQueueItem[] => {
  const normalized = normalizeOfflineMutationQueue(readJson<unknown[]>(OFFLINE_MUTATION_QUEUE_KEY, []));
  if (normalized.length > 0) return normalized;

  const migrated = migrateLegacyOfflineCreateQueue();
  if (migrated.length === 0) return [];

  writeJson(OFFLINE_MUTATION_QUEUE_KEY, migrated);
  return migrated;
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

export const readOfflineMutationQueue = (): OfflineMutationQueueItem[] => readOfflineMutationQueueRaw();

export const writeOfflineMutationQueue = (items: OfflineMutationQueueItem[]) => {
  writeJson(OFFLINE_MUTATION_QUEUE_KEY, normalizeOfflineMutationQueue(items));
};

export const updateOfflineMutationQueueItem = (
  queueId: string,
  updater: (item: OfflineMutationQueueItem) => OfflineMutationQueueItem | null,
): OfflineMutationQueueItem[] => {
  const queue = readOfflineMutationQueueRaw();
  const next = queue
    .map((item) => {
      if (item.queueId !== queueId) return item;
      return updater(item);
    })
    .filter((item): item is OfflineMutationQueueItem => item !== null);
  writeOfflineMutationQueue(next);
  return next;
};

export const removeOfflineMutationQueueItem = (queueId: string): OfflineMutationQueueItem[] => {
  const queue = readOfflineMutationQueueRaw().filter((item) => item.queueId !== queueId);
  writeOfflineMutationQueue(queue);
  return queue;
};

export const enqueueOfflineCreate = (payload: EntryCreatePayload): OfflineCreateMutationQueueItem => {
  const now = new Date().toISOString();
  const next: OfflineCreateMutationQueueItem = {
    mutationType: 'create',
    queueId: randomId(),
    createdAt: now,
    updatedAt: now,
    status: 'pending',
    attemptCount: 0,
    payload,
  };
  writeOfflineMutationQueue([...readOfflineMutationQueueRaw(), next]);
  return next;
};

export const enqueueOfflineUpdate = (
  entryId: string,
  payload: EntryCreatePayload,
  baseUpdatedAt?: string,
): OfflineUpdateMutationQueueItem => {
  const now = new Date().toISOString();
  const queue = readOfflineMutationQueueRaw();

  // Collapse multiple queued updates for the same entry into the latest draft.
  const existing = queue.find(
    (item): item is OfflineUpdateMutationQueueItem => item.mutationType === 'update' && item.entryId === entryId,
  );

  if (existing) {
    const updated: OfflineUpdateMutationQueueItem = {
      ...existing,
      payload,
      updatedAt: now,
      status: 'pending',
      attemptCount: existing.attemptCount,
      ...(baseUpdatedAt ? { baseUpdatedAt } : {}),
      failureReason: undefined,
      errorMessage: undefined,
    };
    writeOfflineMutationQueue(queue.map((item) => (item.queueId === existing.queueId ? updated : item)));
    return updated;
  }

  const next: OfflineUpdateMutationQueueItem = {
    mutationType: 'update',
    queueId: randomId(),
    createdAt: now,
    updatedAt: now,
    status: 'pending',
    attemptCount: 0,
    entryId,
    payload,
    ...(baseUpdatedAt ? { baseUpdatedAt } : {}),
  };

  writeOfflineMutationQueue([...queue, next]);
  return next;
};

export const readOfflineCreateQueue = (): OfflineCreateQueueItem[] =>
  readOfflineMutationQueueRaw()
    .filter((item): item is OfflineCreateMutationQueueItem => item.mutationType === 'create')
    .map((item) => ({
      queueId: item.queueId,
      createdAt: item.createdAt,
      payload: item.payload,
    }));

export const writeOfflineCreateQueue = (items: OfflineCreateQueueItem[]) => {
  const normalizedCreates: OfflineCreateMutationQueueItem[] = items.map((item) => ({
    mutationType: 'create',
    queueId: item.queueId,
    createdAt: item.createdAt,
    updatedAt: item.createdAt,
    status: 'pending',
    attemptCount: 0,
    payload: item.payload,
  }));

  const nonCreate = readOfflineMutationQueueRaw().filter((item) => item.mutationType !== 'create');
  writeOfflineMutationQueue([...nonCreate, ...normalizedCreates]);
};

export const getOfflineMutationQueueCounts = (): { pending: number; failed: number; total: number } => {
  const queue = readOfflineMutationQueueRaw();
  const pending = queue.filter((item) => item.status === 'pending').length;
  const failed = queue.filter((item) => item.status === 'failed').length;
  return {
    pending,
    failed,
    total: queue.length,
  };
};

export const buildLocalJournalBackup = (): LocalBackup => {
  const drafts = Object.fromEntries(
    listEntryDraftKeys().map((key) => [key.replace(ENTRY_DRAFT_PREFIX, ''), readJson(key, null)]),
  );
  return {
    savedAt: new Date().toISOString(),
    drafts,
    savedSearches: readSavedEntrySearches(),
    offlineMutationQueue: readOfflineMutationQueueRaw(),
  };
};

export const restoreLocalJournalBackup = (
  payload: unknown,
): { restoredDrafts: number; restoredSearches: number; restoredQueue: number } => {
  const candidate = (payload ?? {}) as Partial<LocalBackup & { offlineCreateQueue: OfflineCreateQueueItem[] }>;
  const drafts = candidate.drafts && typeof candidate.drafts === 'object' ? candidate.drafts : {};
  const savedSearches = Array.isArray(candidate.savedSearches) ? candidate.savedSearches : [];
  const mutationQueue = Array.isArray(candidate.offlineMutationQueue)
    ? normalizeOfflineMutationQueue(candidate.offlineMutationQueue)
    : [];

  const legacyCreateQueue = Array.isArray(candidate.offlineCreateQueue)
    ? candidate.offlineCreateQueue.map<OfflineCreateMutationQueueItem>((item) => ({
        mutationType: 'create',
        queueId: item.queueId,
        createdAt: item.createdAt,
        updatedAt: item.createdAt,
        status: 'pending',
        attemptCount: 0,
        payload: item.payload,
      }))
    : [];

  const mergedQueue = normalizeOfflineMutationQueue([...mutationQueue, ...legacyCreateQueue]);

  if (canUseStorage()) {
    Object.entries(drafts).forEach(([draftId, value]) => writeEntryDraft(draftId, value));
    writeSavedEntrySearches(normalizeSavedEntrySearches(savedSearches));
    writeOfflineMutationQueue(mergedQueue);
  }

  return {
    restoredDrafts: Object.keys(drafts).length,
    restoredSearches: savedSearches.length,
    restoredQueue: mergedQueue.length,
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
      ...attachment.clipNotes.map((clip) => `${clip.timestamp} ${clip.text}`),
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
