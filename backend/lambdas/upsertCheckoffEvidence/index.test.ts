import type { GetCommandOutput, QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { getItem, putItem, queryItems } from '../../shared/db';
import { recomputeAndPersistProgressViews } from '../../shared/progressStore';

import { handler } from './index';

jest.mock('../../shared/db');
jest.mock('../../shared/progressStore', () => ({
  recomputeAndPersistProgressViews: jest.fn()
}));

const mockGetItem = jest.mocked(getItem);
const mockPutItem = jest.mocked(putItem);
const mockQueryItems = jest.mocked(queryItems);
const mockRecomputeAndPersistProgressViews = jest.mocked(recomputeAndPersistProgressViews);

const buildEvent = (role: 'athlete' | 'coach', bodyOverride?: Record<string, unknown>): APIGatewayProxyEvent =>
  ({
    pathParameters: { entryId: 'entry-1' },
    body: JSON.stringify({
      evidence: [
        {
          skillId: 'knee-cut',
          evidenceType: 'hit-in-live-roll',
          statement: 'Hit knee cut in two rounds',
          confidence: 'medium',
          sourceOutcomeField: 'wins',
        },
      ],
      ...bodyOverride,
    }),
    requestContext: {
      authorizer: {
        claims: {
          sub: role === 'athlete' ? 'athlete-1' : 'coach-1',
          'custom:role': role,
        },
      },
    },
  }) as unknown as APIGatewayProxyEvent;

describe('upsertCheckoffEvidence handler', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockPutItem.mockReset();
    mockQueryItems.mockReset();
    mockRecomputeAndPersistProgressViews.mockReset();
    mockPutItem.mockResolvedValue();
    mockRecomputeAndPersistProgressViews.mockResolvedValue({
      athleteId: 'athlete-1',
      generatedAt: '2026-02-26T00:00:00.000Z',
      filters: { contextTags: [] },
      timeline: { events: [], cumulative: [] },
      positionHeatmap: { cells: [], maxTrainedCount: 0, neglectedThreshold: 0 },
      outcomeTrends: { points: [] },
      lowConfidenceFlags: [],
      coachAnnotations: [],
      sourceSummary: { sessionsConsidered: 0, structuredSessions: 0, checkoffsConsidered: 0 }
    });
  });

  it('creates evidence + checkoff records for athlete-owned entry', async () => {
    mockGetItem
      .mockResolvedValueOnce({
        Item: { PK: 'ENTRY#entry-1', SK: 'META', athleteId: 'athlete-1', createdAt: '2026-02-01T00:00:00.000Z' },
      } as unknown as GetCommandOutput)
      .mockResolvedValueOnce({} as unknown as GetCommandOutput);

    mockQueryItems.mockResolvedValueOnce({
      Items: [
        {
          entityType: 'CHECKOFF_EVIDENCE',
          mappingStatus: 'confirmed',
        },
      ],
    } as unknown as QueryCommandOutput);

    const result = (await handler(buildEvent('athlete'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    expect(mockPutItem).toHaveBeenCalled();
    const body = JSON.parse(result.body) as { pendingConfirmationCount: number };
    expect(body.pendingConfirmationCount).toBe(0);
  });

  it('rejects coach tokens', async () => {
    const result = (await handler(buildEvent('coach'), {} as never, () => undefined)) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(403);
    expect(mockPutItem).not.toHaveBeenCalled();
  });
});
