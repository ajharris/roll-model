import type { GetCommandOutput } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { batchWriteItems, deleteItem, getItem, putItem } from '../../shared/db';
import { buildKeywordIndexItems, extractEntryTokens } from '../../shared/keywords';
import { recomputeAndPersistProgressViews } from '../../shared/progressStore';

import { handler } from './index';

jest.mock('../../shared/db');
jest.mock('../../shared/keywords');
jest.mock('../../shared/progressStore', () => ({
  recomputeAndPersistProgressViews: jest.fn(),
}));

const mockGetItem = jest.mocked(getItem);
const mockPutItem = jest.mocked(putItem);
const mockDeleteItem = jest.mocked(deleteItem);
const mockBatchWriteItems = jest.mocked(batchWriteItems);
const mockExtractEntryTokens = jest.mocked(extractEntryTokens);
const mockBuildKeywordIndexItems = jest.mocked(buildKeywordIndexItems);
const mockRecomputeAndPersistProgressViews = jest.mocked(recomputeAndPersistProgressViews);

const buildEvent = (
  role: 'athlete' | 'coach',
  body?: Record<string, unknown>,
  pathEntryId = 'entry-1',
  sub = role === 'athlete' ? 'athlete-1' : 'coach-1'
): APIGatewayProxyEvent =>
  ({
    pathParameters: { entryId: pathEntryId },
    body: JSON.stringify(body ?? {}),
    requestContext: {
      authorizer: {
        claims: {
          sub,
          'custom:role': role,
        },
      },
    },
  }) as unknown as APIGatewayProxyEvent;

describe('reviewStructuredMetadata handler', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockPutItem.mockReset();
    mockDeleteItem.mockReset();
    mockBatchWriteItems.mockReset();
    mockExtractEntryTokens.mockReset();
    mockBuildKeywordIndexItems.mockReset();

    mockPutItem.mockResolvedValue();
    mockDeleteItem.mockResolvedValue();
    mockBatchWriteItems.mockResolvedValue();
    mockBuildKeywordIndexItems.mockReturnValue([]);
    mockRecomputeAndPersistProgressViews.mockResolvedValue({
      athleteId: 'athlete-1',
      generatedAt: '2026-02-26T00:00:00.000Z',
      filters: { contextTags: [] },
      timeline: { events: [], cumulative: [] },
      positionHeatmap: { cells: [], maxTrainedCount: 0, neglectedThreshold: 0 },
      outcomeTrends: { points: [] },
      lowConfidenceFlags: [],
      coachAnnotations: [],
      sourceSummary: { sessionsConsidered: 0, structuredSessions: 0, checkoffsConsidered: 0 },
    });
  });

  const mockEntryLookups = () => {
    mockGetItem
      .mockResolvedValueOnce({
        Item: {
          PK: 'ENTRY#entry-1',
          SK: 'META',
          athleteId: 'athlete-1',
          createdAt: '2026-02-26T00:00:00.000Z',
        },
      } as unknown as GetCommandOutput)
      .mockResolvedValueOnce({
        Item: {
          PK: 'USER#athlete-1',
          SK: 'ENTRY#2026-02-26T00:00:00.000Z#entry-1',
          entityType: 'ENTRY',
          entryId: 'entry-1',
          athleteId: 'athlete-1',
          createdAt: '2026-02-26T00:00:00.000Z',
          updatedAt: '2026-02-26T00:00:00.000Z',
          quickAdd: {
            time: '2026-02-26T18:00:00.000Z',
            class: 'Open mat',
            gym: 'North',
            partners: ['Alex'],
            rounds: 5,
            notes: 'Half guard bottom. Got passed.',
          },
          tags: ['guard-type'],
          sections: { shared: 'Half guard bottom rounds.', private: 'Cardio dipped.' },
          sessionMetrics: {
            durationMinutes: 60,
            intensity: 7,
            rounds: 5,
            giOrNoGi: 'gi',
            tags: ['guard'],
          },
          rawTechniqueMentions: ['Knee cut'],
        },
      } as unknown as GetCommandOutput);
    mockExtractEntryTokens
      .mockReturnValueOnce(['half', 'guard'])
      .mockReturnValueOnce(['half', 'guard', 'cardio'])
      .mockReturnValueOnce(['half', 'guard', 'knee'])
      .mockReturnValueOnce(['half', 'guard', 'knee', 'cardio']);
  };

  it('allows athlete to review structured extraction', async () => {
    mockEntryLookups();

    const result = (await handler(
      buildEvent('athlete', {
        structured: { position: 'half guard bottom' },
        confirmations: [{ field: 'position', status: 'confirmed' }],
      }),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    expect(mockPutItem).toHaveBeenCalledWith(
      expect.objectContaining({
        Item: expect.objectContaining({
          structured: expect.objectContaining({
            position: 'half guard bottom',
          }),
          structuredExtraction: expect.objectContaining({
            suggestions: expect.any(Array),
          }),
        }),
      })
    );
  });

  it('allows linked coach to review structured extraction', async () => {
    mockGetItem
      .mockResolvedValueOnce({
        Item: {
          PK: 'ENTRY#entry-1',
          SK: 'META',
          athleteId: 'athlete-1',
          createdAt: '2026-02-26T00:00:00.000Z',
        },
      } as unknown as GetCommandOutput)
      .mockResolvedValueOnce({ Item: { PK: 'USER#athlete-1', SK: 'COACH#coach-1', status: 'active' } } as never)
      .mockResolvedValueOnce({
        Item: {
          PK: 'USER#athlete-1',
          SK: 'ENTRY#2026-02-26T00:00:00.000Z#entry-1',
          entityType: 'ENTRY',
          entryId: 'entry-1',
          athleteId: 'athlete-1',
          createdAt: '2026-02-26T00:00:00.000Z',
          updatedAt: '2026-02-26T00:00:00.000Z',
          quickAdd: {
            time: '2026-02-26T18:00:00.000Z',
            class: 'Open mat',
            gym: 'North',
            partners: ['Alex'],
            rounds: 5,
            notes: 'Half guard bottom. Got passed.',
          },
          tags: ['guard-type'],
          sections: { shared: 'Half guard bottom rounds.', private: 'Cardio dipped.' },
          sessionMetrics: {
            durationMinutes: 60,
            intensity: 7,
            rounds: 5,
            giOrNoGi: 'gi',
            tags: ['guard'],
          },
          rawTechniqueMentions: ['Knee cut'],
        },
      } as unknown as GetCommandOutput);
    mockExtractEntryTokens
      .mockReturnValueOnce(['half', 'guard'])
      .mockReturnValueOnce(['half', 'guard', 'cardio'])
      .mockReturnValueOnce(['half', 'guard', 'knee'])
      .mockReturnValueOnce(['half', 'guard', 'knee', 'cardio']);

    const result = (await handler(
      buildEvent('coach', {
        confirmations: [{ field: 'problem', status: 'rejected' }],
      }),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { entry: { sections: { shared: string; private?: string } } };
    expect(body.entry.sections.shared).toBeTruthy();
    expect(body.entry.sections.private).toBeUndefined();
  });

  it('rejects unlinked coach access', async () => {
    mockGetItem
      .mockResolvedValueOnce({
        Item: {
          PK: 'ENTRY#entry-1',
          SK: 'META',
          athleteId: 'athlete-1',
          createdAt: '2026-02-26T00:00:00.000Z',
        },
      } as unknown as GetCommandOutput)
      .mockResolvedValueOnce({} as never);

    const result = (await handler(buildEvent('coach'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(403);
    expect(mockPutItem).not.toHaveBeenCalled();
  });
});
