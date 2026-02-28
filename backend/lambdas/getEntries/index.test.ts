import type { GetCommandOutput, QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { queryActionPackAthleteEntries } from '../../shared/actionPackIndex';
import { getItem, queryItems } from '../../shared/db';

import { handler } from './index';

jest.mock('../../shared/db');
jest.mock('../../shared/actionPackIndex');

const mockGetItem = jest.mocked(getItem);
const mockQueryItems = jest.mocked(queryItems);
const mockQueryActionPackAthleteEntries = jest.mocked(queryActionPackAthleteEntries);

const buildEvent = (
  role: 'athlete' | 'coach',
  athleteId?: string,
  claimsOverride?: Record<string, string>,
  queryStringParameters?: Record<string, string>,
): APIGatewayProxyEvent =>
  ({
    pathParameters: athleteId ? { athleteId } : undefined,
    queryStringParameters,
    requestContext: {
      authorizer: {
        claims: {
          sub: role === 'athlete' ? 'athlete-1' : 'coach-1',
          'custom:role': role,
          ...claimsOverride,
        }
      }
    }
  }) as unknown as APIGatewayProxyEvent;

describe('getEntries handler auth', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockQueryItems.mockReset();
    mockQueryActionPackAthleteEntries.mockReset();
  });

  it('returns shared-only sections for coach', async () => {
    mockGetItem.mockResolvedValueOnce({
      Item: { PK: 'USER#athlete-1', SK: 'COACH#coach-1' }
    } as unknown as GetCommandOutput);
    mockQueryItems.mockResolvedValueOnce({
      Items: [
        {
          PK: 'USER#athlete-1',
          SK: 'ENTRY#2024-01-01',
          entityType: 'ENTRY',
          entryId: 'entry-1',
          athleteId: 'athlete-1',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          quickAdd: {
            time: '2024-01-01T18:00:00.000Z',
            class: 'Open mat',
            gym: 'North Academy',
            partners: ['Alex'],
            rounds: 6,
            notes: 'shared notes'
          },
          tags: ['guard-type'],
          sections: { shared: 'shared notes', private: 'private notes' },
          sessionMetrics: {
            durationMinutes: 60,
            intensity: 7,
            rounds: 6,
            giOrNoGi: 'gi',
            tags: ['guard']
          }
        }
      ]
    } as unknown as QueryCommandOutput);

    const result = (await handler(buildEvent('coach', 'athlete-1'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { entries: Array<{ sections: { shared: string } }> };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].sections).toEqual({ shared: 'shared notes' });
    expect(body.entries[0].sections).not.toHaveProperty('private');
  });

  it('uses athlete mode for users with both athlete and coach roles when athleteId is not requested', async () => {
    mockQueryItems.mockResolvedValueOnce({
      Items: [
        {
          PK: 'USER#athlete-1',
          SK: 'ENTRY#2024-01-01',
          entityType: 'ENTRY',
          entryId: 'entry-1',
          athleteId: 'athlete-1',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          quickAdd: {
            time: '2024-01-01T18:00:00.000Z',
            class: 'Open mat',
            gym: 'North Academy',
            partners: ['Alex'],
            rounds: 6,
            notes: 'shared notes'
          },
          tags: ['guard-type'],
          sections: { shared: 'shared notes', private: 'private notes' },
          sessionMetrics: {
            durationMinutes: 60,
            intensity: 7,
            rounds: 6,
            giOrNoGi: 'gi',
            tags: ['guard']
          }
        }
      ]
    } as unknown as QueryCommandOutput);

    const result = (await handler(
      buildEvent('coach', undefined, { sub: 'athlete-1', 'cognito:groups': 'athlete,coach' }),
      {} as never,
      () => undefined,
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    expect(mockGetItem).not.toHaveBeenCalled();
    const body = JSON.parse(result.body) as { entries: Array<{ sections: { shared: string; private?: string } }> };
    expect(body.entries[0].sections.private).toBe('private notes');
  });

  it('rejects coaches without a link', async () => {
    mockGetItem.mockResolvedValueOnce({} as unknown as GetCommandOutput);

    const result = (await handler(buildEvent('coach', 'athlete-1'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('rejects coaches with revoked links', async () => {
    mockGetItem.mockResolvedValueOnce({
      Item: { PK: 'USER#athlete-1', SK: 'COACH#coach-1', status: 'revoked' }
    } as unknown as GetCommandOutput);

    const result = (await handler(buildEvent('coach', 'athlete-1'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('applies combined text and journaling filters with relevance ranking', async () => {
    mockQueryItems.mockResolvedValueOnce({
      Items: [
        {
          PK: 'USER#athlete-1',
          SK: 'ENTRY#2026-02-24',
          entityType: 'ENTRY',
          entryId: 'entry-1',
          athleteId: 'athlete-1',
          createdAt: '2026-02-24T10:00:00.000Z',
          updatedAt: '2026-02-24T10:00:00.000Z',
          schemaVersion: 2,
          sections: {
            shared: 'Open mat with Alex. Knee shield guard retention from half guard worked. Won two rounds by sweep.',
            private: 'Partner Alex gave strong pressure. Class type open mat.',
          },
          sessionMetrics: {
            durationMinutes: 75,
            intensity: 7,
            rounds: 6,
            giOrNoGi: 'no-gi',
            tags: ['open-mat', 'guard'],
          },
          rawTechniqueMentions: ['knee shield', 'hip heist sweep'],
        },
        {
          PK: 'USER#athlete-1',
          SK: 'ENTRY#2026-02-23',
          entityType: 'ENTRY',
          entryId: 'entry-2',
          athleteId: 'athlete-1',
          createdAt: '2026-02-23T10:00:00.000Z',
          updatedAt: '2026-02-23T10:00:00.000Z',
          schemaVersion: 2,
          sections: {
            shared: 'Competition class with Alex. Guard passing rounds. Lost on points.',
            private: 'Outcome was rough but passing timing improved.',
          },
          sessionMetrics: {
            durationMinutes: 60,
            intensity: 8,
            rounds: 5,
            giOrNoGi: 'no-gi',
            tags: ['competition', 'passing'],
          },
          rawTechniqueMentions: ['knee slice'],
        },
        {
          PK: 'USER#athlete-1',
          SK: 'ENTRY#2026-02-22',
          entityType: 'ENTRY',
          entryId: 'entry-3',
          athleteId: 'athlete-1',
          createdAt: '2026-02-22T10:00:00.000Z',
          updatedAt: '2026-02-22T10:00:00.000Z',
          schemaVersion: 2,
          sections: {
            shared: 'Open mat with Alex. Knee shield guard retention and knee shield guard drills from half guard.',
            private: 'Won by sweep, then another sweep. Outcome win.',
          },
          sessionMetrics: {
            durationMinutes: 80,
            intensity: 7,
            rounds: 7,
            giOrNoGi: 'no-gi',
            tags: ['open-mat', 'guard'],
          },
          rawTechniqueMentions: ['knee shield', 'knee shield', 'sit-up sweep'],
        },
      ]
    } as unknown as QueryCommandOutput);

    const result = (await handler(
      buildEvent('athlete', undefined, undefined, {
        q: 'knee shield guard',
        dateFrom: '2026-02-22T00:00:00.000Z',
        dateTo: '2026-02-25T00:00:00.000Z',
        partner: 'alex',
        technique: 'knee shield',
        outcome: 'sweep',
        classType: 'open mat',
        giOrNoGi: 'no-gi',
        minIntensity: '6',
        maxIntensity: '8',
        sortBy: 'createdAt',
        sortDirection: 'desc',
      }),
      {} as never,
      () => undefined,
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as {
      entries: Array<{ entryId: string }>;
      search: { queryApplied: boolean; scannedCount: number; matchedCount: number; latencyMs: number; latencyTargetMs: number };
    };

    expect(body.entries.map((entry) => entry.entryId)).toEqual(['entry-3', 'entry-1']);
    expect(body.search.queryApplied).toBe(true);
    expect(body.search.scannedCount).toBe(3);
    expect(body.search.matchedCount).toBe(2);
    expect(body.search.latencyTargetMs).toBeGreaterThan(0);
    expect(body.search.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns search latency metadata within the defined target for a realistic in-memory dataset', async () => {
    const now = '2026-02-26T12:00:00.000Z';
    mockQueryItems.mockResolvedValueOnce({
      Items: Array.from({ length: 1000 }, (_, index) => ({
        PK: 'USER#athlete-1',
        SK: `ENTRY#${index.toString().padStart(4, '0')}`,
        entityType: 'ENTRY',
        entryId: `entry-${index}`,
        athleteId: 'athlete-1',
        createdAt: now,
        updatedAt: now,
        schemaVersion: 2,
        sections: {
          shared:
            index % 10 === 0
              ? `Open mat with partner ${index}. Knee shield guard retention win by sweep.`
              : `General notes ${index} on passing and escapes.`,
          private: `Private note ${index}`,
        },
        sessionMetrics: {
          durationMinutes: 60,
          intensity: (index % 10) + 1,
          rounds: 5,
          giOrNoGi: index % 2 === 0 ? 'gi' : 'no-gi',
          tags: index % 10 === 0 ? ['open-mat', 'guard'] : ['class'],
        },
        rawTechniqueMentions: index % 10 === 0 ? ['knee shield'] : ['knee slice'],
      })),
    } as unknown as QueryCommandOutput);

    const result = (await handler(
      buildEvent('athlete', undefined, undefined, {
        q: 'knee shield guard',
        partner: 'partner',
        outcome: 'win',
        classType: 'open mat',
      }),
      {} as never,
      () => undefined,
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as {
      search: { latencyMs: number; latencyTargetMs: number; scannedCount: number; matchedCount: number };
      entries: Array<{ entryId: string }>;
    };

    expect(body.search.scannedCount).toBe(1000);
    expect(body.search.matchedCount).toBe(100);
    expect(body.entries.length).toBe(100);
    expect(body.search.latencyTargetMs).toBe(75);
    expect(body.search.latencyMs).toBeLessThan(500);
  });

  it('supports indexed action-pack retrieval for athlete queries', async () => {
    mockQueryActionPackAthleteEntries.mockResolvedValueOnce([
      {
        entryId: 'entry-ap-1',
        athleteId: 'athlete-1',
        createdAt: '2026-02-25T10:00:00.000Z',
        updatedAt: '2026-02-25T10:00:00.000Z',
        schemaVersion: 2,
        sections: { shared: 'shared', private: 'private' },
        sessionMetrics: {
          durationMinutes: 60,
          intensity: 7,
          rounds: 5,
          giOrNoGi: 'gi',
          tags: ['class-notes']
        },
        rawTechniqueMentions: [],
        actionPackFinal: {
          actionPack: {
            wins: ['Recovered guard'],
            leaks: ['Late underhook'],
            oneFocus: 'Pummel first',
            drills: ['Pummel x20'],
            positionalRequests: ['Half guard bottom'],
            fallbackDecisionGuidance: 'Recover knee shield.',
            confidenceFlags: [{ field: 'leaks', confidence: 'low' }]
          },
          finalizedAt: '2026-02-25T10:05:00.000Z'
        }
      }
    ] as never);

    const result = (await handler(
      buildEvent('athlete', undefined, undefined, {
        actionPackField: 'leaks',
        actionPackToken: 'underhook',
        actionPackMinConfidence: 'low'
      }),
      {} as never,
      () => undefined,
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    expect(mockQueryActionPackAthleteEntries).toHaveBeenCalledWith(
      expect.objectContaining({
        athleteId: 'athlete-1',
        field: 'leaks',
        token: 'underhook',
        minConfidence: 'low'
      })
    );
    const body = JSON.parse(result.body) as { entries: Array<{ entryId: string }> };
    expect(body.entries.map((entry) => entry.entryId)).toEqual(['entry-ap-1']);
    expect(mockQueryItems).not.toHaveBeenCalled();
  });

  it('returns 400 when action-pack query params are incomplete', async () => {
    const result = (await handler(
      buildEvent('athlete', undefined, undefined, {
        actionPackField: 'leaks'
      }),
      {} as never,
      () => undefined,
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(400);
    expect(mockQueryActionPackAthleteEntries).not.toHaveBeenCalled();
  });

  it('returns recent one-thing cues when requested', async () => {
    mockQueryItems.mockResolvedValueOnce({
      Items: [
        {
          PK: 'USER#athlete-1',
          SK: 'ENTRY#2026-02-26',
          entityType: 'ENTRY',
          entryId: 'entry-1',
          athleteId: 'athlete-1',
          createdAt: '2026-02-26T00:00:00.000Z',
          updatedAt: '2026-02-26T00:00:00.000Z',
          sections: { shared: 'shared', private: 'private' },
          sessionMetrics: { durationMinutes: 60, intensity: 6, rounds: 5, giOrNoGi: 'gi', tags: [] },
          rawTechniqueMentions: [],
          sessionReviewFinal: {
            review: {
              promptSet: { whatWorked: [], whatFailed: [], whatToAskCoach: [], whatToDrillSolo: [] },
              oneThing: 'Pummel first.',
              confidenceFlags: [],
            },
            finalizedAt: '2026-02-26T01:00:00.000Z',
          },
        },
      ],
    } as unknown as QueryCommandOutput);

    const result = (await handler(
      buildEvent('athlete', undefined, undefined, { recentOneThingLimit: '3' }),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { recentOneThingCues: Array<{ cue: string }> };
    expect(body.recentOneThingCues).toEqual([{ entryId: 'entry-1', createdAt: '2026-02-26T00:00:00.000Z', cue: 'Pummel first' }]);
  });

  it('rejects invalid recent one-thing limit', async () => {
    const result = (await handler(
      buildEvent('athlete', undefined, undefined, { recentOneThingLimit: '0' }),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(400);
  });
});
