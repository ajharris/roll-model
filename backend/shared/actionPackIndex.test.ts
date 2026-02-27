import {
  buildActionPackDeleteKeys,
  buildActionPackIndexItems,
  queryActionPackAthleteEntries,
  queryActionPackGlobalMatches
} from './actionPackIndex';
import { getItem, queryItems } from './db';
import type { Entry } from './types';

jest.mock('./db');

const mockGetItem = jest.mocked(getItem);
const mockQueryItems = jest.mocked(queryItems);

const sampleEntry: Entry = {
  entryId: 'entry-1',
  athleteId: 'athlete-1',
  schemaVersion: 2,
  createdAt: '2026-02-26T00:00:00.000Z',
  updatedAt: '2026-02-26T00:00:00.000Z',
  sections: { shared: 'shared', private: 'private' },
  sessionMetrics: {
    durationMinutes: 60,
    intensity: 6,
    rounds: 5,
    giOrNoGi: 'gi',
    tags: ['class-notes'],
  },
  rawTechniqueMentions: [],
  actionPackFinal: {
    actionPack: {
      wins: ['Recovered guard and framed early'],
      leaks: ['Late underhook response'],
      oneFocus: 'Pummel first on half-guard underhook battles',
      drills: ['Underhook pummel x20'],
      positionalRequests: ['Start in half guard bottom'],
      fallbackDecisionGuidance: 'If flattened, recover knee shield then hip escape.',
      confidenceFlags: [
        { field: 'wins', confidence: 'high' },
        { field: 'leaks', confidence: 'low' },
      ],
    },
    finalizedAt: '2026-02-26T00:05:00.000Z',
  },
};

describe('actionPackIndex', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockQueryItems.mockReset();
  });

  it('builds athlete and global index items for finalized action packs', () => {
    const items = buildActionPackIndexItems(sampleEntry);

    expect(items.length).toBeGreaterThan(0);
    expect(items.some((item) => item.PK === 'USER#athlete-1')).toBe(true);
    expect(items.some((item) => String(item.PK).startsWith('APF_GLOBAL#'))).toBe(true);
    expect(items.some((item) => item.entityType === 'ACTION_PACK_INDEX')).toBe(true);
  });

  it('derives delete keys from finalized action packs', () => {
    const keys = buildActionPackDeleteKeys(sampleEntry);

    expect(keys.length).toBeGreaterThan(0);
    expect(keys.some((key) => key.PK === 'USER#athlete-1')).toBe(true);
    expect(keys.some((key) => key.PK.startsWith('APF_GLOBAL#'))).toBe(true);
  });

  it('queries indexed entries by field/token with confidence filtering', async () => {
    mockQueryItems.mockResolvedValue({
      Items: [
        {
          PK: 'USER#athlete-1',
          SK: 'APF#leaks#underhook#TS#2026-02-26T00:00:00.000Z#ENTRY#entry-1',
          entityType: 'ACTION_PACK_INDEX',
          entryId: 'entry-1',
          createdAt: '2026-02-26T00:00:00.000Z',
          confidence: 'low',
        },
      ],
    } as never);

    mockGetItem.mockResolvedValueOnce({
      Item: {
        PK: 'USER#athlete-1',
        SK: 'ENTRY#2026-02-26T00:00:00.000Z#entry-1',
        entityType: 'ENTRY',
        ...sampleEntry,
      },
    } as never);

    const lowResults = await queryActionPackAthleteEntries({
      athleteId: 'athlete-1',
      field: 'leaks',
      token: 'underhook',
      minConfidence: 'low',
    });
    expect(lowResults).toHaveLength(1);

    const highResults = await queryActionPackAthleteEntries({
      athleteId: 'athlete-1',
      field: 'leaks',
      token: 'underhook',
      minConfidence: 'high',
    });
    expect(highResults).toHaveLength(0);
  });

  it('queries global matches for downstream recommendation jobs', async () => {
    mockQueryItems.mockResolvedValueOnce({
      Items: [
        {
          PK: 'APF_GLOBAL#drills#pummel',
          SK: 'TS#2026-02-26T00:00:00.000Z#USER#athlete-1#ENTRY#entry-1',
          entityType: 'ACTION_PACK_INDEX',
          athleteId: 'athlete-1',
          entryId: 'entry-1',
          createdAt: '2026-02-26T00:00:00.000Z',
          field: 'drills',
          token: 'pummel',
          confidence: 'high'
        }
      ]
    } as never);

    const results = await queryActionPackGlobalMatches({
      field: 'drills',
      token: 'pummel',
      minConfidence: 'medium'
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      athleteId: 'athlete-1',
      entryId: 'entry-1',
      field: 'drills',
      token: 'pummel'
    });
  });
});
