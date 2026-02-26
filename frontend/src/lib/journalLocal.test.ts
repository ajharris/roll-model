import { beforeEach, describe, expect, it } from 'vitest';

import { entryMatchesSavedSearch, readSavedEntrySearches, writeSavedEntrySearches } from './journalLocal';
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
        private: '',
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
