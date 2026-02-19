import { getItem, queryItems } from './db';
import { batchGetEntries, queryKeywordMatches, rankKeywordMatches } from './retrieval';

jest.mock('./db', () => ({
  getItem: jest.fn(),
  queryItems: jest.fn()
}));

describe('retrieval helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('queryKeywordMatches returns most recent matching entries', async () => {
    (queryItems as jest.Mock).mockResolvedValue({
      Items: [
        { entryId: 'entry-new', createdAt: '2026-01-03T00:00:00.000Z' },
        { entryId: 'entry-old', createdAt: '2026-01-01T00:00:00.000Z' }
      ]
    });

    const matches = await queryKeywordMatches('athlete-1', 'guard', 5);

    expect(queryItems).toHaveBeenCalledWith(
      expect.objectContaining({
        Limit: 5,
        ScanIndexForward: false
      })
    );
    expect(matches[0].entryId).toBe('entry-new');
  });

  it('batchGetEntries returns full entry objects from entry ids', async () => {
    (getItem as jest.Mock)
      .mockResolvedValueOnce({ Item: { athleteId: 'athlete-1', createdAt: '2026-01-01T00:00:00.000Z' } })
      .mockResolvedValueOnce({
        Item: {
          PK: 'USER#athlete-1',
          SK: 'ENTRY#2026-01-01T00:00:00.000Z#entry-1',
          entityType: 'ENTRY',
          entryId: 'entry-1',
          athleteId: 'athlete-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          sections: { private: 'p', shared: 's' },
          sessionMetrics: {
            durationMinutes: 60,
            intensity: 7,
            rounds: 5,
            giOrNoGi: 'gi',
            tags: []
          }
        }
      });

    const entries = await batchGetEntries(['entry-1']);
    expect(entries).toHaveLength(1);
    expect(entries[0].entryId).toBe('entry-1');
  });

  it('rankKeywordMatches ranks by match count then recency', () => {
    const ranked = rankKeywordMatches(
      [
        [
          { entryId: 'entry-old', createdAt: '2026-01-01T00:00:00.000Z' },
          { entryId: 'entry-new', createdAt: '2026-01-03T00:00:00.000Z' }
        ],
        [
          { entryId: 'entry-new', createdAt: '2026-01-03T00:00:00.000Z' },
          { entryId: 'entry-mid', createdAt: '2026-01-02T00:00:00.000Z' }
        ]
      ],
      3
    );

    expect(ranked).toEqual(['entry-new', 'entry-mid', 'entry-old']);
  });
});
