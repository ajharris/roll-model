import { beforeEach, describe, expect, it } from 'vitest';

import {
  enqueueOfflineCreate,
  enqueueOfflineUpdate,
  entryMatchesSavedSearch,
  getOfflineMutationQueueCounts,
  readOfflineMutationQueue,
  readSavedEntrySearches,
  writeSavedEntrySearches,
} from './journalLocal';

import type { Entry, SavedEntrySearch } from '@/types/api';



describe('journalLocal saved searches', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('migrates legacy saved searches and defaults sort fields', () => {
    window.localStorage.setItem(
      'journal.savedSearches.v1',
      JSON.stringify([
        {
          id: 'legacy-1',
          name: 'Legacy',
          query: 'guard',
          tag: '',
          giOrNoGi: 'no-gi',
          minIntensity: '',
          maxIntensity: '8',
        },
      ]),
    );

    const searches = readSavedEntrySearches();

    expect(searches).toHaveLength(1);
    expect(searches[0]).toMatchObject({
      id: 'legacy-1',
      name: 'Legacy',
      sortBy: 'createdAt',
      sortDirection: 'desc',
    });
    expect('isPinned' in searches[0]).toBe(false);
    expect('isFavorite' in searches[0]).toBe(false);
  });

  it('persists and reads sort and future metadata fields', () => {
    const saved: SavedEntrySearch[] = [
      {
        id: 's1',
        name: 'High intensity',
        query: '',
        tag: 'competition',
        giOrNoGi: 'gi',
        minIntensity: '7',
        maxIntensity: '',
        dateFrom: '2026-02-01T00:00:00.000Z',
        dateTo: '2026-02-29T23:59:59.999Z',
        position: 'half guard',
        partner: 'alex',
        technique: 'knee cut',
        outcome: 'win',
        classType: 'competition class',
        sortBy: 'intensity',
        sortDirection: 'desc',
        isPinned: true,
        isFavorite: false,
      },
    ];

    writeSavedEntrySearches(saved);

    expect(readSavedEntrySearches()).toEqual(saved);
  });

  it('matches entries using text and filters regardless of saved sort fields', () => {
    const search: SavedEntrySearch = {
      id: 's1',
      name: 'Guard focus',
      query: 'guard',
      tag: 'open-mat',
      giOrNoGi: 'no-gi',
      minIntensity: '5',
      maxIntensity: '8',
      dateFrom: '2026-02-01T00:00:00.000Z',
      dateTo: '2026-02-28T23:59:59.999Z',
      position: 'guard',
      partner: 'sam',
      technique: 'knee shield',
      outcome: 'sweep',
      classType: 'open mat',
      sortBy: 'createdAt',
      sortDirection: 'asc',
    };

    const entry: Entry = {
      entryId: 'e1',
      athleteId: 'a1',
      createdAt: '2026-02-20T10:00:00.000Z',
      updatedAt: '2026-02-20T10:00:00.000Z',
      schemaVersion: 2,
      sections: {
        shared: 'Worked guard retention and knee shield entries',
        private: 'Open mat with partner Sam. Sweep outcome landed twice.',
      },
      sessionMetrics: {
        durationMinutes: 60,
        intensity: 7,
        rounds: 5,
        giOrNoGi: 'no-gi',
        tags: ['open-mat', 'guard'],
      },
      rawTechniqueMentions: ['knee shield'],
      mediaAttachments: [],
    };

    expect(entryMatchesSavedSearch(entry, search)).toBe(true);
  });
});

describe('journalLocal offline queue', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('migrates legacy create queue entries into the unified mutation queue', () => {
    window.localStorage.setItem(
      'journal.offlineCreateQueue.v1',
      JSON.stringify([
        {
          queueId: 'legacy-1',
          createdAt: '2026-02-27T00:00:00.000Z',
          payload: {
            sections: { shared: 's', private: 'p' },
            sessionMetrics: {
              durationMinutes: 60,
              intensity: 6,
              rounds: 5,
              giOrNoGi: 'gi',
              tags: [],
            },
            rawTechniqueMentions: [],
            mediaAttachments: [],
          },
        },
      ]),
    );

    const queue = readOfflineMutationQueue();

    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      queueId: 'legacy-1',
      mutationType: 'create',
      status: 'pending',
      attemptCount: 0,
    });
  });

  it('collapses multiple queued updates for the same entry to the latest payload', () => {
    enqueueOfflineUpdate(
      'entry-1',
      {
        sections: { shared: 'v1', private: '' },
        sessionMetrics: { durationMinutes: 60, intensity: 6, rounds: 5, giOrNoGi: 'gi', tags: [] },
        rawTechniqueMentions: [],
        mediaAttachments: [],
      },
      '2026-02-26T10:00:00.000Z',
    );
    enqueueOfflineUpdate(
      'entry-1',
      {
        sections: { shared: 'v2', private: '' },
        sessionMetrics: { durationMinutes: 90, intensity: 7, rounds: 6, giOrNoGi: 'no-gi', tags: ['open-mat'] },
        rawTechniqueMentions: ['knee cut'],
        mediaAttachments: [],
      },
      '2026-02-26T10:00:00.000Z',
    );

    const queue = readOfflineMutationQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      mutationType: 'update',
      entryId: 'entry-1',
      payload: expect.objectContaining({
        sections: { shared: 'v2', private: '' },
      }),
    });
  });

  it('returns pending and failed counts for sync status UI', () => {
    enqueueOfflineCreate({
      sections: { shared: 'queued create', private: '' },
      sessionMetrics: { durationMinutes: 45, intensity: 5, rounds: 4, giOrNoGi: 'gi', tags: [] },
      rawTechniqueMentions: [],
      mediaAttachments: [],
    });

    window.localStorage.setItem(
      'journal.offlineMutationQueue.v1',
      JSON.stringify([
        ...readOfflineMutationQueue(),
        {
          queueId: 'failed-1',
          mutationType: 'update',
          createdAt: '2026-02-27T00:00:00.000Z',
          updatedAt: '2026-02-27T00:00:00.000Z',
          status: 'failed',
          attemptCount: 1,
          entryId: 'entry-2',
          payload: {
            sections: { shared: 'failed update', private: '' },
            sessionMetrics: { durationMinutes: 60, intensity: 6, rounds: 5, giOrNoGi: 'gi', tags: [] },
            rawTechniqueMentions: [],
            mediaAttachments: [],
          },
          failureReason: 'conflict',
          errorMessage: 'conflict',
        },
      ]),
    );

    expect(getOfflineMutationQueueCounts()).toEqual({
      pending: 1,
      failed: 1,
      total: 2,
    });
  });
});
