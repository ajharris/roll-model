import type { GetCommandOutput, QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { getItem, putItem, queryItems } from '../../shared/db';

import { handler } from './index';

jest.mock('../../shared/db');

const mockGetItem = jest.mocked(getItem);
const mockQueryItems = jest.mocked(queryItems);
const mockPutItem = jest.mocked(putItem);

const buildEvent = (role: 'athlete' | 'coach', bodyOverride?: Record<string, unknown>): APIGatewayProxyEvent =>
  ({
    pathParameters: { checkoffId: 'knee-cut::hit-in-live-roll' },
    body: JSON.stringify({
      evidenceReviews: [{ evidenceId: 'e-1', mappingStatus: 'confirmed', quality: 'strong' }],
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

describe('reviewCheckoff handler', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockQueryItems.mockReset();
    mockPutItem.mockReset();
    mockPutItem.mockResolvedValue();
  });

  it('applies evidence review updates', async () => {
    mockGetItem.mockResolvedValueOnce({
      Item: {
        entityType: 'CHECKOFF',
        checkoffId: 'knee-cut::hit-in-live-roll',
        athleteId: 'athlete-1',
        skillId: 'knee-cut',
        evidenceType: 'hit-in-live-roll',
        status: 'pending',
        minEvidenceRequired: 3,
        confirmedEvidenceCount: 0,
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:00:00.000Z',
      },
    } as unknown as GetCommandOutput);

    mockQueryItems.mockResolvedValueOnce({
      Items: [
        {
          PK: 'USER#athlete-1',
          SK: 'CHECKOFF#SKILL#knee-cut#TYPE#hit-in-live-roll#EVIDENCE#2026-02-02#e-1',
          entityType: 'CHECKOFF_EVIDENCE',
          evidenceId: 'e-1',
          checkoffId: 'knee-cut::hit-in-live-roll',
          athleteId: 'athlete-1',
          skillId: 'knee-cut',
          entryId: 'entry-1',
          evidenceType: 'hit-in-live-roll',
          source: 'gpt-structured',
          statement: 'hit it',
          confidence: 'medium',
          mappingStatus: 'pending_confirmation',
          createdAt: '2026-02-02T00:00:00.000Z',
          updatedAt: '2026-02-02T00:00:00.000Z',
        },
      ],
    } as unknown as QueryCommandOutput);

    const result = (await handler(buildEvent('athlete'), {} as never, () => undefined)) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(200);
    expect(mockPutItem).toHaveBeenCalled();
  });
});
