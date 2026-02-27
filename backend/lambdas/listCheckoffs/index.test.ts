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
    requestContext: {
      authorizer: {
        claims: {
          sub: role === 'athlete' ? 'athlete-1' : 'coach-1',
          'custom:role': role,
        },
      },
    },
  }) as unknown as APIGatewayProxyEvent;

describe('listCheckoffs handler', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockQueryItems.mockReset();
  });

  it('returns checkoffs for athlete', async () => {
    mockQueryItems
      .mockResolvedValueOnce({
        Items: [
          {
            entityType: 'CHECKOFF',
            checkoffId: 'knee-cut::hit-in-live-roll',
            athleteId: 'athlete-1',
            skillId: 'knee-cut',
            evidenceType: 'hit-in-live-roll',
            status: 'pending',
          },
        ],
      } as unknown as QueryCommandOutput)
      .mockResolvedValueOnce({
        Items: [{ entityType: 'CHECKOFF_EVIDENCE', evidenceId: 'e-1', statement: 'hit in sparring' }],
      } as unknown as QueryCommandOutput);

    const result = (await handler(buildEvent('athlete'), {} as never, () => undefined)) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { checkoffs: Array<{ evidence: unknown[] }> };
    expect(body.checkoffs).toHaveLength(1);
    expect(body.checkoffs[0].evidence).toHaveLength(1);
  });

  it('rejects unlinked coach access', async () => {
    mockGetItem.mockResolvedValueOnce({} as unknown as GetCommandOutput);
    const result = (await handler(buildEvent('coach', 'athlete-1'), {} as never, () => undefined)) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(403);
  });
});
