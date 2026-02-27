import type { GetCommandOutput } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { getItem, putItem } from '../../shared/db';

import { handler } from './index';

jest.mock('../../shared/db');

const mockGetItem = jest.mocked(getItem);
const mockPutItem = jest.mocked(putItem);

const buildEvent = (role: 'athlete' | 'coach', athleteId?: string, body?: unknown): APIGatewayProxyEvent =>
  ({
    body: body ? JSON.stringify(body) : undefined,
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

describe('upsertGapPriorities handler', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockPutItem.mockReset();
  });

  it('persists athlete priority updates', async () => {
    const result = (await handler(
      buildEvent('athlete', undefined, {
        priorities: [
          {
            gapId: 'stale-skill:knee-cut',
            status: 'accepted',
            manualPriority: 1,
          },
        ],
      }),
      {} as never,
      () => undefined,
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { saved: Array<{ gapId: string }> };
    expect(body.saved).toHaveLength(1);
    expect(body.saved[0].gapId).toBe('stale-skill:knee-cut');
    expect(mockPutItem).toHaveBeenCalledTimes(1);
  });

  it('rejects unlinked coach access', async () => {
    mockGetItem.mockResolvedValueOnce({} as unknown as GetCommandOutput);
    const result = (await handler(
      buildEvent('coach', 'athlete-1', {
        priorities: [{ gapId: 'stale-skill:knee-cut', status: 'accepted' }],
      }),
      {} as never,
      () => undefined,
    )) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(403);
  });
});
