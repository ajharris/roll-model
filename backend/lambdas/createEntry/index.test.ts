import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { batchWriteItems, putItem } from '../../shared/db';
import { CURRENT_ENTRY_SCHEMA_VERSION } from '../../shared/entries';
import { buildKeywordIndexItems, extractEntryTokens } from '../../shared/keywords';
import { upsertTechniqueCandidates } from '../../shared/techniques';

import { handler } from './index';

jest.mock('../../shared/db');
jest.mock('../../shared/keywords');
jest.mock('../../shared/techniques', () => ({
  ...jest.requireActual('../../shared/techniques'),
  upsertTechniqueCandidates: jest.fn()
}));

const mockPutItem = jest.mocked(putItem);
const mockBatchWriteItems = jest.mocked(batchWriteItems);
const mockExtractEntryTokens = jest.mocked(extractEntryTokens);
const mockBuildKeywordIndexItems = jest.mocked(buildKeywordIndexItems);
const mockUpsertTechniqueCandidates = jest.mocked(upsertTechniqueCandidates);

const buildEvent = (role: 'athlete' | 'coach', bodyOverride?: Record<string, unknown>): APIGatewayProxyEvent =>
  ({
    body: JSON.stringify({
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
    mockExtractEntryTokens.mockReset();
    mockBuildKeywordIndexItems.mockReturnValue([]);
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
          schemaVersion: CURRENT_ENTRY_SCHEMA_VERSION
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

  it('rejects coach tokens', async () => {
    const result = (await handler(buildEvent('coach'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });
});
