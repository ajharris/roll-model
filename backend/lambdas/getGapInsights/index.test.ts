import type { GetCommandOutput, QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { getItem, queryItems } from '../../shared/db';

import { handler } from './index';

jest.mock('../../shared/db');

const mockGetItem = jest.mocked(getItem);
const mockQueryItems = jest.mocked(queryItems);

const buildEvent = (role: 'athlete' | 'coach', athleteId?: string): APIGatewayProxyEvent =>
  ({
    pathParameters: athleteId ? { athleteId } : undefined,
    queryStringParameters: undefined,
    requestContext: {
      authorizer: {
        claims: {
          sub: role === 'athlete' ? 'athlete-1' : 'coach-1',
          'custom:role': role,
        },
      },
    },
  }) as unknown as APIGatewayProxyEvent;

describe('getGapInsights handler', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockQueryItems.mockReset();
  });

  it('returns a report for athlete requests', async () => {
    mockQueryItems
      .mockResolvedValueOnce({
        Items: [
          {
            entityType: 'ENTRY',
            entryId: 'entry-1',
            createdAt: '2026-02-20T10:00:00.000Z',
            structured: { position: 'closed guard' },
            actionPackFinal: { actionPack: { leaks: ['lost posture'] } },
          },
        ],
      } as unknown as QueryCommandOutput)
      .mockResolvedValueOnce({
        Items: [
          {
            entityType: 'CHECKOFF',
            checkoffId: 'armbar::hit-in-live-roll',
            athleteId: 'athlete-1',
            skillId: 'armbar',
            evidenceType: 'hit-in-live-roll',
            status: 'pending',
            minEvidenceRequired: 3,
            confirmedEvidenceCount: 0,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      } as unknown as QueryCommandOutput)
      .mockResolvedValueOnce({ Items: [] } as unknown as QueryCommandOutput);

    const result = (await handler(buildEvent('athlete'), {} as never, () => undefined)) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { report: { athleteId: string } };
    expect(body.report.athleteId).toBe('athlete-1');
    expect(mockQueryItems).toHaveBeenCalledTimes(3);
  });

  it('rejects unlinked coach access', async () => {
    mockGetItem.mockResolvedValueOnce({} as unknown as GetCommandOutput);
    const result = (await handler(buildEvent('coach', 'athlete-1'), {} as never, () => undefined)) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(403);
  });
});
