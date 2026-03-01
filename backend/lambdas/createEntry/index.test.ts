import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { buildActionPackIndexItems } from '../../shared/actionPackIndex';
import { batchWriteItems, getItem, putItem } from '../../shared/db';
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

const mockPutItem = jest.mocked(putItem);
const mockBatchWriteItems = jest.mocked(batchWriteItems);
const mockGetItem = jest.mocked(getItem);
const mockExtractEntryTokens = jest.mocked(extractEntryTokens);
const mockBuildKeywordIndexItems = jest.mocked(buildKeywordIndexItems);
const mockBuildActionPackIndexItems = jest.mocked(buildActionPackIndexItems);
const mockUpsertTechniqueCandidates = jest.mocked(upsertTechniqueCandidates);
const mockRecomputeAndPersistProgressViews = jest.mocked(recomputeAndPersistProgressViews);

const buildEvent = (role: 'athlete' | 'coach', bodyOverride?: Record<string, unknown>): APIGatewayProxyEvent =>
  ({
    body: JSON.stringify({
      quickAdd: {
        time: '2026-02-26T18:00:00.000Z',
        class: 'Evening fundamentals',
        gym: 'North Academy',
        partners: ['Alex'],
        rounds: 6,
        notes: 'shared notes'
      },
      structured: {
        position: 'half guard',
        technique: 'knee cut'
      },
      tags: ['guard-type', 'pass'],
      sections: { private: 'private notes', shared: 'shared notes' },
      sessionMetrics: {
        durationMinutes: 60,
        intensity: 7,
        rounds: 6,
        giOrNoGi: 'gi',
        tags: ['guard']
      },
      rawTechniqueMentions: ['Knee Slice'],
      ...bodyOverride
    }),
    requestContext: {
      authorizer: {
        claims: {
          sub: 'user-123',
          'custom:role': role
        }
      }
    }
  }) as unknown as APIGatewayProxyEvent;

describe('createEntry handler auth', () => {
  beforeEach(() => {
    mockPutItem.mockResolvedValue();
    mockBatchWriteItems.mockResolvedValue();
    mockGetItem.mockResolvedValue({} as never);
    mockExtractEntryTokens.mockReset();
    mockBuildKeywordIndexItems.mockReturnValue([]);
    mockBuildActionPackIndexItems.mockReset();
    mockBuildActionPackIndexItems.mockReturnValue([]);
    mockRecomputeAndPersistProgressViews.mockResolvedValue({
      athleteId: 'user-123',
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

  it('allows athlete tokens', async () => {
    mockExtractEntryTokens.mockReturnValueOnce(['guard']).mockReturnValueOnce(['guard', 'private-note']);
    mockBuildKeywordIndexItems
      .mockReturnValueOnce([{ id: 'shared' }])
      .mockReturnValueOnce([{ id: 'private' }]);

    const result = (await handler(buildEvent('athlete'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body) as { entry: { athleteId: string; schemaVersion: number } };
    expect(body.entry.athleteId).toBe('user-123');
    expect(body.entry.schemaVersion).toBe(CURRENT_ENTRY_SCHEMA_VERSION);
    expect(mockPutItem).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        Item: expect.objectContaining({
          entityType: 'ENTRY',
          schemaVersion: CURRENT_ENTRY_SCHEMA_VERSION,
          quickAdd: expect.objectContaining({
            class: 'Evening fundamentals'
          }),
          structured: expect.objectContaining({
            technique: 'knee cut'
          }),
          structuredExtraction: expect.objectContaining({
            suggestions: expect.any(Array)
          }),
          tags: ['guard-type', 'pass']
        })
      })
    );
    expect(mockPutItem).toHaveBeenCalledTimes(2);
    expect(mockExtractEntryTokens).toHaveBeenCalledTimes(2);
    expect(mockUpsertTechniqueCandidates).toHaveBeenCalledWith(['Knee Slice'], expect.any(String), expect.any(String));
    expect(mockBuildKeywordIndexItems).toHaveBeenCalledWith(
      'user-123',
      expect.any(String),
      expect.any(String),
      ['guard'],
      { visibilityScope: 'shared' }
    );
    expect(mockBuildKeywordIndexItems).toHaveBeenCalledWith(
      'user-123',
      expect.any(String),
      expect.any(String),
      ['private-note'],
      { visibilityScope: 'private' }
    );
    expect(mockBatchWriteItems).toHaveBeenCalledWith([{ id: 'shared' }, { id: 'private' }]);
  });

  it('rejects invalid media url and timestamp payloads', async () => {
    const result = (await handler(
      buildEvent('athlete', {
        mediaAttachments: [
          {
            mediaId: 'media-1',
            title: 'Round 1',
            url: 'not-a-url',
            clipNotes: [{ clipId: 'clip-1', timestamp: '32', text: 'Late frame' }]
          }
        ]
      }),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(400);
    expect(mockPutItem).not.toHaveBeenCalled();
  });

  it('rejects invalid session review payloads', async () => {
    const result = (await handler(
      buildEvent('athlete', {
        sessionReviewDraft: {
          promptSet: {
            whatWorked: [],
            whatFailed: [],
            whatToAskCoach: [],
            whatToDrillSolo: [],
          },
          oneThing: '',
          confidenceFlags: [],
        },
      }),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(400);
    expect(mockPutItem).not.toHaveBeenCalled();
  });

  it('rejects invalid session context tags', async () => {
    const result = (await handler(
      buildEvent('athlete', {
        sessionContext: {
          ruleset: 'ibjjf',
          fatigueLevel: 6,
          injuryNotes: ['left shoulder'],
          tags: ['Bad Tag'],
        },
      }),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(400);
    expect(mockPutItem).not.toHaveBeenCalled();
  });

  it('rejects partner outcomes when partner profile is missing', async () => {
    mockGetItem.mockResolvedValueOnce({} as never);

    const result = (await handler(
      buildEvent('athlete', {
        partnerOutcomes: [
          {
            partnerId: 'partner-404',
            styleTags: ['pressure-passer'],
            whatWorked: ['Inside frames'],
            whatFailed: ['Late pummel'],
          },
        ],
      }),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(400);
    expect(mockPutItem).not.toHaveBeenCalled();
  });

  it('hydrates partner outcomes from linked partner profile', async () => {
    mockExtractEntryTokens.mockReturnValueOnce(['guard']).mockReturnValueOnce(['guard']);
    mockBuildKeywordIndexItems.mockReturnValue([]);
    mockGetItem.mockResolvedValueOnce({
      Item: {
        PK: 'USER#user-123',
        SK: 'PARTNER#partner-1',
        entityType: 'PARTNER_PROFILE',
        partnerId: 'partner-1',
        athleteId: 'user-123',
        displayName: 'Alex',
        styleTags: ['pressure-passer'],
        visibility: 'private',
        createdAt: '2026-02-26T00:00:00.000Z',
        updatedAt: '2026-02-26T00:00:00.000Z',
      },
    } as never);

    const result = (await handler(
      buildEvent('athlete', {
        partnerOutcomes: [
          {
            partnerId: 'partner-1',
            styleTags: [],
            whatWorked: ['Knee shield frames'],
            whatFailed: ['Crossface denial'],
          },
        ],
      }),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(201);
    expect(mockPutItem).toHaveBeenCalledWith(
      expect.objectContaining({
        Item: expect.objectContaining({
          partnerOutcomes: [
            expect.objectContaining({
              partnerId: 'partner-1',
              partnerDisplayName: 'Alex',
              styleTags: ['pressure-passer'],
            }),
          ],
        }),
      })
    );
  });

  it('rejects coach tokens', async () => {
    const result = (await handler(buildEvent('coach'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('writes action-pack index rows when finalized action pack is provided', async () => {
    mockExtractEntryTokens.mockReturnValueOnce(['guard']).mockReturnValueOnce(['guard']);
    mockBuildKeywordIndexItems.mockReturnValue([]);
    mockBuildActionPackIndexItems.mockReturnValueOnce([{ id: 'apf-item' }] as never);

    const event = buildEvent('athlete');
    event.body = JSON.stringify({
      quickAdd: {
        time: '2026-02-26T18:00:00.000Z',
        class: 'Evening fundamentals',
        gym: 'North Academy',
        partners: ['Alex'],
        rounds: 6,
        notes: 'shared notes'
      },
      tags: ['guard-type', 'pass'],
      sections: { private: 'private notes', shared: 'shared notes' },
      sessionMetrics: {
        durationMinutes: 60,
        intensity: 7,
        rounds: 6,
        giOrNoGi: 'gi',
        tags: ['guard']
      },
      rawTechniqueMentions: ['Knee Slice'],
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

    expect(result.statusCode).toBe(201);
    expect(mockBatchWriteItems).toHaveBeenCalledWith([{ id: 'apf-item' }]);
  });

  it('persists normalized session review one-thing cue', async () => {
    mockExtractEntryTokens.mockReturnValueOnce(['guard']).mockReturnValueOnce(['guard']);
    mockBuildKeywordIndexItems.mockReturnValue([]);

    const result = (await handler(
      buildEvent('athlete', {
        sessionReviewDraft: {
          promptSet: {
            whatWorked: ['Maintained frames'],
            whatFailed: ['Late underhook response'],
            whatToAskCoach: ['How to keep elbow-knee connection?'],
            whatToDrillSolo: ['Pummel early from half guard'],
          },
          oneThing: '  - Pummel first in half guard. Then reset stance. ',
          confidenceFlags: [{ field: 'oneThing', confidence: 'medium' }],
        },
      }),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(201);
    expect(mockPutItem).toHaveBeenCalledWith(
      expect.objectContaining({
        Item: expect.objectContaining({
          sessionReviewDraft: expect.objectContaining({
            oneThing: 'Pummel first in half guard',
          }),
        }),
      })
    );
  });
});
