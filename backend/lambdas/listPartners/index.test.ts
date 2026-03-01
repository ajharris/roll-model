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

describe('listPartners', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockQueryItems.mockReset();
  });

  it('filters private partner cards for coach mode', async () => {
    mockGetItem.mockResolvedValueOnce({ Item: { PK: 'USER#athlete-1', SK: 'COACH#coach-1' } } as unknown as GetCommandOutput);
    mockQueryItems.mockResolvedValueOnce({
      Items: [
        {
          PK: 'USER#athlete-1',
          SK: 'PARTNER#partner-1',
          entityType: 'PARTNER_PROFILE',
          partnerId: 'partner-1',
          athleteId: 'athlete-1',
          displayName: 'Alex',
          styleTags: ['pressure-passer'],
          visibility: 'private',
          createdAt: '2026-02-26T00:00:00.000Z',
          updatedAt: '2026-02-26T00:00:00.000Z',
        },
        {
          PK: 'USER#athlete-1',
          SK: 'PARTNER#partner-2',
          entityType: 'PARTNER_PROFILE',
          partnerId: 'partner-2',
          athleteId: 'athlete-1',
          displayName: 'Blake',
          styleTags: ['wrestler'],
          visibility: 'shared-with-coach',
          createdAt: '2026-02-26T00:00:00.000Z',
          updatedAt: '2026-02-26T00:00:00.000Z',
        },
      ],
    } as unknown as QueryCommandOutput);

    const result = (await handler(buildEvent('coach', 'athlete-1'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { partners: Array<{ partnerId: string }> };
    expect(body.partners).toEqual([{ partnerId: 'partner-2', athleteId: 'athlete-1', displayName: 'Blake', styleTags: ['wrestler'], visibility: 'shared-with-coach', createdAt: '2026-02-26T00:00:00.000Z', updatedAt: '2026-02-26T00:00:00.000Z' }]);
  });
});
