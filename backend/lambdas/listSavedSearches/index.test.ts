import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { QueryCommandOutput } from '@aws-sdk/lib-dynamodb';

import { queryItems } from '../../shared/db';

import { handler } from './index';

jest.mock('../../shared/db');

const mockQueryItems = jest.mocked(queryItems);

const buildEvent = (role: 'athlete' | 'coach'): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: {
        claims: {
          sub: 'user-123',
          'custom:role': role
        }
      }
    }
  }) as unknown as APIGatewayProxyEvent;

describe('listSavedSearches handler', () => {
  beforeEach(() => {
    mockQueryItems.mockReset();
  });

  it('lists athlete saved searches', async () => {
    mockQueryItems.mockResolvedValueOnce({
      Items: [
        {
          PK: 'USER#user-123',
          SK: 'SAVED_SEARCH#s1',
          entityType: 'SAVED_SEARCH',
          id: 's1',
          userId: 'user-123',
          name: 'Comp prep',
          query: 'guard',
          tag: 'competition',
          giOrNoGi: 'gi',
          minIntensity: '7',
          maxIntensity: '',
          sortBy: 'intensity',
          sortDirection: 'desc',
          createdAt: '2026-02-26T00:00:00.000Z',
          updatedAt: '2026-02-26T00:00:00.000Z'
        }
      ]
    } as unknown as QueryCommandOutput);

    const result = (await handler(buildEvent('athlete'), {} as never, () => undefined)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    expect(mockQueryItems).toHaveBeenCalledWith(
      expect.objectContaining({
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :savedSearchPrefix)'
      })
    );
    const body = JSON.parse(result.body) as { savedSearches: Array<{ id: string; name: string }> };
    expect(body.savedSearches).toEqual([expect.objectContaining({ id: 's1', name: 'Comp prep' })]);
  });

  it('rejects non-athletes', async () => {
    const result = (await handler(buildEvent('coach'), {} as never, () => undefined)) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(403);
  });
});
