import { buildKeywordIndexItems, extractEntryTokens } from './keywords';
import type { Entry } from './types';

describe('keyword tokenization', () => {
  it('produces normalized tokens and removes stopwords/punctuation', () => {
    const entry: Entry = {
      entryId: 'entry-1',
      athleteId: 'athlete-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      sections: {
        private: 'The butterfly sweeps felt sharp!',
        shared: 'Worked on passing and pressure from headquarters.'
      },
      sessionMetrics: {
        durationMinutes: 75,
        intensity: 8,
        rounds: 6,
        giOrNoGi: 'gi',
        tags: ['Guard Retention', 'Pressure-Passing']
      },
      rawTechniqueMentions: ['Knee Slice', 'Arm Bar']
    };

    const tokens = extractEntryTokens(entry, { includePrivate: true, maxTokens: 30 });

    expect(tokens).toEqual(
      expect.arrayContaining([
        'guard-retention',
        'pressure-passing',
        'knee-slice',
        'arm-bar',
        'worked',
        'passing',
        'pressure',
        'headquarters',
        'butterfly',
        'sweeps',
        'felt',
        'sharp'
      ])
    );
    expect(tokens).not.toEqual(expect.arrayContaining(['the', 'and', 'from']));
  });

  it('builds keyword index items with expected PK/SK', () => {
    const items = buildKeywordIndexItems('athlete-1', 'entry-1', '2026-01-01T00:00:00.000Z', ['guard']);

    expect(items).toEqual([
      {
        PK: 'USER#athlete-1',
        SK: 'KW#guard#TS#2026-01-01T00:00:00.000Z#ENTRY#entry-1',
        entityType: 'KEYWORD_INDEX',
        visibilityScope: 'shared',
        entryId: 'entry-1',
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ]);
  });

  it('builds private keyword index items with private PK prefix', () => {
    const items = buildKeywordIndexItems('athlete-1', 'entry-1', '2026-01-01T00:00:00.000Z', ['hook'], {
      visibilityScope: 'private'
    });

    expect(items).toEqual([
      {
        PK: 'USER_PRIVATE#athlete-1',
        SK: 'KW#hook#TS#2026-01-01T00:00:00.000Z#ENTRY#entry-1',
        entityType: 'KEYWORD_INDEX',
        visibilityScope: 'private',
        entryId: 'entry-1',
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ]);
  });
});
