import type { GetCommandOutput } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { buildActionPackDeleteKeys, buildActionPackIndexItems } from '../../shared/actionPackIndex';
import { batchWriteItems, deleteItem, getItem, putItem } from '../../shared/db';
import { CURRENT_ENTRY_SCHEMA_VERSION } from '../../shared/entries';
import { buildKeywordIndexItems, extractEntryTokens } from '../../shared/keywords';
import { recomputeAndPersistProgressViews } from '../../shared/progressStore';
import { upsertTechniqueCandidates } from '../../shared/techniques';

import { handler } from './index';

jest.mock('../../shared/db');
jest.mock('../../shared/keywords');
jest.mock('../../shared/actionPackIndex');
jest.mock('../../shared/progressStore', () => ({
  recomputeAndPersistProgressViews: jest.fn()
}));
jest.mock('../../shared/techniques', () => ({
  ...jest.requireActual('../../shared/techniques'),
  upsertTechniqueCandidates: jest.fn()
}));

const mockGetItem = jest.mocked(getItem);
const mockPutItem = jest.mocked(putItem);
const mockDeleteItem = jest.mocked(deleteItem);
const mockBatchWriteItems = jest.mocked(batchWriteItems);
const mockExtractEntryTokens = jest.mocked(extractEntryTokens);
const mockBuildKeywordIndexItems = jest.mocked(buildKeywordIndexItems);
const mockBuildActionPackDeleteKeys = jest.mocked(buildActionPackDeleteKeys);
const mockBuildActionPackIndexItems = jest.mocked(buildActionPackIndexItems);
const mockUpsertTechniqueCandidates = jest.mocked(upsertTechniqueCandidates);
const mockRecomputeAndPersistProgressViews = jest.mocked(recomputeAndPersistProgressViews);

const buildEvent = (role: 'athlete' | 'coach', bodyOverride?: Record<string, unknown>): APIGatewayProxyEvent =>
  ({
    pathParameters: { entryId: 'entry-1' },
    body: JSON.stringify({
      quickAdd: {
        time: '2026-02-26T18:30:00.000Z',
        class: 'No-gi advanced',
        gym: 'North Academy',
        partners: ['Blake'],
        rounds: 4,
        notes: 'new shared'
      },
      structured: {
        position: 'mount',
        problem: 'lost elbow-knee connection'
      },
      tags: ['top', 'submission'],
      sections: { shared: 'new shared', private: 'new private' },
      sessionMetrics: {
        durationMinutes: 45,
        intensity: 7,
        rounds: 4,
        giOrNoGi: 'no-gi',
        tags: ['mount']
      },
      rawTechniqueMentions: ['Armbar'],
      ...bodyOverride
    }),
    requestContext: {
      authorizer: {
        claims: {
          sub: role === 'athlete' ? 'athlete-1' : 'coach-1',
          'custom:role': role
        }
      }
    }
  }) as unknown as APIGatewayProxyEvent;

describe('updateEntry handler', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockPutItem.mockReset();
    mockDeleteItem.mockReset();
    mockBatchWriteItems.mockReset();
    mockExtractEntryTokens.mockReset();
    mockBuildKeywordIndexItems.mockReset();
    mockBuildActionPackDeleteKeys.mockReset();
    mockBuildActionPackIndexItems.mockReset();
    mockUpsertTechniqueCandidates.mockReset();

    mockPutItem.mockResolvedValue();
    mockDeleteItem.mockResolvedValue();
    mockBatchWriteItems.mockResolvedValue();
    mockBuildKeywordIndexItems.mockReturnValue([]);
    mockBuildActionPackDeleteKeys.mockReturnValue([]);
    mockBuildActionPackIndexItems.mockReturnValue([]);
    mockUpsertTechniqueCandidates.mockResolvedValue();
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

  it('updates an entry and syncs keyword index changes', async () => {
    mockGetItem
      .mockResolvedValueOnce({
        Item: {
          PK: 'ENTRY#entry-1',
          SK: 'META',
          athleteId: 'athlete-1',
          createdAt: '2024-01-01T00:00:00.000Z'
        }
      } as unknown as GetCommandOutput)
      .mockResolvedValueOnce({
        Item: {
          PK: 'USER#athlete-1',
          SK: 'ENTRY#2024-01-01T00:00:00.000Z#entry-1',
          entityType: 'ENTRY',
          entryId: 'entry-1',
          athleteId: 'athlete-1',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          quickAdd: {
            time: '2024-01-01T18:00:00.000Z',
            class: 'Open mat',
            gym: 'North Academy',
            partners: ['Chris'],
            rounds: 6,
            notes: 'old shared'
          },
          tags: ['guard-type'],
          sections: { shared: 'old shared', private: 'old private' },
          sessionMetrics: {
            durationMinutes: 60,
            intensity: 5,
            rounds: 6,
            giOrNoGi: 'gi',
            tags: ['guard']
          },
          rawTechniqueMentions: ['Triangle']
        }
      } as unknown as GetCommandOutput);

    mockExtractEntryTokens
      .mockReturnValueOnce(['guard'])
      .mockReturnValueOnce(['guard', 'old-private'])
      .mockReturnValueOnce(['mount'])
      .mockReturnValueOnce(['mount', 'new-private']);

    mockBuildKeywordIndexItems
      .mockReturnValueOnce([{ id: 'shared-new' } as unknown as Record<string, string>])
      .mockReturnValueOnce([{ id: 'private-new' } as unknown as Record<string, string>]);

    const result = (await handler(buildEvent('athlete'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    expect(mockPutItem).toHaveBeenCalledTimes(1);
    expect(mockPutItem).toHaveBeenCalledWith(
      expect.objectContaining({
        Item: expect.objectContaining({
          schemaVersion: CURRENT_ENTRY_SCHEMA_VERSION
        })
      })
    );
    expect(mockDeleteItem).toHaveBeenCalledTimes(2);
    expect(mockBatchWriteItems).toHaveBeenCalledWith([
      { id: 'shared-new' },
      { id: 'private-new' }
    ]);
    expect(mockUpsertTechniqueCandidates).toHaveBeenCalledWith(['Armbar'], 'entry-1', expect.any(String));
  });

  it('rejects coach access', async () => {
    const result = (await handler(buildEvent('coach'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(403);
    expect(mockGetItem).not.toHaveBeenCalled();
  });

  it('rejects missing entry id', async () => {
    const event = buildEvent('athlete');
    event.pathParameters = null;

    const result = (await handler(event, {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(400);
    expect(mockGetItem).not.toHaveBeenCalled();
  });

  it('rejects missing body', async () => {
    const event = buildEvent('athlete');
    event.body = null;

    const result = (await handler(event, {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(400);
    expect(mockGetItem).not.toHaveBeenCalled();
  });

  it('rejects invalid payload', async () => {
    const event = buildEvent('athlete');
    event.body = JSON.stringify({ sections: { shared: 'x' } });

    const result = (await handler(event, {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body) as { error: { message: string } };
    expect(body.error.message).toContain('quickAdd');
    expect(mockGetItem).not.toHaveBeenCalled();
  });

  it('rejects invalid media url or timestamp payload', async () => {
    const result = (await handler(
      buildEvent('athlete', {
        mediaAttachments: [
          {
            mediaId: 'media-1',
            title: 'Round 1',
            url: 'ftp://invalid.example',
            clipNotes: [{ clipId: 'clip-1', timestamp: '99', text: 'Late frame' }]
          }
        ]
      }),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(400);
    expect(mockGetItem).not.toHaveBeenCalled();
  });

  it('returns not found when meta row is missing', async () => {
    mockGetItem.mockResolvedValueOnce({} as unknown as GetCommandOutput);

    const result = (await handler(buildEvent('athlete'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(404);
  });

  it('forbids updating another athlete entry', async () => {
    mockGetItem.mockResolvedValueOnce({
      Item: {
        PK: 'ENTRY#entry-1',
        SK: 'META',
        athleteId: 'athlete-2',
        createdAt: '2024-01-01T00:00:00.000Z'
      }
    } as unknown as GetCommandOutput);

    const result = (await handler(buildEvent('athlete'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(403);
  });

  it('returns not found when entry row is missing', async () => {
    mockGetItem
      .mockResolvedValueOnce({
        Item: {
          PK: 'ENTRY#entry-1',
          SK: 'META',
          athleteId: 'athlete-1',
          createdAt: '2024-01-01T00:00:00.000Z'
        }
      } as unknown as GetCommandOutput)
      .mockResolvedValueOnce({} as unknown as GetCommandOutput);

    const result = (await handler(buildEvent('athlete'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(404);
  });

  it('skips batch write when no new keyword rows are introduced', async () => {
    mockGetItem
      .mockResolvedValueOnce({
        Item: {
          PK: 'ENTRY#entry-1',
          SK: 'META',
          athleteId: 'athlete-1',
          createdAt: '2024-01-01T00:00:00.000Z'
        }
      } as unknown as GetCommandOutput)
      .mockResolvedValueOnce({
        Item: {
          PK: 'USER#athlete-1',
          SK: 'ENTRY#2024-01-01T00:00:00.000Z#entry-1',
          entityType: 'ENTRY',
          entryId: 'entry-1',
          athleteId: 'athlete-1',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          quickAdd: {
            time: '2024-01-01T18:00:00.000Z',
            class: 'Open mat',
            gym: 'North Academy',
            partners: ['Chris'],
            rounds: 6,
            notes: 'old shared'
          },
          tags: ['guard-type'],
          sections: { shared: 'old shared', private: 'old private' },
          sessionMetrics: {
            durationMinutes: 60,
            intensity: 5,
            rounds: 6,
            giOrNoGi: 'gi',
            tags: ['guard']
          },
          rawTechniqueMentions: ['Triangle']
        }
      } as unknown as GetCommandOutput);

    mockExtractEntryTokens
      .mockReturnValueOnce(['guard'])
      .mockReturnValueOnce(['guard', 'private'])
      .mockReturnValueOnce(['guard'])
      .mockReturnValueOnce(['guard', 'private']);
    mockBuildKeywordIndexItems.mockReturnValue([]);

    const result = (await handler(buildEvent('athlete'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    expect(mockBatchWriteItems).not.toHaveBeenCalled();
  });

  it('migrates legacy entry rows without schemaVersion before writing updates', async () => {
    mockGetItem
      .mockResolvedValueOnce({
        Item: {
          PK: 'ENTRY#entry-1',
          SK: 'META',
          athleteId: 'athlete-1',
          createdAt: '2024-01-01T00:00:00.000Z'
        }
      } as unknown as GetCommandOutput)
      .mockResolvedValueOnce({
        Item: {
          PK: 'USER#athlete-1',
          SK: 'ENTRY#2024-01-01T00:00:00.000Z#entry-1',
          entityType: 'ENTRY',
          entryId: 'entry-1',
          athleteId: 'athlete-1',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          quickAdd: {
            time: '2024-01-01T18:00:00.000Z',
            class: 'Open mat',
            gym: 'North Academy',
            partners: ['Chris'],
            rounds: 6,
            notes: 'old shared'
          },
          tags: ['guard-type'],
          sections: { shared: 'old shared', private: 'old private' },
          sessionMetrics: {
            durationMinutes: 60,
            intensity: 5,
            rounds: 6,
            giOrNoGi: 'gi',
            tags: ['guard']
          }
        }
      } as unknown as GetCommandOutput);

    mockExtractEntryTokens
      .mockReturnValueOnce(['guard'])
      .mockReturnValueOnce(['guard'])
      .mockReturnValueOnce(['mount'])
      .mockReturnValueOnce(['mount']);
    mockBuildKeywordIndexItems.mockReturnValue([]);

    const result = (await handler(buildEvent('athlete'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    expect(mockPutItem).toHaveBeenCalledWith(
      expect.objectContaining({
        Item: expect.objectContaining({
          schemaVersion: CURRENT_ENTRY_SCHEMA_VERSION,
          rawTechniqueMentions: ['Armbar']
        })
      })
    );
  });

  it('rewrites action-pack index rows on update', async () => {
    mockGetItem
      .mockResolvedValueOnce({
        Item: {
          PK: 'ENTRY#entry-1',
          SK: 'META',
          athleteId: 'athlete-1',
          createdAt: '2024-01-01T00:00:00.000Z'
        }
      } as unknown as GetCommandOutput)
      .mockResolvedValueOnce({
        Item: {
          PK: 'USER#athlete-1',
          SK: 'ENTRY#2024-01-01T00:00:00.000Z#entry-1',
          entityType: 'ENTRY',
          entryId: 'entry-1',
          athleteId: 'athlete-1',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          sections: { shared: 'old shared', private: 'old private' },
          sessionMetrics: {
            durationMinutes: 60,
            intensity: 5,
            rounds: 6,
            giOrNoGi: 'gi',
            tags: ['guard']
          },
          rawTechniqueMentions: []
        }
      } as unknown as GetCommandOutput);

    mockExtractEntryTokens
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([]);
    mockBuildKeywordIndexItems.mockReturnValue([]);
    mockBuildActionPackDeleteKeys.mockReturnValue([{ PK: 'USER#athlete-1', SK: 'APF#old' }] as never);
    mockBuildActionPackIndexItems.mockReturnValue([{ id: 'apf-new' }] as never);

    const event = buildEvent('athlete');
    event.body = JSON.stringify({
      quickAdd: {
        time: '2026-02-26T18:30:00.000Z',
        class: 'No-gi advanced',
        gym: 'North Academy',
        partners: ['Blake'],
        rounds: 4,
        notes: 'new shared'
      },
      tags: ['top', 'submission'],
      sections: { shared: 'new shared', private: 'new private' },
      sessionMetrics: {
        durationMinutes: 45,
        intensity: 7,
        rounds: 4,
        giOrNoGi: 'no-gi',
        tags: ['mount']
      },
      rawTechniqueMentions: ['Armbar'],
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
        finalizedAt: '2026-02-26T00:00:00.000Z'
      }
    });

    const result = (await handler(event, {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    expect(mockDeleteItem).toHaveBeenCalledWith({ Key: { PK: 'USER#athlete-1', SK: 'APF#old' } });
    expect(mockBatchWriteItems).toHaveBeenCalledWith([{ id: 'apf-new' }]);
  });

  it('updates and normalizes session review cue on entry update', async () => {
    mockGetItem
      .mockResolvedValueOnce({
        Item: {
          PK: 'ENTRY#entry-1',
          SK: 'META',
          athleteId: 'athlete-1',
          createdAt: '2024-01-01T00:00:00.000Z'
        }
      } as unknown as GetCommandOutput)
      .mockResolvedValueOnce({
        Item: {
          PK: 'USER#athlete-1',
          SK: 'ENTRY#2024-01-01T00:00:00.000Z#entry-1',
          entityType: 'ENTRY',
          entryId: 'entry-1',
          athleteId: 'athlete-1',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          sections: { shared: 'old shared', private: 'old private' },
          sessionMetrics: {
            durationMinutes: 60,
            intensity: 5,
            rounds: 6,
            giOrNoGi: 'gi',
            tags: ['guard']
          },
          rawTechniqueMentions: []
        }
      } as unknown as GetCommandOutput);

    mockExtractEntryTokens.mockReturnValueOnce([]).mockReturnValueOnce([]).mockReturnValueOnce([]).mockReturnValueOnce([]);
    mockBuildKeywordIndexItems.mockReturnValue([]);

    const event = buildEvent('athlete', {
      sessionReviewDraft: {
        promptSet: {
          whatWorked: ['Recovered guard'],
          whatFailed: ['Late pummel'],
          whatToAskCoach: ['How to improve timing?'],
          whatToDrillSolo: ['Pummel first reps'],
        },
        oneThing: '  1) Pummel first from half guard. Keep elbow in.',
        confidenceFlags: [{ field: 'oneThing', confidence: 'high' }],
      },
    });

    const result = (await handler(event, {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    expect(mockPutItem).toHaveBeenCalledWith(
      expect.objectContaining({
        Item: expect.objectContaining({
          sessionReviewDraft: expect.objectContaining({
            oneThing: 'Pummel first from half guard',
          }),
        }),
      })
    );
  });
});
